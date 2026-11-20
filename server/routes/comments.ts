import { Router } from 'express';
import { z } from 'zod';
import { all, get, insert, run, tx, update } from '../db.ts';
import { requireAuth } from '../lib/auth.ts';
import { projectAccess, scopedRow, type Access } from '../lib/access.ts';
import { clientUserIds, logActivity, notify } from '../lib/notify.ts';
import { badRequest, forbidden, newId, notFound, now, parse, zId, zText, zVisibility } from '../lib/util.ts';
import { isAdminRole, type Comment, type FileItem, type Thread, type Visibility } from '../../shared/domain.ts';

export const commentsRouter = Router();
commentsRouter.use(requireAuth);

type TargetCol = 'task_id' | 'thread_id' | 'deliverable_id';
const P = (v: unknown) => String(v);

export async function listComments(access: Access, col: TargetCol, id: string): Promise<Comment[]> {
  const vis = access.caps.staff ? '' : "AND c.visibility = 'client'";
  const rows = await all<Comment>(
    `SELECT c.*, u.name AS author_name, u.role AS author_role FROM comments c JOIN users u ON u.id = c.author_id
      WHERE c.${col} = ? ${vis} ORDER BY c.created_at ASC`,
    id,
  );
  const files = rows.length
    ? await all<FileItem>(
        `SELECT f.*, u.name AS uploader_name FROM files f LEFT JOIN users u ON u.id = f.uploaded_by
          WHERE f.comment_id IN (${rows.map(() => '?').join(',')}) AND f.deleted_at IS NULL`,
        ...rows.map((r) => r.id),
      )
    : [];
  return rows.map((c) => (c.deleted_at ? { ...c, body: '', files: [] } : { ...c, files: files.filter((f) => f.comment_id === c.id) }));
}

// ---------------- Project discussions (threads) ----------------

commentsRouter.get('/projects/:pid/threads', async (req, res) => {
  const access = await projectAccess(req.user!, P(req.params.pid));
  const vis = access.caps.staff ? '' : "AND t.visibility = 'client'";
  res.json(
    await all<Thread>(
      `SELECT t.*, u.name AS creator_name,
              (SELECT COUNT(*) FROM comments c WHERE c.thread_id = t.id AND c.deleted_at IS NULL) AS comment_count,
              (SELECT c.body FROM comments c WHERE c.thread_id = t.id AND c.deleted_at IS NULL ORDER BY c.created_at DESC LIMIT 1) AS last_comment
         FROM threads t JOIN users u ON u.id = t.created_by
        WHERE t.project_id = ? ${vis} ORDER BY t.last_activity_at DESC`,
      access.project.id,
    ),
  );
});

commentsRouter.post('/projects/:pid/threads', async (req, res) => {
  const access = await projectAccess(req.user!, P(req.params.pid));
  const body = parse(z.object({ title: zText(200), body: zText(10000), visibility: zVisibility.optional(), file_ids: z.array(zId).max(10).default([]) }), req.body);
  // Staff threads default to Internal Only — sharing with the client must be explicit.
  const visibility: Visibility = access.caps.staff ? (body.visibility ?? 'internal') : 'client';
  if (!access.caps.staff && body.visibility === 'internal') throw forbidden();
  const id = newId();
  const ts = now();
  await tx(async () => {
    await insert('threads', { id, project_id: access.project.id, title: body.title, visibility, created_by: req.user!.id, created_at: ts, updated_at: ts, last_activity_at: ts });
    await createComment(access, { col: 'thread_id', id, label: body.title, link: `discussions/${id}`, visibility }, { body: body.body, file_ids: body.file_ids }, true);
  });
  res.status(201).json({ id });
});

commentsRouter.get('/threads/:id', async (req, res) => {
  const { row, access } = await scopedRow<Thread>(req.user!, 'threads', P(req.params.id), 'Discussion');
  const thread = await get<Thread>('SELECT t.*, u.name AS creator_name FROM threads t JOIN users u ON u.id = t.created_by WHERE t.id = ?', row.id);
  res.json({ thread, comments: await listComments(access, 'thread_id', row.id) });
});

// ---------------- Comments ----------------

interface Target {
  col: TargetCol;
  id: string;
  label: string;
  link: string;
  visibility: Visibility;
  choose?: boolean;
  assigneeId?: string | null;
  notifyAllClients?: boolean;
}

async function resolveTarget(access: Access, kind: 'task' | 'thread' | 'deliverable', id: string): Promise<Target> {
  if (kind === 'task') {
    const t = await get<any>('SELECT * FROM tasks WHERE id = ? AND project_id = ?', id, access.project.id);
    if (!t || (!access.caps.staff && t.visibility !== 'client')) throw notFound('Task');
    return { col: 'task_id', id, label: t.title, link: `board?task=${id}`, visibility: t.visibility, choose: t.visibility === 'client', assigneeId: t.assignee_id, notifyAllClients: !!t.client_action };
  }
  if (kind === 'thread') {
    const t = await get<any>('SELECT * FROM threads WHERE id = ? AND project_id = ?', id, access.project.id);
    if (!t || (!access.caps.staff && t.visibility !== 'client')) throw notFound('Discussion');
    // A thread has one audience; internal notes never mix into a client thread.
    return { col: 'thread_id', id, label: t.title, link: `discussions/${id}`, visibility: t.visibility, notifyAllClients: true };
  }
  const d = await get<any>('SELECT * FROM deliverables WHERE id = ? AND project_id = ?', id, access.project.id);
  if (!d || (!access.caps.staff && d.status === 'draft')) throw notFound('Deliverable');
  return { col: 'deliverable_id', id, label: d.title, link: `deliverables/${id}`, visibility: d.status === 'draft' ? 'internal' : 'client', choose: d.status !== 'draft', notifyAllClients: true };
}

async function mentionedUserIds(projectId: string, body: string, visibility: Visibility): Promise<string[]> {
  if (!body.includes('@')) return [];
  const people = await all<{ id: string; name: string; client_id: string | null }>(
    `SELECT u.id, u.name, u.client_id FROM users u WHERE u.status = 'active' AND (
        u.client_id = (SELECT client_id FROM projects WHERE id = ?)
        OR u.id = (SELECT manager_id FROM projects WHERE id = ?)
        OR u.id IN (SELECT user_id FROM project_members WHERE project_id = ?))`,
    projectId, projectId, projectId,
  );
  return people.filter((p) => body.includes(`@${p.name}`)).filter((p) => (visibility === 'internal' ? !p.client_id : true)).map((p) => p.id);
}

async function createComment(access: Access, target: Target, input: { body: string; parent_id?: string | null; visibility?: Visibility; file_ids: string[] }, isThreadOpener = false) {
  const pid = access.project.id;
  let visibility: Visibility = target.visibility;
  // Staff must explicitly pick the audience for comments on shared items.
  if (access.caps.staff && target.choose) visibility = input.visibility ?? 'internal';
  if (!access.caps.staff) {
    if (input.visibility === 'internal') throw forbidden();
    visibility = 'client';
    if (target.visibility !== 'client') throw notFound();
  }
  if (input.parent_id) {
    const parent = await get<any>(`SELECT * FROM comments WHERE id = ? AND ${target.col} = ?`, input.parent_id, target.id);
    if (!parent || (!access.caps.staff && parent.visibility !== 'client')) throw badRequest('The comment you are replying to no longer exists.');
    if (parent.visibility !== visibility) throw badRequest('Replies must keep the same audience as the original comment.');
  }
  const id = newId();
  const ts = now();
  await tx(async () => {
    await insert('comments', { id, project_id: pid, [target.col]: target.id, parent_id: input.parent_id ?? null, author_id: access.user.id, body: input.body, visibility, created_at: ts });
    for (const fid of input.file_ids) {
      const f = await get<any>('SELECT * FROM files WHERE id = ? AND project_id = ? AND uploaded_by = ? AND comment_id IS NULL AND deleted_at IS NULL', fid, pid, access.user.id);
      if (!f) throw badRequest('Attachment not found.');
      await run('UPDATE files SET comment_id = ?, visibility = ?, task_id = COALESCE(task_id, ?) WHERE id = ?', id, visibility, target.col === 'task_id' ? target.id : null, fid);
    }
    if (target.col === 'thread_id') await run('UPDATE threads SET last_activity_at = ?, updated_at = ? WHERE id = ?', ts, ts, target.id);
    const what = target.col === 'task_id' ? 'task' : target.col === 'thread_id' ? 'discussion' : 'deliverable';
    await logActivity({
      projectId: pid,
      actorId: access.user.id,
      action: isThreadOpener ? 'thread.created' : 'comment.created',
      summary: isThreadOpener ? `${access.user.name} started a discussion: ${target.label}` : `${access.user.name} commented on ${what} “${target.label}”`,
      entityType: target.col.replace('_id', ''),
      entityId: target.id,
      entityLabel: target.label,
      visibility,
    });
  });

  // --- notifications: participants, assignee, PM, mentions — respecting audience ---
  const prior = await all<{ author_id: string; client_id: string | null }>(
    `SELECT DISTINCT c.author_id, u.client_id FROM comments c JOIN users u ON u.id = c.author_id
      WHERE c.${target.col} = ? AND c.deleted_at IS NULL ${visibility === 'internal' ? '' : "AND c.visibility = 'client'"}`,
    target.id,
  );
  const clients = await clientUserIds(pid);
  const recipients = new Set<string>();
  prior.forEach((p) => (visibility === 'client' || !p.client_id) && recipients.add(p.author_id));
  if (access.project.manager_id) recipients.add(access.project.manager_id);
  if (target.assigneeId) recipients.add(target.assigneeId);
  if (visibility === 'client' && access.caps.staff && (target.notifyAllClients || !prior.some((p) => p.client_id))) clients.forEach((u) => recipients.add(u));
  const mentions = await mentionedUserIds(pid, input.body, visibility);
  mentions.forEach((m) => recipients.add(m));
  // Final guard: internal comments never reach client users.
  const clientSet = new Set(clients);
  const final = [...recipients].filter((u) => visibility === 'client' || !clientSet.has(u));
  await notify(
    final,
    {
      projectId: pid,
      type: mentions.length ? 'comment.mention' : 'comment.created',
      title: isThreadOpener ? `${access.user.name} started a discussion: ${target.label}` : `${access.user.name} commented on “${target.label}”`,
      body: input.body.length > 180 ? `${input.body.slice(0, 177)}…` : input.body,
      link: target.link,
    },
    access.user.id,
  );
  return id;
}

commentsRouter.post('/projects/:pid/comments', async (req, res) => {
  const access = await projectAccess(req.user!, P(req.params.pid));
  const body = parse(
    z.object({
      target: z.enum(['task', 'thread', 'deliverable']),
      target_id: zId,
      body: zText(10000),
      parent_id: zId.nullish(),
      visibility: zVisibility.optional(),
      file_ids: z.array(zId).max(10).default([]),
    }),
    req.body,
  );
  const target = await resolveTarget(access, body.target, body.target_id);
  const id = await createComment(access, target, body);
  res.status(201).json({ id });
});

commentsRouter.patch('/comments/:id', async (req, res) => {
  const { row } = await scopedRow<any>(req.user!, 'comments', P(req.params.id), 'Comment');
  if (row.author_id !== req.user!.id) throw forbidden('You can only edit your own comments.');
  if (row.deleted_at) throw badRequest('This comment was deleted.');
  const { body } = parse(z.object({ body: zText(10000) }), req.body);
  await update('comments', row.id, { body, edited_at: now() });
  await logActivity({ projectId: row.project_id, actorId: req.user!.id, action: 'comment.edited', summary: `${req.user!.name} edited a comment`, entityType: 'comment', entityId: row.id, visibility: 'internal' });
  res.json({ ok: true });
});

commentsRouter.delete('/comments/:id', async (req, res) => {
  const { row } = await scopedRow<any>(req.user!, 'comments', P(req.params.id), 'Comment');
  if (row.author_id !== req.user!.id && !isAdminRole(req.user!.role)) throw forbidden('You can only delete your own comments.');
  await update('comments', row.id, { deleted_at: now() });
  await run('UPDATE files SET deleted_at = ? WHERE comment_id = ?', now(), row.id);
  await logActivity({ projectId: row.project_id, actorId: req.user!.id, action: 'comment.deleted', summary: `${req.user!.name} deleted a comment`, entityType: 'comment', entityId: row.id, visibility: 'internal', meta: { body: row.body } });
  res.json({ ok: true });
});
