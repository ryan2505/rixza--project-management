import { DatabaseSync, type StatementSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA } from './schema.ts';

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const DB_PATH = process.env.DB_PATH ?? path.join(DATA_DIR, 'rixza.db');
export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
db.exec(SCHEMA);

export type Param = string | number | boolean | null | undefined;
type Row = Record<string, any>;

const cache = new Map<string, StatementSync>();
function stmt(sql: string) {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}
const norm = (params: Param[]) =>
  params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));

/** Rows from node:sqlite have a null prototype — spread them into plain objects. */
export function all<T = Row>(sql: string, ...params: Param[]): T[] {
  return (stmt(sql).all(...norm(params)) as Row[]).map((r) => ({ ...r })) as T[];
}
export function get<T = Row>(sql: string, ...params: Param[]): T | undefined {
  const r = stmt(sql).get(...norm(params)) as Row | undefined;
  return r ? ({ ...r } as T) : undefined;
}
export function run(sql: string, ...params: Param[]) {
  return stmt(sql).run(...norm(params));
}
export function scalar<T = number>(sql: string, ...params: Param[]): T {
  const r = stmt(sql).get(...norm(params)) as Row | undefined;
  return (r ? Object.values(r)[0] : null) as T;
}

// Column/table names below always originate from code (validated, whitelisted
// zod objects), never from raw user input.
const IDENT = /^[a-z_]+$/;
function assertIdent(...names: string[]) {
  for (const n of names) if (!IDENT.test(n)) throw new Error(`Invalid identifier: ${n}`);
}

export function insert(table: string, values: Record<string, Param>) {
  const keys = Object.keys(values).filter((k) => values[k] !== undefined);
  assertIdent(table, ...keys);
  run(
    `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
    ...keys.map((k) => values[k]),
  );
}

export function update(table: string, id: string, values: Record<string, Param>) {
  const keys = Object.keys(values).filter((k) => values[k] !== undefined);
  if (!keys.length) return;
  assertIdent(table, ...keys);
  run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => values[k]), id);
}

let depth = 0;
/** Nested-safe transaction using savepoints. */
export function tx<T>(fn: () => T): T {
  const name = `sp_${depth}`;
  db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${name}`);
  depth++;
  try {
    const result = fn();
    depth--;
    db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${name}`);
    return result;
  } catch (e) {
    depth--;
    db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`);
    throw e;
  }
}
