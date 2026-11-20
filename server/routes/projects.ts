import { Router } from 'express';
import { z } from 'zod';
import { all, get, insert, run, scalar, tx, update } from '../db.ts';
import { requireAuth, requirePermission } from '../lib/auth.ts';
import { accessibleProjectIds, projectAccess, scopedRow, type Access } from '../lib/access.ts';
import { clientUserIds, logActivity, notify, staffUserIds } from '../lib/notify.ts';
import { activityFeed, phasesWithProgress, projectOverview, projectProgress, setPhaseStatus } from '../lib/progress.ts';
import { badRequest, forbidden, newId, now, parse, zDate, zId, zOptText, zText, zVisibility } from '../lib/util.ts';
import type { Milestone, ProjectDetail, TemplateDefinition, UserSummary } from '../../shared/domain.ts';

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

const addDays = (d: string, n: number) => {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};
const fmtDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const P = (v: unknown) => String(v);

export function requireManage(access: Access) {
  if (!access.caps.manage) throw forbidden();
}

export async function addMember(projectId: string, userId: string | null | undefined) {
  if (!userId) return;
  const u = await get<{ client_id: string | null }>('SELECT client_id FROM users WHERE id = ?', userId);
  if (!u || u.client_id) return; // only RIXZA staff become project members
  await run('INSERT INTO project_members (project_id, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', projectId, userId, now());
}

async function assertStaffUser(userId: string | null | undefined) {
  if (!userId) return;
  const u = await get<{ client_id: string | null }>('SELECT client_id FROM users WHERE id = ?', userId);
  if (!u || u.client_id) throw badRequest('Assignee must be a member of the RIXZA team.');
}

/** Lays template phases out sequentially between start and (optional) due date,
 *  scaling durations to fit, with milestones at each phase end. */
export async function instantiateTemplate(projectId: string, def: TemplateDefinition, start: string, due: string | null, managerId: string | null, creatorId: string) {
  const ts = now();
  const total = def.phases.reduce((s, p) => s + p.durationDays, 0);
  const span = due ? Math.max(def.phases.length, (Date.parse(due) - Date.parse(start)) / 864e5 + 1) : total;
  const scale = span / total;
  let cursor = start;
  for (const [i, p] of def.phases.entries()) {
    const days = Math.max(1, Math.round(p.durationDays * scale));
    const end = i === def.phases.length - 1 && due ? due : addDays(cursor, days - 1);
    const phaseId = newId();
    await insert('phases', { id: phaseId, project_id: projectId, name: p.name, description: p.description ?? null, position: i, start_date: cursor, end_date: end, status: 'upcoming', owner_id: managerId, created_at: ts, updated_at: ts });
    for (const [j, t] of p.tasks.entries()) {
      await insert('tasks', {
        id: newId(), project_id: projectId, phase_id: phaseId, title: t.title, description: t.description ?? null,
        status: i === 0 ? 'todo' : 'backlog', priority: t.priority ?? 'medium', visibility: t.visibility,
        client_action: t.client_action ? 1 : 0, position: (i + 1) * 1000 + j, created_by: creatorId, created_at: ts, updated_at: ts,
      });
    }
    for (const m of p.milestones)
      await insert('milestones', { id: newId(), project_id: projectId, phase_id: phaseId, title: m.title, description: m.description ?? null, due_date: end, status: 'pending', visibility: 'client', created_at: ts, updated_at: ts });
    cursor = addDays(end, 1);
  }
}

// ---------------- Projects ----------------

projectsRouter.get('/', async (req, res) => {
  const ids = await accessibleProjectIds(req.user!);
  if (!ids.length) return res.json([]);
  const staff = !req.user!.client_id;
  const rows = await all<any>(
    `SELECT p.id, p.name, p.type, p.status, ${staff ? 'p.health,' : ''} p.client_id, c.company AS client_company,
            u.name AS manager_name, p.start_date, p.due_date
       FROM projects p JOIN clients c ON c.id = p.client_id LEFT JOIN users u ON u.id = p.manager_id
      WHERE p.id IN (${ids.map(() => '?').join(',')}) ORDER BY p.created_at DESC`,
    ...ids,
  );
  res.json(await Promise.all(rows.map(async (r) => ({ ...r, progress: (await projectProgress(r.id)).progress }))));
});

const projectCreateSchema = z.object({
  client_id: zId,
  name: zText(160),
  type: zText(120),
  description: zOptText(5000),
  manager_id: zId.nullish(),
  start_date: zDate,
  due_date: zDate.nullish(),
  template_id: zId.nullish(),
  member_ids: z.array(zId).max(50).default([]),
});

projectsRouter.post('/', requirePermission('projects.create'), async (req, res) => {
  const body = parse(projectCreateSchema, req.body);
  if (!(await get('SELECT 1 FROM clients WHERE id = ?', body.client_id))) throw badRequest('Client not found.');
  if (body.due_date && body.due_date < body.start_date) throw badRequest('The expected completion date must be after the start date.');
  await assertStaffUser(body.manager_id);
  const manager = body.manager_id ?? (req.user!.role === 'project_manager' ? req.user!.id : null);
  const template = body.template_id ? await get<{ id: string; definition: string; name: string }>('SELECT * FROM templates WHERE id = ?', body.template_id) : null;
  if (body.template_id && !template) throw badRequest('Template not found.');

  const id = newId();
  await tx(async () => {
    const ts = now();
    await insert('projects', {
      id, client_id: body.client_id, name: body.name, type: body.type, description: body.description, manager_id: manager,
      start_date: body.start_date, due_date: body.due_date ?? null, status: 'onboarding', health: 'on_track', template_id: template?.id ?? null, created_at: ts, updated_at: ts,
    });
    for (const m of body.member_ids) await addMember(id, m);
    await addMember(id, manager);
    if (manager !== req.user!.id && req.user!.role === 'project_manager') await addMember(id, req.user!.id);
    if (template) await instantiateTemplate(id, JSON.parse(template.definition), body.start_date, body.due_date ?? null, manager, req.user!.id);
    await logActivity({ projectId: id, actorId: req.user!.id, action: 'project.created', summary: `Project workspace created${template ? ` from the ${template.name} template` : ''}`, entityType: 'project', entityId: id, entityLabel: body.name, visibility: 'client' });
  });
  await notify(await clientUserIds(id), { projectId: id, type: 'project.created', title: `Your workspace for ${body.name} is ready`, body: 'Follow progress, review deliverables and talk with your RIXZA team here.', link: 'overview' });
  res.status(201).json({ id });
});

async function projectDetail(access: Access): Promise<ProjectDetail> {
  const p = access.project;
  const project: any = { ...p };
  if (!access.caps.staff) {
    delete project.health;
    delete project.internal_notes;
    delete project.template_id;
  }
  return {
    project,
    client: (await get('SELECT id, company, name FROM clients WHERE id = ?', p.client_id)) as any,
    manager: p.manager_id ? ((await get<UserSummary>('SELECT id, name, title, role, email FROM users WHERE id = ?', p.manager_id)) ?? null) : null,
    members: await all<UserSummary>(
      `SELECT u.id, u.name, u.title, u.role, u.email FROM project_members m JOIN users u ON u.id = m.user_id
        WHERE m.project_id = ? AND u.status != 'suspended' ORDER BY u.name`,
      p.id,
    ),
    clientUsers: await all<UserSummary>(`SELECT id, name, title, role${access.caps.staff ? ', email' : ''} FROM users WHERE client_id = ? AND status = 'active' ORDER BY name`, p.client_id),
    caps: access.caps,
  };
}

projectsRouter.get('/:pid', async (req, res) => {
  res.json(await projectDetail(await projectAccess(req.user!, P(req.params.pid))));
});

projectsRouter.patch('/:pid', async (req, res) => {
  const access = await projectAccess(req.user!, P(req.params.pid));
  requireManage(access);
  const body = parse(
    z.object({
      name: zText(160).optional(),
      type: zText(120).optional(),
      description: zOptText(5000).optional(),
      manager_id: zId.nullish(),
      start_date: zDate.nullish(),
      due_date: zDate.nullish(),
      status: z.enum(['onboarding', 'active', 'on_hold', 'completed']).optional(),
      health: z.enum(['on_track', 'at_risk', 'off_track']).optional(),
      internal_notes: zOptText(10000).optional(),
    }),
    req.body,
  );
  await assertStaffUser(body.manager_id);
  const p = access.project;
  await tx(async () => {
    await update('projects', p.id, { ...body, updated_at: now() });
    if (body.manager_id) await addMember(p.id, body.manager_id);
    let changed = false;
    if (body.status && body.status !== p.status) {
      changed = true;
      const label = { onboarding: 'Onboarding', active: 'In progress', on_hold: 'On hold', completed: 'Completed' }[body.status];
      await logActivity({ projectId: p.id, actorId: req.user!.id, action: 'project.status', summary: `Project status changed to ${label}`, entityType: 'project', entityId: p.id, visibility: 'client' });
      await notify(await clientUserIds(p.id), { projectId: p.id, type: 'project.status', title: `Project status: ${label}`, link: 'overview' });
    }
    if (body.due_date !== undefined && body.due_date !== p.due_date && body.due_date) {
      changed = true;
      await logActivity({ projectId: p.id, actorId: req.user!.id, action: 'project.rescheduled', summary: `Expected completion moved to ${fmtDate(body.due_date)}`, entityType: 'project', entityId: p.id, visibility: 'client' });
      await notify(await clientUserIds(p.id), { projectId: p.id, type: 'deadline.changed', title: 'Expected completion date updated', body: `New date: ${fmtDate(body.due_date)}${p.due_date ? ` (was ${fmtDate(p.due_date)})` : ''}.`, link: 'project' });
    }
    if (body.health && body.health !== p.health) {
      changed = true;
      await logActivity({ projectId: p.id, actorId: req.user!.id, action: 'project.health', summary: `Project health set to ${body.health.replace('_', ' ')}`, entityType: 'project', entityId: p.id, visibility: 'internal' });
    }
    if (!changed) await logActivity({ projectId: p.id, actorId: req.user!.id, action: 'project.updated', summary: 'Project settings updated', entityType: 'project', entityId: p.id, visibility: 'internal', meta: Object.keys(body) });
  });
  res.json({ ok: true });
});

projectsRouter.put('/:pid/members', async (req, res) => {
  const access = await projectAccess(req.user!, P(req.params.pid));
  requireManage(access);
  const { user_ids } = parse(z.object({ user_ids: z.array(zId).max(50) }), req.body);
  for (const u of user_ids) await assertStaffUser(u);
  await tx(async () => {
    await run('DELETE FROM project_members WHERE project_id = ?', access.project.id);
    for (const u of user_ids) await addMember(access.project.id, u);
    await addMember(access.project.id, access.project.manager_id);
    await logActivity({ projectId: access.project.id, actorId: req.user!.id, action: 'project.members', summary: 'Project team updated', entityType: 'project', entityId: access.project.id, visibility: 'internal' });
  });
  res.json({ ok: true });
});

projectsRouter.get('/:pid/overview', async (req, res) => {
  res.json(await projectOverview(await projectAccess(req.user!, P(req.params.pid))));
});

projectsRouter.get('/:pid/activity', async (req, res) => {
  const access = await projectAccess(req.user!, P(req.params.pid));
  const before = typeof req.query.before === 'string' ? req.query.before : undefined;
  res.json(await activityFeed(access, 40, before));
});

projectsRouter.get('/:pid/people', async (req, res) => {
  const d = await projectDetail(await projectAccess(req.user!, P(req.params.pid)));
  const team = [...(d.manager ? [d.manager] : []), ...d.members.filter((m) => m.id !== d.manager?.id)];
  res.json({ team, client: d.clientUsers });
});

// ---------------- Roadmap: phases & milestones ----------------

projectsRouter.get('/:pid/roadmap', async (req, res) => {
  const access = await projectAccess(req.user!, P(req.params.pid));
  const pid = access.project.id;
  const vis = access.caps.staff ? '1=1' : "visibility = 'client'";
  const phases = await phasesWithProgress(pid);
  const milestones = await all<Milestone>(`SELECT * FROM milestones WHERE project_id = ? AND ${vis} ORDER BY due_date`, pid);
  const tasks = await all(
    `SELECT t.id, t.title, t.status, t.phase_id, t.due_date, t.visibility, t.client_action, u.name AS assignee_name
       FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.project_id = ? AND ${vis.replace('visibility', 't.visibility')}
      ORDER BY t.position`,
    pid,
  );
  const deliverables = await all(
    `SELECT id, title, status, phase_id, review_due, current_version FROM deliverables WHERE project_id = ? ${access.caps.staff ? '' : "AND status != 'draft'"} ORDER BY created_at`,
    pid,
  );
  res.json({ phases, milestones, tasks, deliverables });
});

const phaseSchema = z.object({
  name: zText(120),
  description: zOptText(4000),
  start_date: zDate.nullish(),
  end_date: zDate.nullish(),
  owner_id: zId.nullish(),
  status: z.enum(['upcoming', 'in_progress', 'completed']).optional(),
});

projectsRouter.post('/:pid/phases', async (req, res) => {
  const access = await projectAccess(req.user!, P(req.params.pid));
  requireManage(access);
  const body = parse(phaseSchema, req.body);
  await assertStaffUser(body.owner_id);
  const id = newId();
  const pos = (await scalar<number | null>('SELECT MAX(position) FROM phases WHERE project_id = ?', access.project.id)) ?? -1;
  const ts = now();
  await insert('phases', { id, project_id: access.project.id, name: body.name, description: body.description, start_date: body.start_date ?? null, end_date: body.end_date ?? null, owner_id: body.owner_id ?? null, status: 'upcoming', position: pos + 1, created_at: ts, updated_at: ts });
  await logActivity({ projectId: access.project.id, actorId: req.user!.id, action: 'phase.created', summary: `${body.name} phase added to the roadmap`, entityType: 'phase', entityId: id, entityLabel: body.name, visibility: 'client' });
  if (body.status && body.status !== 'upcoming') await setPhaseStatus({ id, project_id: access.project.id, name: body.name, status: 'upcoming' }, body.status, req.user!.id);
  res.status(201).json({ id });
});

projectsRouter.patch('/phases/:id', async (req, res) => {
  const { row, access } = await scopedRow<any>(req.user!, 'phases', P(req.params.id), 'Phase');
  requireManage(access);
  const body = parse(phaseSchema.partial(), req.body);
  await assertStaffUser(body.owner_id);
  await tx(async () => {
    const { status, ...rest } = body;
    await update('phases', row.id, { ...rest, updated_at: now() });
    if (body.end_date !== undefined && body.end_date !== row.end_date && body.end_date) {
      await logActivity({ projectId: row.project_id, actorId: req.user!.id, action: 'phase.rescheduled', summary: `${body.name ?? row.name} now expected to finish ${fmtDate(body.end_date)}`, entityType: 'phase', entityId: row.id, entityLabel: row.name, visibility: 'client' });
      await notify(await clientUserIds(row.project_id), { projectId: row.project_id, type: 'deadline.changed', title: `${body.name ?? row.name}: timeline updated`, body: `Expected end date is now ${fmtDate(body.end_date)}.`, link: `project#${row.id}` });
    } else if (Object.keys(rest).length) {
      await logActivity({ projectId: row.project_id, actorId: req.user!.id, action: 'phase.updated', summary: `${body.name ?? row.name} phase updated`, entityType: 'phase', entityId: row.id, entityLabel: row.name, visibility: 'internal' });
    }
    if (status) await setPhaseStatus({ ...row, name: body.name ?? row.name }, status, req.user!.id);
  });
  res.json({ ok: true });
});

projectsRouter.post('/:pid/phases/reorder', async (req, res) => {
  const access = await projectAccess(req.user!, P(req.params.pid));
  requireManage(access);
  const { ids } = parse(z.object({ ids: z.array(zId).max(100) }), req.body);
  const existing = (await all<{ id: string }>('SELECT id FROM phases WHERE project_id = ?', access.project.id)).map((r) => r.id);
  if (ids.length !== existing.length || !ids.every((i) => existing.includes(i))) throw badRequest('Phase list mismatch.');
  await tx(async () => {
    for (const [i, id] of ids.entries()) await run('UPDATE phases SET position = ? WHERE id = ?', i, id);
  });
  await logActivity({ projectId: access.project.id, actorId: req.user!.id, action: 'phase.reordered', summary: 'Roadmap order updated', visibility: 'internal' });
  res.json({ ok: true });
});

projectsRouter.delete('/phases/:id', async (req, res) => {
  const { row, access } = await scopedRow<any>(req.user!, 'phases', P(req.params.id), 'Phase');
  requireManage(access);
  await run('DELETE FROM phases WHERE id = ?', row.id);
  await logActivity({ projectId: row.project_id, actorId: req.user!.id, action: 'phase.deleted', summary: `${row.name} phase removed from the roadmap`, entityType: 'phase', entityId: row.id, visibility: 'client' });
  res.json({ ok: true });
});

const milestoneSchema = z.object({
  title: zText(200),
  description: zOptText(4000),
  due_date: zDate,
  phase_id: zId.nullish(),
  visibility: zVisibility.default('client'),
});

async function assertPhaseInProject(phaseId: string | null | undefined, projectId: string) {
  if (phaseId && !(await get('SELECT 1 FROM phases WHERE id = ? AND project_id = ?', phaseId, projectId))) throw badRequest('Phase does not belong to this project.');
}

projectsRouter.post('/:pid/milestones', async (req, res) => {
  const access = await projectAccess(req.user!, P(req.params.pid));
  requireManage(access);
  const body = parse(milestoneSchema, req.body);
  await assertPhaseInProject(body.phase_id, access.project.id);
  const id = newId();
  const ts = now();
  await insert('milestones', { id, project_id: access.project.id, title: body.title, description: body.description, due_date: body.due_date, phase_id: body.phase_id ?? null, visibility: body.visibility, status: 'pending', created_at: ts, updated_at: ts });
  await logActivity({ projectId: access.project.id, actorId: req.user!.id, action: 'milestone.created', summary: `Milestone “${body.title}” scheduled for ${fmtDate(body.due_date)}`, entityType: 'milestone', entityId: id, entityLabel: body.title, visibility: body.visibility });
  if (body.visibility === 'client')
    await notify(await clientUserIds(access.project.id), { projectId: access.project.id, type: 'milestone.created', title: `New milestone: ${body.title}`, body: `Planned for ${fmtDate(body.due_date)}.`, link: `calendar?date=${body.due_date}` });
  res.status(201).json({ id });
});

projectsRouter.patch('/milestones/:id', async (req, res) => {
  const { row, access } = await scopedRow<Milestone>(req.user!, 'milestones', P(req.params.id), 'Milestone');
  requireManage(access);
  const body = parse(milestoneSchema.partial().extend({ status: z.enum(['pending', 'completed']).optional() }), req.body);
  await assertPhaseInProject(body.phase_id, row.project_id);
  const visible = (body.visibility ?? row.visibility) === 'client';
  const clients = visible ? await clientUserIds(row.project_id) : [];
  const title = body.title ?? row.title;
  await tx(async () => {
    await update('milestones', row.id, { ...body, completed_at: body.status ? (body.status === 'completed' ? now() : null) : undefined, updated_at: now() });
    let logged = false;
    if (body.status && body.status !== row.status) {
      logged = true;
      const done = body.status === 'completed';
      await logActivity({ projectId: row.project_id, actorId: req.user!.id, action: done ? 'milestone.completed' : 'milestone.reopened', summary: done ? `Milestone reached: ${title}` : `Milestone reopened: ${title}`, entityType: 'milestone', entityId: row.id, entityLabel: title, visibility: visible ? 'client' : 'internal' });
      if (done) await notify([...clients, ...(await staffUserIds(row.project_id))], { projectId: row.project_id, type: 'milestone.completed', title: `Milestone reached: ${title}`, link: 'project' }, req.user!.id);
    }
    if (body.due_date && body.due_date !== row.due_date) {
      logged = true;
      await logActivity({ projectId: row.project_id, actorId: req.user!.id, action: 'milestone.rescheduled', summary: `“${title}” moved to ${fmtDate(body.due_date)}`, entityType: 'milestone', entityId: row.id, entityLabel: title, visibility: visible ? 'client' : 'internal', meta: { from: row.due_date, to: body.due_date } });
      await notify(clients, { projectId: row.project_id, type: 'deadline.changed', title: `Milestone rescheduled: ${title}`, body: `New date: ${fmtDate(body.due_date)} (was ${fmtDate(row.due_date)}).`, link: `calendar?date=${body.due_date}` });
    }
    if (!logged)
      await logActivity({ projectId: row.project_id, actorId: req.user!.id, action: 'milestone.updated', summary: `Milestone “${title}” updated`, entityType: 'milestone', entityId: row.id, entityLabel: title, visibility: 'internal' });
  });
  res.json({ ok: true });
});

projectsRouter.delete('/milestones/:id', async (req, res) => {
  const { row, access } = await scopedRow<Milestone>(req.user!, 'milestones', P(req.params.id), 'Milestone');
  requireManage(access);
  await run('DELETE FROM milestones WHERE id = ?', row.id);
  await logActivity({ projectId: row.project_id, actorId: req.user!.id, action: 'milestone.deleted', summary: `Milestone “${row.title}” removed`, entityType: 'milestone', entityId: row.id, visibility: row.visibility });
  res.json({ ok: true });
});
