import { Router } from 'express';
import { z } from 'zod';
import { get, run, tx, update } from '../db.ts';
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
  get<UserRow>(
    `SELECT u.*, c.status AS client_status FROM users u LEFT JOIN clients c ON c.id = u.client_id WHERE u.email = ?`,
    email,
  );

authRouter.post('/login', async (req, res) => {
  const { email, password } = parse(z.object({ email: zEmail, password: z.string().min(1).max(200) }), req.body);
  rateLimit(`login:${req.ip}:${email}`);
  const user = findUser(email);
  const ok = await verifyPassword(password, user?.password_hash ?? null);
  if (!user || !ok) throw new HttpError(401, 'The email or password is incorrect.');
  if (user.status === 'suspended' || user.client_status === 'suspended')
    throw new HttpError(403, 'Your access is currently suspended. Please contact your RIXZA project manager.');
  if (user.status !== 'active') throw new HttpError(403, 'Please activate your account using your invitation email.');
  createSession(res, user.id, req.get('user-agent'));
  res.json({ ok: true });
});

authRouter.post('/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

authRouter.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null, projects: [] });
  const ids = accessibleProjectIds(req.user);
  const projects = ids.length
    ? (
        get<{ j: string }>(
          `SELECT json_group_array(json_object('id', p.id, 'name', p.name, 'company', c.company, 'status', p.status)) AS j
             FROM (SELECT * FROM projects WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at DESC) p
             JOIN clients c ON c.id = p.client_id`,
          ...ids,
        )?.j ?? '[]'
      )
    : '[]';
  res.json({ user: req.user, projects: JSON.parse(projects) });
});

authRouter.patch('/me', requireAuth, (req, res) => {
  const body = parse(
    z.object({
      name: zText(120).optional(),
      title: z.string().trim().max(120).nullish(),
      email_notifications: z.boolean().optional(),
    }),
    req.body,
  );
  update('users', req.user!.id, {
    name: body.name,
    title: body.title === undefined ? undefined : body.title || null,
    email_notifications: body.email_notifications === undefined ? undefined : body.email_notifications ? 1 : 0,
    updated_at: now(),
  });
  res.json({ ok: true });
});

authRouter.post('/password', requireAuth, async (req, res) => {
  const { current, next } = parse(z.object({ current: z.string().min(1), next: zPassword }), req.body);
  const row = get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', req.user!.id)!;
  if (!(await verifyPassword(current, row.password_hash))) throw new HttpError(400, 'Your current password is incorrect.');
  const hash = await hashPassword(next);
  tx(() => {
    run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', hash, now(), req.user!.id);
    destroyUserSessions(req.user!.id);
  });
  createSession(res, req.user!.id, req.get('user-agent'));
  logActivity({ projectId: null, actorId: req.user!.id, action: 'user.password_changed', summary: `${req.user!.name} changed their password`, visibility: 'internal' });
  res.json({ ok: true });
});

// ---- Password recovery ----

authRouter.post('/forgot', (req, res) => {
  const { email } = parse(z.object({ email: zEmail }), req.body);
  rateLimit(`forgot:${req.ip}`, 5);
  const user = findUser(email);
  // Same response whether or not the account exists.
  if (user && user.status === 'active') {
    const token = createAuthToken(user.id, 'reset');
    sendEmail(
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
  const t = findAuthToken(token, 'reset');
  if (!t) throw new HttpError(400, 'This reset link is invalid or has expired. Please request a new one.');
  const hash = await hashPassword(password);
  tx(() => {
    run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', hash, now(), t.user_id);
    run('UPDATE auth_tokens SET used_at = ? WHERE id = ?', now(), t.id);
    destroyUserSessions(t.user_id);
  });
  logActivity({ projectId: null, actorId: t.user_id, action: 'user.password_reset', summary: 'Password reset via email link', visibility: 'internal' });
  res.json({ ok: true });
});

// ---- Invitation onboarding ----

authRouter.get('/invite/:token', (req, res) => {
  rateLimit(`invite:${req.ip}`, 30);
  const t = findAuthToken(req.params.token, 'invite');
  if (!t) throw new HttpError(400, 'This invitation link is invalid or has expired. Please ask RIXZA for a new invitation.');
  const u = get<{ email: string; name: string; role: string; company: string | null }>(
    `SELECT u.email, u.name, u.role, c.company FROM users u LEFT JOIN clients c ON c.id = u.client_id WHERE u.id = ?`,
    t.user_id,
  )!;
  res.json(u);
});

authRouter.post('/invite/accept', async (req, res) => {
  const body = parse(z.object({ token: z.string().min(10), name: zText(120), password: zPassword }), req.body);
  rateLimit(`invite:${req.ip}`, 30);
  const t = findAuthToken(body.token, 'invite');
  if (!t) throw new HttpError(400, 'This invitation link is invalid or has expired. Please ask RIXZA for a new invitation.');
  const user = get<{ id: string; status: string; client_id: string | null; role: string }>('SELECT id, status, client_id, role FROM users WHERE id = ?', t.user_id)!;
  if (user.status === 'suspended') throw new HttpError(403, 'This account is suspended.');
  const hash = await hashPassword(body.password);
  tx(() => {
    run(`UPDATE users SET name = ?, password_hash = ?, status = 'active', updated_at = ? WHERE id = ?`, body.name, hash, now(), user.id);
    run('UPDATE auth_tokens SET used_at = ? WHERE id = ?', now(), t.id);
  });
  logActivity({ projectId: null, actorId: user.id, action: 'user.activated', summary: `${body.name} activated their account`, entityType: user.client_id ? 'client' : 'user', entityId: user.client_id ?? user.id, visibility: 'internal' });
  createSession(res, user.id, req.get('user-agent'));
  res.json({ ok: true, staff: isStaffRole(user.role as any) });
});
