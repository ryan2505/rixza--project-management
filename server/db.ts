import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA } from './schema.ts';

/**
 * Data access layer — PostgreSQL everywhere.
 *  - DATABASE_URL set  → node-postgres pool (Supabase in production)
 *  - otherwise         → embedded PGlite (real Postgres compiled to WASM) under DATA_DIR,
 *                        so development and tests need no database server.
 * SQL is written with `?` placeholders and converted to `$1…$n`.
 */

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DATABASE_URL = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? '';

export type Param = string | number | boolean | null | undefined;
type Row = Record<string, any>;
interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Row[]; rowCount?: number | null; affectedRows?: number }>;
}
interface Driver {
  kind: 'postgres' | 'pglite';
  q: Queryable;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
}

async function postgresDriver(): Promise<Driver> {
  const pg = (await import('pg')).default;
  pg.types.setTypeParser(20, (v: string) => Number(v)); // int8 (COUNT) → number
  pg.types.setTypeParser(1700, (v: string) => Number(v)); // numeric (SUM) → number
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(DATABASE_URL);
  const pool = new pg.Pool({
    connectionString: DATABASE_URL,
    max: Number(process.env.PG_POOL_MAX ?? (process.env.VERCEL ? 3 : 10)),
    ssl: local ? undefined : { rejectUnauthorized: false },
    idleTimeoutMillis: 10_000,
  });
  return {
    kind: 'postgres',
    q: pool,
    exec: async (sql) => void (await pool.query(sql)),
    transaction: async (fn) => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const r = await fn(c);
        await c.query('COMMIT');
        return r;
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
  };
}

async function pgliteDriver(): Promise<Driver> {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // Non-literal specifier keeps PGlite out of the serverless bundle (never used there).
  const mod = '@electric-sql/pglite';
  const { PGlite } = await import(mod);
  const db = await PGlite.create(path.join(DATA_DIR, 'pgdata'), { parsers: { 20: Number, 1700: Number } });
  return {
    kind: 'pglite',
    q: db,
    exec: async (sql) => void (await db.exec(sql)),
    transaction: (fn) => db.transaction((tx: Queryable) => fn(tx)),
  };
}

let driverP: Promise<Driver> | null = null;
/** Connects once per process and makes sure the schema exists (idempotent, serialized by an advisory lock). */
export function ready(): Promise<Driver> {
  driverP ??= (async () => {
    const d = DATABASE_URL ? await postgresDriver() : await pgliteDriver();
    await d.exec(`BEGIN; SELECT pg_advisory_xact_lock(727274); ${SCHEMA} COMMIT;`);
    return d;
  })().catch((e) => {
    driverP = null;
    throw e;
  });
  return driverP;
}

const txStore = new AsyncLocalStorage<Queryable>();

const sqlCache = new Map<string, string>();
/** `?` → `$n`, ignoring quoted literals. */
function toPg(sql: string) {
  let out = sqlCache.get(sql);
  if (out) return out;
  let n = 0;
  let inStr = false;
  out = '';
  for (const ch of sql) {
    if (ch === "'") inStr = !inStr;
    out += !inStr && ch === '?' ? `$${++n}` : ch;
  }
  sqlCache.set(sql, out);
  return out;
}
const norm = (params: Param[]) => params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));

async function query(sql: string, params: Param[]) {
  const q = txStore.getStore() ?? (await ready()).q;
  return q.query(toPg(sql), norm(params));
}

export async function all<T = Row>(sql: string, ...params: Param[]): Promise<T[]> {
  return (await query(sql, params)).rows as T[];
}
export async function get<T = Row>(sql: string, ...params: Param[]): Promise<T | undefined> {
  return (await query(sql, params)).rows[0] as T | undefined;
}
export async function run(sql: string, ...params: Param[]) {
  const r = await query(sql, params);
  return { changes: r.rowCount ?? r.affectedRows ?? 0 };
}
export async function scalar<T = number>(sql: string, ...params: Param[]): Promise<T> {
  const r = (await query(sql, params)).rows[0];
  return (r ? Object.values(r)[0] : null) as T;
}

// Column/table names below always originate from code (validated, whitelisted
// zod objects), never from raw user input.
const IDENT = /^[a-z_]+$/;
function assertIdent(...names: string[]) {
  for (const n of names) if (!IDENT.test(n)) throw new Error(`Invalid identifier: ${n}`);
}

export async function insert(table: string, values: Record<string, Param>) {
  const keys = Object.keys(values).filter((k) => values[k] !== undefined);
  assertIdent(table, ...keys);
  await run(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, ...keys.map((k) => values[k]));
}

export async function update(table: string, id: string, values: Record<string, Param>) {
  const keys = Object.keys(values).filter((k) => values[k] !== undefined);
  if (!keys.length) return;
  assertIdent(table, ...keys);
  await run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => values[k]), id);
}

/** Runs fn in a transaction; nested calls join the outer transaction. */
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  if (txStore.getStore()) return fn();
  const d = await ready();
  return d.transaction((q) => txStore.run(q, fn));
}
