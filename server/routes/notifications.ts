import { Router } from 'express';
import { all, get, run } from '../db.ts';
import { requireAuth } from '../lib/auth.ts';
import { notFound, now } from '../lib/util.ts';
import type { Notification } from '../../shared/domain.ts';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get('/', async (req, res) => {
  const unread = req.query.unread === '1';
  const before = typeof req.query.before === 'string' ? req.query.before : null;
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  res.json(
    await all<Notification>(
      `SELECT n.*, p.name AS project_name FROM notifications n LEFT JOIN projects p ON p.id = n.project_id
        WHERE n.user_id = ? ${unread ? 'AND n.read_at IS NULL' : ''} AND (?::text IS NULL OR n.created_at < ?)
        ORDER BY n.created_at DESC LIMIT ?`,
      req.user!.id, before, before, limit,
    ),
  );
});

notificationsRouter.get('/count', async (req, res) => {
  res.json({ unread: (await get<{ n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', req.user!.id))!.n });
});

notificationsRouter.post('/read-all', async (req, res) => {
  await run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', now(), req.user!.id);
  res.json({ ok: true });
});

notificationsRouter.post('/:id/read', async (req, res) => {
  const r = await run('UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?', now(), req.params.id, req.user!.id);
  if (!r.changes) throw notFound('Notification');
  res.json({ ok: true });
});
