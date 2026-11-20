import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { Request, Response, NextFunction } from 'express';
import { get, insert, run } from '../db.ts';
import { HttpError, newId, now, randomToken, sha256 } from './util.ts';
import { can, isStaffRole, type GlobalPermission, type SessionUser } from '../../shared/domain.ts';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string | null) {
  // Always do the work, even for unknown users, to avoid timing-based user enumeration.
  const [, saltHex, hashHex] = (stored ?? 'scrypt$00$00').split('$');
  const expected = Buffer.from(hashHex ?? '', 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex ?? '', 'hex'), 64);
  return stored != null && expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export const SESSION_COOKIE = 'rixza_session';
const SESSION_DAYS = 14;
const isProd = process.env.NODE_ENV === 'production';

export function createSession(res: Response, userId: string, userAgent?: string) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  insert('sessions', { id: sha256(token), user_id: userId, created_at: now(), expires_at: expires.toISOString(), user_agent: userAgent?.slice(0, 300) });
  run('UPDATE users SET last_login_at = ? WHERE id = ?', now(), userId);
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: isProd, expires, path: '/' });
}

export function destroySession(req: Request, res: Response) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) run('DELETE FROM sessions WHERE id = ?', sha256(token));
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function destroyUserSessions(userId: string) {
  run('DELETE FROM sessions WHERE user_id = ?', userId);
}

/** Resolves the session cookie to an *active* user. Suspended users or suspended
 *  client organisations are rejected on every request, not just at login. */
export function loadUser(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    const user = get<SessionUser>(
      `SELECT u.id, u.email, u.name, u.title, u.role, u.client_id, u.email_notifications
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN clients c ON c.id = u.client_id
        WHERE s.id = ? AND s.expires_at > ? AND u.status = 'active'
          AND (u.client_id IS NULL OR c.status = 'active')`,
      sha256(token),
      now(),
    );
    if (user) req.user = user;
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Please sign in to continue.'));
  next();
}

export function requireStaff(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Please sign in to continue.'));
  if (!isStaffRole(req.user.role)) return next(new HttpError(403, 'This area is reserved for the RIXZA team.'));
  next();
}

export const requirePermission = (perm: GlobalPermission) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(new HttpError(401, 'Please sign in to continue.'));
  if (!can(req.user.role, perm)) return next(new HttpError(403, 'You do not have permission to perform this action.'));
  next();
};

/** Mutating requests must carry a custom header. Browsers cannot add it cross-site
 *  without a CORS preflight (which we never grant), so this blocks CSRF. */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'rixza') return next(new HttpError(403, 'Invalid request origin.'));
  next();
}

// ---- One-time tokens (invitations & password resets) ----

export function createAuthToken(userId: string, kind: 'invite' | 'reset') {
  const token = randomToken();
  const ttlHours = kind === 'invite' ? 24 * 7 : 1;
  // Only one live token per user & kind.
  run('UPDATE auth_tokens SET used_at = ? WHERE user_id = ? AND kind = ? AND used_at IS NULL', now(), userId, kind);
  insert('auth_tokens', {
    id: newId(),
    user_id: userId,
    kind,
    token_hash: sha256(token),
    expires_at: new Date(Date.now() + ttlHours * 3600e3).toISOString(),
    created_at: now(),
  });
  return token;
}

export function findAuthToken(token: string, kind: 'invite' | 'reset') {
  return get<{ id: string; user_id: string }>(
    'SELECT id, user_id FROM auth_tokens WHERE token_hash = ? AND kind = ? AND used_at IS NULL AND expires_at > ?',
    sha256(token),
    kind,
    now(),
  );
}

// ---- Naive in-memory rate limiter for auth endpoints ----
const attempts = new Map<string, { count: number; reset: number }>();
export function rateLimit(key: string, max = 10, windowMs = 15 * 60e3) {
  const t = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.reset < t) {
    attempts.set(key, { count: 1, reset: t + windowMs });
    return;
  }
  entry.count++;
  if (entry.count > max) throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');
}
