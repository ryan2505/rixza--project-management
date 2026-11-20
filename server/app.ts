import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { ready, scalar } from './db.ts';
import { csrfGuard, loadUser, requireAuth } from './lib/auth.ts';
import { streamHandler } from './lib/events.ts';
import { MAX_UPLOAD_BYTES } from './lib/storage.ts';
import { HttpError } from './lib/util.ts';
import { authRouter } from './routes/auth.ts';
import { adminRouter } from './routes/admin.ts';
import { projectsRouter } from './routes/projects.ts';
import { tasksRouter } from './routes/tasks.ts';
import { commentsRouter } from './routes/comments.ts';
import { filesRouter } from './routes/files.ts';
import { deliverablesRouter } from './routes/deliverables.ts';
import { calendarRouter } from './routes/calendar.ts';
import { notificationsRouter } from './routes/notifications.ts';

/** Connects to the database, creates the schema and — on an empty database —
 *  bootstraps the first Super Admin (env) or demo data (dev / SEED_DEMO=1). */
let initP: Promise<void> | null = null;
export function initialize() {
  initP ??= (async () => {
    await ready();
    if ((await scalar<number>('SELECT COUNT(*) FROM users')) > 0) return;
    const { seedDemo, bootstrapAdmin } = await import('./seed.ts');
    if (process.env.BOOTSTRAP_ADMIN_EMAIL && process.env.BOOTSTRAP_ADMIN_PASSWORD) {
      await bootstrapAdmin(process.env.BOOTSTRAP_ADMIN_EMAIL, process.env.BOOTSTRAP_ADMIN_PASSWORD);
    } else if (process.env.SEED_DEMO === '1' || (process.env.NODE_ENV !== 'production' && !process.env.VERCEL && process.env.SKIP_SEED !== '1')) {
      await seedDemo();
    }
  })().catch((e) => {
    initP = null;
    throw e;
  });
  return initP;
}

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === '1' || !!process.env.VERCEL);

app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  next();
});
/** Deployment diagnostics — reports configuration problems without exposing secrets. */
app.get('/api/health', async (_req, res) => {
  const env = process.env;
  const dbUrl = env.DATABASE_URL ?? env.POSTGRES_URL ?? '';
  let host = '';
  let port = '';
  try {
    if (dbUrl) ({ hostname: host, port } = new URL(dbUrl));
  } catch {
    host = 'INVALID URL — URL-encode special characters in the password';
  }
  const config = {
    platform: env.VERCEL ? 'vercel' : 'node',
    database_url: dbUrl ? `set (host ${host}${port ? `:${port}` : ''})` : 'MISSING',
    supabase_storage: env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY ? 'configured' : 'MISSING (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)',
    bootstrap_admin: env.BOOTSTRAP_ADMIN_EMAIL && env.BOOTSTRAP_ADMIN_PASSWORD ? 'set' : 'not set',
    app_url: env.APP_URL ?? '(default)',
  };
  const hints: string[] = [];
  if (/^db\.[a-z0-9]+\.supabase\.co$/.test(host))
    hints.push('You are using the direct connection (IPv6 only, unreachable from Vercel). Use the "Transaction pooler" URL (…pooler.supabase.com:6543).');
  try {
    await initialize();
    const users = await scalar<number>('SELECT COUNT(*) FROM users');
    if (users === 0) hints.push('Database is empty: set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD (or SEED_DEMO=1), then redeploy.');
    res.json({ ok: true, database: 'connected', users, ...config, hints });
  } catch (e) {
    const err = e as any;
    res.status(500).json({ ok: false, database: `ERROR: ${err?.code ? `${err.code} ` : ''}${String(err?.message ?? e).slice(0, 300)}`, ...config, hints });
  }
});

app.use('/api', async (_req, _res, next) => {
  await initialize();
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/api', csrfGuard, loadUser, (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.get('/api/stream', requireAuth, streamHandler);
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/projects', projectsRouter);
app.use('/api', tasksRouter, commentsRouter, filesRouter, deliverablesRouter, calendarRouter);
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
  if (err instanceof multer.MulterError) {
    const msg =
      err.code === 'LIMIT_FILE_SIZE'
        ? `File is too large (max ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB).`
        : err.code === 'LIMIT_FILE_COUNT'
          ? 'Too many files (max 10 at a time).'
          : 'Upload failed.';
    return res.status(400).json({ error: msg });
  }
  if ((err as any)?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed request.' });
  // Postgres: unique / foreign-key / check violations
  if (['23505', '23503', '23514'].includes((err as any)?.code)) return res.status(409).json({ error: 'This conflicts with existing data.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
}
