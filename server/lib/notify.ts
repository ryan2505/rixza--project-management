import { all, get, insert } from '../db.ts';
import { APP_URL, newId, now } from './util.ts';
import { broadcastProject, pushToUser } from './events.ts';
import type { Visibility } from '../../shared/domain.ts';

// ---------------- Activity / audit log ----------------

export async function logActivity(a: {
  projectId: string | null;
  actorId: string | null;
  action: string;
  summary: string;
  entityType?: string;
  entityId?: string;
  entityLabel?: string;
  visibility: Visibility;
  meta?: unknown;
}) {
  await insert('activity', {
    id: newId(),
    project_id: a.projectId,
    actor_id: a.actorId,
    action: a.action,
    summary: a.summary,
    entity_type: a.entityType,
    entity_id: a.entityId,
    entity_label: a.entityLabel,
    visibility: a.visibility,
    meta: a.meta === undefined ? null : JSON.stringify(a.meta),
    created_at: now(),
  });
  broadcastProject(a.projectId);
}

// ---------------- Recipients ----------------

/** Active client-side users of the project's client organisation. */
export async function clientUserIds(projectId: string): Promise<string[]> {
  return (
    await all<{ id: string }>(
      `SELECT u.id FROM users u JOIN projects p ON p.client_id = u.client_id
       WHERE p.id = ? AND u.status = 'active'`,
      projectId,
    )
  ).map((r) => r.id);
}

/** Project manager + project members (RIXZA side). */
export async function staffUserIds(projectId: string): Promise<string[]> {
  return (
    await all<{ id: string }>(
      `SELECT u.id FROM users u WHERE u.status = 'active' AND u.client_id IS NULL AND (
         u.id = (SELECT manager_id FROM projects WHERE id = ?)
         OR u.id IN (SELECT user_id FROM project_members WHERE project_id = ?))`,
      projectId,
      projectId,
    )
  ).map((r) => r.id);
}

// ---------------- Notifications ----------------

export interface NotifyInput {
  projectId: string | null;
  type: string;
  title: string;
  body?: string | null;
  /** Project-relative path, e.g. "deliverables/<id>" — resolved per workspace by the UI. */
  link?: string | null;
}

export async function notify(userIds: string[], n: NotifyInput, exceptUserId?: string | null) {
  const unique = [...new Set(userIds)].filter((id) => id && id !== exceptUserId);
  if (!unique.length) return;
  const projectName = n.projectId ? (await get<{ name: string }>('SELECT name FROM projects WHERE id = ?', n.projectId))?.name : null;
  for (const userId of unique) {
    await insert('notifications', {
      id: newId(),
      user_id: userId,
      project_id: n.projectId,
      type: n.type,
      title: n.title,
      body: n.body ?? null,
      link: n.link ?? null,
      created_at: now(),
    });
    pushToUser(userId, 'notification');
    const user = await get<{ email: string; name: string; email_notifications: number; client_id: string | null }>(
      'SELECT email, name, email_notifications, client_id FROM users WHERE id = ?',
      userId,
    );
    if (user?.email_notifications) {
      const prefix = user.client_id ? '' : '/admin';
      const url = n.projectId && n.link ? `${APP_URL}${prefix}/p/${n.projectId}/${n.link}` : `${APP_URL}${prefix}/notifications`;
      await sendEmail(
        user.email,
        `${projectName ? `[${projectName}] ` : ''}${n.title}`,
        `Hello ${user.name},\n\n${n.title}${n.body ? `\n\n${n.body}` : ''}\n\nOpen in the RIXZA Client Portal:\n${url}\n\n— RIXZA\n\nYou can turn off email updates in your account settings.`,
      );
    }
  }
}

// ---------------- Email channel ----------------
// Every email is persisted to the outbox (visible to admins). Plug an SMTP/API
// transport into deliver() to send for real — the rest of the app is unaffected.

function deliver(to: string, subject: string, _body: string) {
  if (process.env.EMAIL_LOG !== 'off') console.log(`[email] → ${to}: ${subject}`);
}

export async function sendEmail(to: string, subject: string, body: string) {
  await insert('email_outbox', { id: newId(), to_email: to, subject, body, created_at: now() });
  deliver(to, subject, body);
}
