import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { scalar } from './db.ts';
import { csrfGuard, loadUser, requireAuth } from './lib/auth.ts';
import { streamHandler } from './lib/events.ts';
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

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === '1');

app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/api', csrfGuard, loadUser, (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/stream', requireAuth, streamHandler);
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/projects', projectsRouter);
app.use('/api', tasksRouter, commentsRouter, filesRouter, deliverablesRouter, calendarRouter);
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

// Production: serve the built SPA.
const dist = path.resolve('dist');
if (fs.existsSync(path.join(dist, 'index.html'))) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 50 MB).' : err.code === 'LIMIT_FILE_COUNT' ? 'Too many files (max 10 at a time).' : 'Upload failed.';
    return res.status(400).json({ error: msg });
  }
  if ((err as any)?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed request.' });
  const code = (err as any)?.code as string | undefined;
  if (code?.startsWith('ERR_SQLITE') && /UNIQUE|CONSTRAINT/.test(String((err as any).message)))
    return res.status(409).json({ error: 'This conflicts with existing data.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
});

// First run: production bootstraps a Super Admin from env; development seeds demo data.
if (scalar<number>('SELECT COUNT(*) FROM users') === 0) {
  const { seedDemo, bootstrapAdmin } = await import('./seed.ts');
  if (process.env.BOOTSTRAP_ADMIN_EMAIL && process.env.BOOTSTRAP_ADMIN_PASSWORD) {
    await bootstrapAdmin(process.env.BOOTSTRAP_ADMIN_EMAIL, process.env.BOOTSTRAP_ADMIN_PASSWORD);
  } else if (process.env.NODE_ENV !== 'production' && process.env.SKIP_SEED !== '1') {
    await seedDemo();
  }
}

const PORT = Number(process.env.PORT ?? 4000);
app.listen(PORT, () => console.log(`RIXZA API listening on http://localhost:${PORT}`));
