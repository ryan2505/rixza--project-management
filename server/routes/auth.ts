import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, tx, update } from '../db.ts';
import {
  createAuthToken,
  createSession,
  destroySession,
  destroyUserSessions,
  findAuthToken,
  hashPassword,
  rateLimit,
  requireAuth,
  verifyPassword,
} from '../lib/auth.ts';
import { accessibleProjectIds } from '../lib/access.ts';
import { logActivity, sendEmail } from '../lib/notify.ts';
import { APP_URL, HttpError, now, parse, zEmail, zPassword, zText } from '../lib/util.ts';
import { isStaffRole, type SessionUser } from '../../shared/domain.ts';

export const authRouter = Router();

interface UserRow extends SessionUser {
  password_hash: string | null;
  status: string;
  client_status: string | null;
}

const findUser = (email: string) =>
  get<UserRow>(`SELECT u.*, c.status AS client_status FROM users u LEFT JOIN clients c ON c.id = u.client_id WHERE u.email = ?`, email.toLowerCase());

authRouter.post('/login', async (req, res) => {
  const { email, password } = parse(z.object({ email: zEmail, password: z.string().min(1).max(200) }), req.body);
  rateLimit(`login:${req.ip}:${email}`);
  const user = await findUser(email);
  const ok = await verifyPassword(password, user?.password_hash ?? null);
  if (!user || !ok) throw new HttpError(401, 'The email or password is incorrect.');
  if (user.status === 'suspended' || user.client_status === 'suspended')
    throw new HttpError(403, 'Your access is currently suspended. Please contact your RIXZA project manager.');
  if (user.status !== 'active') throw new HttpError(403, 'Please activate your account using your invitation email.');
  await createSession(res, user.id, req.get('user-agent'));
  res.json({ ok: true });
});

authRouter.post('/logout', async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
});

authRouter.get('/me', async (req, res) => {
  if (!req.user) return res.json({ user: null, projects: [] });
  const ids = await accessibleProjectIds(req.user);
  const projects = ids.length
    ? await all(
        `SELECT p.id, p.name, c.company, p.status FROM projects p JOIN clients c ON c.id = p.client_id
          WHERE p.id IN (${ids.map(() => '?').join(',')}) ORDER BY p.created_at DESC`,
        ...ids,
      )
    : [];
  res.json({ user: req.user, projects });
});

authRouter.patch('/me', requireAuth, async (req, res) => {
  const body = parse(
    z.object({ name: zText(120).optional(), title: z.string().trim().max(120).nullish(), email_notifications: z.boolean().optional() }),
    req.body,
  );
  await update('users', req.user!.id, {
    name: body.name,
    title: body.title === undefined ? undefined : body.title || null,
    email_notifications: body.email_notifications === undefined ? undefined : body.email_notifications ? 1 : 0,
    updated_at: now(),
  });
  res.json({ ok: true });
});

authRouter.post('/password', requireAuth, async (req, res) => {
  const { current, next } = parse(z.object({ current: z.string().min(1), next: zPassword }), req.body);
  const row = (await get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', req.user!.id))!;
  if (!(await verifyPassword(current, row.password_hash))) throw new HttpError(400, 'Your current password is incorrect.');
  const hash = await hashPassword(next);
  await tx(async () => {
    await run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', hash, now(), req.user!.id);
    await destroyUserSessions(req.user!.id);
  });
  await createSession(res, req.user!.id, req.get('user-agent'));
  await logActivity({ projectId: null, actorId: req.user!.id, action: 'user.password_changed', summary: `${req.user!.name} changed their password`, visibility: 'internal' });
  res.json({ ok: true });
});

// ---- Password recovery ----

authRouter.post('/forgot', async (req, res) => {
  const { email } = parse(z.object({ email: zEmail }), req.body);
  rateLimit(`forgot:${req.ip}`, 5);
  const user = await findUser(email);
  // Same response whether or not the account exists.
  if (user && user.status === 'active') {
    const token = await createAuthToken(user.id, 'reset');
    await sendEmail(
      user.email,
      'Reset your RIXZA Client Portal password',
      `Hello ${user.name},\n\nWe received a request to reset your password. This link is valid for 1 hour:\n${APP_URL}/reset/${token}\n\nIf you didn't request this, you can ignore this email.\n\n— RIXZA`,
    );
  }
  res.json({ ok: true });
});

authRouter.post('/reset', async (req, res) => {
  const { token, password } = parse(z.object({ token: z.string().min(10), password: zPassword }), req.body);
  rateLimit(`reset:${req.ip}`);
  const t = await findAuthToken(token, 'reset');
  if (!t) throw new HttpError(400, 'This reset link is invalid or has expired. Please request a new one.');
  const hash = await hashPassword(password);
  await tx(async () => {
    await run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', hash, now(), t.user_id);
    await run('UPDATE auth_tokens SET used_at = ? WHERE id = ?', now(), t.id);
    await destroyUserSessions(t.user_id);
  });
  await logActivity({ projectId: null, actorId: t.user_id, action: 'user.password_reset', summary: 'Password reset via email link', visibility: 'internal' });
  res.json({ ok: true });
});

// ---- Invitation onboarding ----

authRouter.get('/invite/:token', async (req, res) => {
  rateLimit(`invite:${req.ip}`, 30);
  const t = await findAuthToken(req.params.token, 'invite');
  if (!t) throw new HttpError(400, 'This invitation link is invalid or has expired. Please ask RIXZA for a new invitation.');
  res.json(
    await get<{ email: string; name: string; role: string; company: string | null }>(
      `SELECT u.email, u.name, u.role, c.company FROM users u LEFT JOIN clients c ON c.id = u.client_id WHERE u.id = ?`,
      t.user_id,
    ),
  );
});

authRouter.post('/invite/accept', async (req, res) => {
  const body = parse(z.object({ token: z.string().min(10), name: zText(120), password: zPassword }), req.body);
  rateLimit(`invite:${req.ip}`, 30);
  const t = await findAuthToken(body.token, 'invite');
  if (!t) throw new HttpError(400, 'This invitation link is invalid or has expired. Please ask RIXZA for a new invitation.');
  const user = (await get<{ id: string; status: string; client_id: string | null; role: string }>('SELECT id, status, client_id, role FROM users WHERE id = ?', t.user_id))!;
  if (user.status === 'suspended') throw new HttpError(403, 'This account is suspended.');
  const hash = await hashPassword(body.password);
  await tx(async () => {
    await run(`UPDATE users SET name = ?, password_hash = ?, status = 'active', updated_at = ? WHERE id = ?`, body.name, hash, now(), user.id);
    await run('UPDATE auth_tokens SET used_at = ? WHERE id = ?', now(), t.id);
  });
  await logActivity({ projectId: null, actorId: user.id, action: 'user.activated', summary: `${body.name} activated their account`, entityType: user.client_id ? 'client' : 'user', entityId: user.client_id ?? user.id, visibility: 'internal' });
  await createSession(res, user.id, req.get('user-agent'));
  res.json({ ok: true, staff: isStaffRole(user.role as any) });
});
