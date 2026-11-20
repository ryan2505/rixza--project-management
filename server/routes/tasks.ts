import { Router } from 'express';
import { z } from 'zod';
import { all, get, insert, run, scalar, tx, update } from '../db.ts';
import { requireAuth } from '../lib/auth.ts';
import { projectAccess, scopedRow, type Access } from '../lib/access.ts';
import { clientUserIds, logActivity, notify, staffUserIds } from '../lib/notify.ts';
import { syncPhase } from '../lib/progress.ts';
import { badRequest, forbidden, newId, now, parse, zDate, zId, zOptText, zText, zVisibility } from '../lib/util.ts';
import { addMember } from './projects.ts';
import { listComments } from './comments.ts';
import { listFiles } from './files.ts';
import { PRIORITY_LABEL, TASK_STATUS_LABEL, type Task, type TaskStatus } from '../../shared/domain.ts';

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

const DONE: TaskStatus[] = ['approved', 'completed'];
const fmtDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function taskSelect(access: Access, where: string) {
  const cvis = access.caps.staff ? '' : "AND c.visibility = 'client'";
  const fvis = access.caps.staff ? '' : "AND f.visibility = 'client'";
  return `SELECT t.*, u.name AS assignee_name, ph.name AS phase_name,
            (SELECT COUNT(*) FROM comments c WHERE c.task_id = t.id AND c.deleted_at IS NULL ${cvis}) AS comment_count,
            (SELECT COUNT(*) FROM files f WHERE f.task_id = t.id AND f.deleted_at IS NULL ${fvis}) AS attachment_count
       FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id LEFT JOIN phases ph ON ph.id = t.phase_id
      WHERE ${where} ${access.caps.staff ? '' : "AND t.visibility = 'client'"}`;
}

export function getTask(access: Access, id: string) {
  return get<Task>(taskSelect(access, 't.id = ?'), id);
}

tasksRouter.get('/projects/:pid/tasks', (req, res) => {
  const access = projectAccess(req.user!, req.params.pid);
  res.json(all<Task>(`${taskSelect(access, 't.project_id = ?')} ORDER BY t.position`, access.project.id));
});

const taskSchema = z.object({
  title: zText(200),
  description: zOptText(10000),
  phase_id: zId.nullish(),
  status: z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'approved', 'completed']).default('backlog'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  assignee_id: zId.nullish(),
  due_date: zDate.nullish(),
  visibility: zVisibility.default('internal'),
  client_action: z.boolean().default(false),
});

function validateRefs(projectId: string, body: { phase_id?: string | null; assignee_id?: string | null }) {
  if (body.phase_id && !get('SELECT 1 FROM phases WHERE id = ? AND project_id = ?', body.phase_id, projectId)) throw badRequest('Phase does not belong to this project.');
  if (body.assignee_id) {
    const u = get<{ client_id: string | null }>(`SELECT client_id FROM users WHERE id = ? AND status != 'suspended'`, body.assignee_id);
    if (!u || u.client_id) throw badRequest('Tasks can only be assigned to RIXZA team members.');
  }
}

tasksRouter.post('/projects/:pid/tasks', (req, res) => {
  const access = projectAccess(req.user!, req.params.pid);
  if (!access.caps.editTasks) throw forbidden();
  const body = parse(taskSchema, req.body);
  if (body.visibility === 'client' && !access.caps.manage) throw forbidden('Only project managers can share tasks with the client.');
  if (body.client_action && body.visibility !== 'client') throw badRequest('A client action task must be visible to the client.');
  validateRefs(access.project.id, body);
  const id = newId();
  const pos = (scalar<number | null>('SELECT MAX(position) FROM tasks WHERE project_id = ? AND status = ?', access.project.id, body.status) ?? 0) + 1000;
  tx(() => {
    const ts = now();
    insert('tasks', {
      ...body, id, project_id: access.project.id, client_action: body.client_action ? 1 : 0, position: pos,
      created_by: req.user!.id, created_at: ts, updated_at: ts, completed_at: DONE.includes(body.status) ? ts : null,
    });
    addMember(access.project.id, body.assignee_id);
    logActivity({ projectId: access.project.id, actorId: req.user!.id, action: 'task.created', summary: `Task created: ${body.title}`, entityType: 'task', entityId: id, entityLabel: body.title, visibility: body.visibility });
    syncPhase(body.phase_id ?? null, req.user!.id);
  });
  if (body.assignee_id) notify([body.assignee_id], { projectId: access.project.id, type: 'task.assigned', title: `Assigned to you: ${body.title}`, link: `board?task=${id}` }, req.user!.id);
  if (body.client_action)
    notify(clientUserIds(access.project.id), { projectId: access.project.id, type: 'task.client_action', title: `Your input is needed: ${body.title}`, body: body.due_date ? `Requested by ${fmtDate(body.due_date)}.` : null, link: `board?task=${id}` });
  res.status(201).json(getTask(access, id));
});

tasksRouter.get('/tasks/:id', (req, res) => {
  const { access } = scopedRow<Task>(req.user!, 'tasks', req.params.id, 'Task');
  const task = getTask(access, req.params.id)!;
  const history = all(
    `SELECT a.*, u.name AS actor_name FROM activity a LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.entity_type = 'task' AND a.entity_id = ? ${access.caps.staff ? '' : "AND a.visibility = 'client'"}
      ORDER BY a.created_at DESC LIMIT 50`,
    task.id,
  );
  const deliverables = all(
    `SELECT id, title, status, current_version FROM deliverables WHERE task_id = ? ${access.caps.staff ? '' : "AND status != 'draft'"}`,
    task.id,
  );
  res.json({ task, comments: listComments(access, 'task_id', task.id), files: listFiles(access, 'task_id = ?', task.id), history, deliverables });
});

/** Applies a set of task changes, recording each meaningful change as history and
 *  notifying the right people. Used by both PATCH and drag-and-drop moves. */
function applyTaskChanges(access: Access, task: Task, changes: Partial<z.infer<typeof taskSchema>> & { position?: number }, actorId: string) {
  const pid = task.project_id;
  const vis = changes.visibility ?? task.visibility;
  const title = changes.title ?? task.title;
  const clients = vis === 'client' ? clientUserIds(pid) : [];
  const ts = now();
  const statusChanged = changes.status && changes.status !== task.status;
  tx(() => {
    update('tasks', task.id, {
      ...changes,
      client_action: changes.client_action === undefined ? undefined : changes.client_action ? 1 : 0,
      completed_at: statusChanged ? (DONE.includes(changes.status!) ? ts : null) : undefined,
      updated_at: ts,
    });
    const log = (action: string, summary: string, v = vis, meta?: unknown) =>
      logActivity({ projectId: pid, actorId, action, summary, entityType: 'task', entityId: task.id, entityLabel: title, visibility: v, meta });

    if (statusChanged) {
      const to = changes.status!;
      log('task.status', `${title} moved to ${TASK_STATUS_LABEL[to]}`, vis, { from: task.status, to });
      if (to === 'in_review' && (changes.client_action ?? !!task.client_action) && vis === 'client')
        notify(clients, { projectId: pid, type: 'approval.required', title: `Ready for your review: ${title}`, link: `board?task=${task.id}` }, actorId);
      if (DONE.includes(to) && vis === 'client')
        notify(clients, { projectId: pid, type: 'task.completed', title: `${TASK_STATUS_LABEL[to]}: ${title}`, link: `board?task=${task.id}` }, actorId);
      if (access.caps.moveClientReview && !access.caps.staff)
        notify(staffUserIds(pid).concat(task.assignee_id ?? []), { projectId: pid, type: 'task.client_approved', title: `Client approved: ${title}`, link: `board?task=${task.id}` }, actorId);
    }
    if (changes.due_date !== undefined && changes.due_date !== task.due_date) {
      log('task.due_date', changes.due_date ? `Due date for ${title} set to ${fmtDate(changes.due_date)}` : `Due date removed from ${title}`, vis, { from: task.due_date, to: changes.due_date });
      if (changes.due_date) notify(clients, { projectId: pid, type: 'deadline.changed', title: `Deadline updated: ${title}`, body: `Now due ${fmtDate(changes.due_date)}${task.due_date ? ` (was ${fmtDate(task.due_date)})` : ''}.`, link: `board?task=${task.id}` }, actorId);
    }
    if (changes.assignee_id !== undefined && changes.assignee_id !== task.assignee_id) {
      addMember(pid, changes.assignee_id);
      const name = changes.assignee_id ? get<{ name: string }>('SELECT name FROM users WHERE id = ?', changes.assignee_id)?.name : null;
      log('task.assignee', name ? `${title} assigned to ${name}` : `${title} unassigned`, vis);
      if (changes.assignee_id) notify([changes.assignee_id], { projectId: pid, type: 'task.assigned', title: `Assigned to you: ${title}`, link: `board?task=${task.id}` }, actorId);
    }
    if (changes.priority && changes.priority !== task.priority) log('task.priority', `Priority of ${title} set to ${PRIORITY_LABEL[changes.priority]}`, 'internal');
    if (changes.visibility && changes.visibility !== task.visibility)
      log('task.visibility', changes.visibility === 'client' ? `${title} shared with the client` : `${title} made internal`, 'internal');
    if (changes.client_action && !task.client_action && vis === 'client')
      notify(clients, { projectId: pid, type: 'task.client_action', title: `Your input is needed: ${title}`, link: `board?task=${task.id}` }, actorId);
    if ((changes.title && changes.title !== task.title) || (changes.description !== undefined && changes.description !== task.description))
      log('task.edited', `${title} details updated`, 'internal');
    if (changes.phase_id !== undefined && changes.phase_id !== task.phase_id) {
      log('task.phase', `${title} moved to another phase`, 'internal');
      syncPhase(task.phase_id, actorId);
    }
    syncPhase(changes.phase_id === undefined ? task.phase_id : changes.phase_id, actorId);
  });
}

tasksRouter.patch('/tasks/:id', (req, res) => {
  const { row, access } = scopedRow<Task>(req.user!, 'tasks', req.params.id, 'Task');
  if (!access.caps.editTasks) throw forbidden();
  const body = parse(taskSchema.partial(), req.body);
  // zod defaults don't apply on .partial(), but strip undefined explicitly anyway
  Object.keys(body).forEach((k) => (body as any)[k] === undefined && delete (body as any)[k]);
  if ((body.visibility !== undefined || body.client_action !== undefined) && !access.caps.manage)
    throw forbidden('Only project managers can change what the client sees.');
  const vis = body.visibility ?? row.visibility;
  const ca = body.client_action ?? !!row.client_action;
  if (ca && vis !== 'client') throw badRequest('A client action task must be visible to the client.');
  validateRefs(row.project_id, body);
  applyTaskChanges(access, row, body, req.user!.id);
  res.json(getTask(access, row.id));
});

tasksRouter.post('/tasks/:id/move', (req, res) => {
  const { row, access } = scopedRow<Task>(req.user!, 'tasks', req.params.id, 'Task');
  const body = parse(
    z.object({ status: z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'approved', 'completed']), position: z.number().finite() }),
    req.body,
  );
  if (!access.caps.editTasks) {
    // Clients may only sign off their own review tasks: In Review → Approved.
    const allowed = access.caps.moveClientReview && row.client_action && row.visibility === 'client' && row.status === 'in_review' && body.status === 'approved';
    if (!allowed) throw forbidden('You can approve tasks that are waiting for your review. Other changes are handled by your RIXZA team.');
    // Work delivered as a deliverable must be approved formally on the deliverable (versioned approval record).
    if (get(`SELECT 1 FROM deliverables WHERE task_id = ? AND status IN ('submitted','awaiting_feedback','changes_requested')`, row.id))
      throw forbidden('This task is approved through its deliverable. Open the deliverable to approve it or request changes.');
  }
  applyTaskChanges(access, row, { status: body.status, position: body.position }, req.user!.id);
  res.json(getTask(access, row.id));
});

tasksRouter.delete('/tasks/:id', (req, res) => {
  const { row, access } = scopedRow<Task>(req.user!, 'tasks', req.params.id, 'Task');
  if (!access.caps.manage) throw forbidden();
  tx(() => {
    run('DELETE FROM tasks WHERE id = ?', row.id);
    logActivity({ projectId: row.project_id, actorId: req.user!.id, action: 'task.deleted', summary: `Task removed: ${row.title}`, entityType: 'task', entityId: row.id, entityLabel: row.title, visibility: 'internal' });
    syncPhase(row.phase_id, req.user!.id);
  });
  res.json({ ok: true });
});

// RIXZA staff: tasks assigned to me across projects.
tasksRouter.get('/my-tasks', (req, res) => {
  if (req.user!.client_id) throw forbidden();
  res.json(
    all(
      `SELECT t.*, p.name AS project_name FROM tasks t JOIN projects p ON p.id = t.project_id
        WHERE t.assignee_id = ? ORDER BY CASE WHEN t.status IN ('approved','completed') THEN 1 ELSE 0 END, COALESCE(t.due_date,'9999')`,
      req.user!.id,
    ),
  );
});
