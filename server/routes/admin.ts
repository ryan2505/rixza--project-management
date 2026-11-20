import { Router } from 'express';
import { z } from 'zod';
import { all, get, insert, run, tx, update } from '../db.ts';
import { createAuthToken, destroyUserSessions, requirePermission, requireStaff } from '../lib/auth.ts';
import { accessibleProjectIds } from '../lib/access.ts';
import { logActivity, sendEmail } from '../lib/notify.ts';
import { projectProgress } from '../lib/progress.ts';
import { APP_URL, badRequest, forbidden, newId, notFound, now, parse, today, zEmail, zOptText, zText } from '../lib/util.ts';
import { ROLE_LABEL, isAdminRole, type Role, type SessionUser, type TemplateDefinition } from '../../shared/domain.ts';

export const adminRouter = Router();
adminRouter.use(requireStaff);

const pid = (v: unknown) => String(v);
const placeholders = (ids: string[]) => (ids.length ? ids.map(() => '?').join(',') : "''");

// ---------------- Invitations ----------------

export async function sendInvite(userId: string, inviter: SessionUser) {
  const u = (await get<{ email: string; name: string; role: Role; company: string | null }>(
    'SELECT u.email, u.name, u.role, c.company FROM users u LEFT JOIN clients c ON c.id = u.client_id WHERE u.id = ?',
    userId,
  ))!;
  const token = await createAuthToken(userId, 'invite');
  const intro = u.company
    ? `${inviter.name} has invited you to the RIXZA Client Portal — the dedicated workspace for ${u.company}'s project with RIXZA.\n\nYou'll be able to follow progress in real time, review deliverables, share files and talk with your project team.`
    : `${inviter.name} has invited you to join the RIXZA workspace as ${ROLE_LABEL[u.role]}.`;
  await sendEmail(u.email, 'Your RIXZA workspace is ready', `Hello ${u.name},\n\n${intro}\n\nActivate your account (link valid for 7 days):\n${APP_URL}/invite/${token}\n\n— RIXZA`);
  return token;
}

// ---------------- Overview ----------------

adminRouter.get('/overview', async (req, res) => {
  const ids = await accessibleProjectIds(req.user!);
  const ph = placeholders(ids);
  const t = today();
  const in14 = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  const projects = await Promise.all(
    (
      await all<any>(
        `SELECT p.id, p.name, p.type, p.status, p.health, p.due_date, p.start_date, c.company AS client_company, u.name AS manager_name,
                (SELECT COUNT(*) FROM deliverables d WHERE d.project_id = p.id AND d.status IN ('submitted','awaiting_feedback')) AS awaiting,
                (SELECT COUNT(*) FROM tasks k WHERE k.project_id = p.id AND k.due_date < ? AND k.status NOT IN ('approved','completed')) AS overdue
           FROM projects p JOIN clients c ON c.id = p.client_id LEFT JOIN users u ON u.id = p.manager_id
          WHERE p.id IN (${ph}) ORDER BY p.created_at DESC`,
        t,
        ...ids,
      )
    ).map(async (p) => ({ ...p, progress: (await projectProgress(p.id)).progress })),
  );
  const active = projects.filter((p) => p.status !== 'completed');
  const deadlines = await all<any>(
    `SELECT * FROM (
       SELECT 'milestone' AS kind, m.id, m.title, m.due_date AS date, p.id AS project_id, p.name AS project_name FROM milestones m JOIN projects p ON p.id = m.project_id
        WHERE m.status = 'pending' AND m.due_date BETWEEN ? AND ? AND p.id IN (${ph})
       UNION ALL
       SELECT 'task', k.id, k.title, k.due_date, p.id, p.name FROM tasks k JOIN projects p ON p.id = k.project_id
        WHERE k.status NOT IN ('approved','completed') AND k.due_date BETWEEN ? AND ? AND p.id IN (${ph})
       UNION ALL
       SELECT 'deliverable', d.id, d.title, d.review_due, p.id, p.name FROM deliverables d JOIN projects p ON p.id = d.project_id
        WHERE d.status NOT IN ('approved','finalized') AND d.review_due BETWEEN ? AND ? AND p.id IN (${ph})
     ) AS dl ORDER BY date ASC LIMIT 12`,
    t, in14, ...ids, t, in14, ...ids, t, in14, ...ids,
  );
  const overdueTasks = await all<any>(
    `SELECT k.id, k.title, k.due_date, k.status, p.id AS project_id, p.name AS project_name, u.name AS assignee_name
       FROM tasks k JOIN projects p ON p.id = k.project_id LEFT JOIN users u ON u.id = k.assignee_id
      WHERE k.due_date < ? AND k.status NOT IN ('approved','completed') AND p.id IN (${ph})
      ORDER BY k.due_date ASC LIMIT 20`,
    t,
    ...ids,
  );
  const pendingApprovals = await all<any>(
    `SELECT d.id, d.title, d.status, d.review_due, d.current_version, p.id AS project_id, p.name AS project_name
       FROM deliverables d JOIN projects p ON p.id = d.project_id
      WHERE d.status IN ('submitted','awaiting_feedback') AND p.id IN (${ph}) ORDER BY COALESCE(d.review_due,'9999')`,
    ...ids,
  );
  const clientActivity = await all<any>(
    `SELECT a.*, u.name AS actor_name, p.name AS project_name FROM activity a
       JOIN users u ON u.id = a.actor_id JOIN projects p ON p.id = a.project_id
      WHERE u.client_id IS NOT NULL AND a.project_id IN (${ph}) ORDER BY a.created_at DESC LIMIT 12`,
    ...ids,
  );
  const myTasks = await all<any>(
    `SELECT k.id, k.title, k.status, k.priority, k.due_date, p.id AS project_id, p.name AS project_name
       FROM tasks k JOIN projects p ON p.id = k.project_id
      WHERE k.assignee_id = ? AND k.status NOT IN ('approved','completed')
      ORDER BY COALESCE(k.due_date,'9999') LIMIT 15`,
    req.user!.id,
  );
  res.json({
    metrics: {
      activeProjects: active.length,
      awaitingFeedback: active.filter((p) => p.awaiting > 0).length,
      atRisk: active.filter((p) => p.health !== 'on_track').length,
      upcomingDeadlines: deadlines.length,
      overdueTasks: overdueTasks.length,
      pendingApprovals: pendingApprovals.length,
    },
    projects,
    deadlines,
    overdueTasks,
    pendingApprovals,
    clientActivity,
    myTasks,
  });
});

// ---------------- Clients ----------------

const clientSchema = z.object({
  name: zText(120),
  company: zText(160),
  email: zEmail,
  phone: zOptText(60),
  website: zOptText(300),
  notes: zOptText(5000),
});

adminRouter.get('/clients', requirePermission('clients.view'), async (_req, res) => {
  res.json(
    await all(
      `SELECT c.*,
              (SELECT COUNT(*) FROM projects p WHERE p.client_id = c.id) AS project_count,
              (SELECT COUNT(*) FROM users u WHERE u.client_id = c.id) AS user_count,
              (SELECT MAX(u.last_login_at) FROM users u WHERE u.client_id = c.id) AS last_seen_at
         FROM clients c ORDER BY lower(c.company)`,
    ),
  );
});

adminRouter.post('/clients', requirePermission('clients.manage'), async (req, res) => {
  const body = parse(clientSchema.extend({ invite: z.boolean().default(true) }), req.body);
  if (await get('SELECT 1 FROM users WHERE email = ?', body.email)) throw badRequest('A user with this email already exists.');
  const id = newId();
  const userId = newId();
  await tx(async () => {
    const ts = now();
    await insert('clients', { id, name: body.name, company: body.company, email: body.email, phone: body.phone, website: body.website, notes: body.notes, status: 'active', created_at: ts, updated_at: ts });
    await insert('users', { id: userId, email: body.email, name: body.name, role: 'client', client_id: id, status: 'invited', created_at: ts, updated_at: ts });
    await logActivity({ projectId: null, actorId: req.user!.id, action: 'client.created', summary: `Client account created for ${body.company}`, entityType: 'client', entityId: id, entityLabel: body.company, visibility: 'internal' });
  });
  if (body.invite) {
    await sendInvite(userId, req.user!);
    await logActivity({ projectId: null, actorId: req.user!.id, action: 'client.invited', summary: `${body.name} invited to the portal`, entityType: 'client', entityId: id, visibility: 'internal' });
  }
  res.status(201).json({ id, userId });
});

adminRouter.get('/clients/:id', requirePermission('clients.view'), async (req, res) => {
  const id = pid(req.params.id);
  const client = await get('SELECT * FROM clients WHERE id = ?', id);
  if (!client) throw notFound('Client');
  const users = await all('SELECT id, email, name, title, role, status, last_login_at, created_at FROM users WHERE client_id = ? ORDER BY created_at', id);
  const projects = await Promise.all(
    (
      await all<any>(
        `SELECT p.id, p.name, p.type, p.status, p.health, p.start_date, p.due_date, u.name AS manager_name
           FROM projects p LEFT JOIN users u ON u.id = p.manager_id WHERE p.client_id = ? ORDER BY p.created_at DESC`,
        id,
      )
    ).map(async (p) => ({ ...p, progress: (await projectProgress(p.id)).progress })),
  );
  const activity = await all(
    `SELECT a.*, u.name AS actor_name, p.name AS project_name FROM activity a
       LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN projects p ON p.id = a.project_id
      WHERE (a.entity_type = 'client' AND a.entity_id = ?) OR u.client_id = ?
      ORDER BY a.created_at DESC LIMIT 30`,
    id,
    id,
  );
  res.json({ client, users, projects, activity });
});

adminRouter.patch('/clients/:id', requirePermission('clients.manage'), async (req, res) => {
  const body = parse(clientSchema.partial().extend({ status: z.enum(['active', 'suspended']).optional() }), req.body);
  const client = await get<{ id: string; company: string; status: string }>('SELECT * FROM clients WHERE id = ?', pid(req.params.id));
  if (!client) throw notFound('Client');
  await tx(async () => {
    await update('clients', client.id, { ...body, updated_at: now() });
    if (body.status && body.status !== client.status) {
      if (body.status === 'suspended') {
        for (const u of await all<{ id: string }>('SELECT id FROM users WHERE client_id = ?', client.id)) await destroyUserSessions(u.id);
      }
      await logActivity({ projectId: null, actorId: req.user!.id, action: `client.${body.status === 'suspended' ? 'suspended' : 'reactivated'}`, summary: `${client.company} access ${body.status === 'suspended' ? 'suspended' : 'reactivated'}`, entityType: 'client', entityId: client.id, visibility: 'internal' });
    } else {
      await logActivity({ projectId: null, actorId: req.user!.id, action: 'client.updated', summary: `${client.company} details updated`, entityType: 'client', entityId: client.id, visibility: 'internal' });
    }
  });
  res.json({ ok: true });
});

// Invite an additional person from the client organisation.
adminRouter.post('/clients/:id/users', requirePermission('clients.manage'), async (req, res) => {
  const body = parse(z.object({ name: zText(120), email: zEmail, role: z.enum(['client', 'client_collaborator']) }), req.body);
  const client = await get<{ id: string; company: string }>('SELECT id, company FROM clients WHERE id = ?', pid(req.params.id));
  if (!client) throw notFound('Client');
  if (await get('SELECT 1 FROM users WHERE email = ?', body.email)) throw badRequest('A user with this email already exists.');
  const id = newId();
  const ts = now();
  await insert('users', { id, email: body.email, name: body.name, role: body.role, client_id: client.id, status: 'invited', created_at: ts, updated_at: ts });
  await sendInvite(id, req.user!);
  await logActivity({ projectId: null, actorId: req.user!.id, action: 'client.invited', summary: `${body.name} (${ROLE_LABEL[body.role]}) invited for ${client.company}`, entityType: 'client', entityId: client.id, visibility: 'internal' });
  res.status(201).json({ id });
});

// ---------------- Users (client users & staff) ----------------

function assertCanManageUser(actor: SessionUser, target: { role: Role; client_id: string | null }) {
  if (!isAdminRole(actor.role)) throw forbidden();
  if (!target.client_id && target.role === 'super_admin' && actor.role !== 'super_admin') throw forbidden('Only a Super Admin can manage another Super Admin.');
}

adminRouter.post('/users/:id/resend-invite', async (req, res) => {
  const u = await get<{ id: string; role: Role; client_id: string | null; status: string; name: string }>('SELECT * FROM users WHERE id = ?', pid(req.params.id));
  if (!u) throw notFound('User');
  assertCanManageUser(req.user!, u);
  if (u.status !== 'invited') throw badRequest('This user has already activated their account.');
  await sendInvite(u.id, req.user!);
  await logActivity({ projectId: null, actorId: req.user!.id, action: 'user.invite_resent', summary: `Invitation resent to ${u.name}`, entityType: u.client_id ? 'client' : 'user', entityId: u.client_id ?? u.id, visibility: 'internal' });
  res.json({ ok: true });
});

adminRouter.patch('/users/:id', async (req, res) => {
  const body = parse(
    z.object({
      status: z.enum(['active', 'suspended']).optional(),
      role: z.enum(['super_admin', 'admin', 'project_manager', 'team_member', 'client', 'client_collaborator']).optional(),
      name: zText(120).optional(),
      title: zOptText(120).optional(),
    }),
    req.body,
  );
  const u = await get<{ id: string; role: Role; client_id: string | null; status: string; name: string; password_hash: string | null }>('SELECT * FROM users WHERE id = ?', pid(req.params.id));
  if (!u) throw notFound('User');
  assertCanManageUser(req.user!, u);
  if (u.id === req.user!.id && (body.status || body.role)) throw badRequest('You cannot change your own role or access.');
  if (body.role) {
    const clientRole = body.role === 'client' || body.role === 'client_collaborator';
    if (clientRole !== !!u.client_id) throw badRequest('Client users and RIXZA staff cannot switch sides.');
    if (body.role === 'super_admin' && req.user!.role !== 'super_admin') throw forbidden('Only a Super Admin can grant Super Admin.');
  }
  if (body.status === 'active' && !u.password_hash) throw badRequest('This user has not activated their invitation yet.');
  await tx(async () => {
    await update('users', u.id, { ...body, updated_at: now() });
    if (body.status === 'suspended') await destroyUserSessions(u.id);
    const what = body.status ? (body.status === 'suspended' ? 'suspended' : 'reactivated') : body.role ? `role changed to ${ROLE_LABEL[body.role]}` : 'updated';
    await logActivity({ projectId: null, actorId: req.user!.id, action: 'user.updated', summary: `${u.name} ${what}`, entityType: u.client_id ? 'client' : 'user', entityId: u.client_id ?? u.id, visibility: 'internal', meta: body });
  });
  res.json({ ok: true });
});

adminRouter.get('/team', async (_req, res) => {
  res.json(
    await all(
      `SELECT u.id, u.email, u.name, u.title, u.role, u.status, u.last_login_at, u.created_at,
              (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.status NOT IN ('approved','completed')) AS open_tasks
         FROM users u WHERE u.client_id IS NULL ORDER BY lower(u.name)`,
    ),
  );
});

adminRouter.post('/team', requirePermission('team.manage'), async (req, res) => {
  const body = parse(z.object({ name: zText(120), email: zEmail, title: zOptText(120), role: z.enum(['super_admin', 'admin', 'project_manager', 'team_member']) }), req.body);
  if (body.role === 'super_admin' && req.user!.role !== 'super_admin') throw forbidden('Only a Super Admin can invite a Super Admin.');
  if (await get('SELECT 1 FROM users WHERE email = ?', body.email)) throw badRequest('A user with this email already exists.');
  const id = newId();
  const ts = now();
  await insert('users', { id, email: body.email, name: body.name, title: body.title, role: body.role, status: 'invited', created_at: ts, updated_at: ts });
  await sendInvite(id, req.user!);
  await logActivity({ projectId: null, actorId: req.user!.id, action: 'user.invited', summary: `${body.name} invited as ${ROLE_LABEL[body.role]}`, entityType: 'user', entityId: id, visibility: 'internal' });
  res.status(201).json({ id });
});

// ---------------- Templates ----------------

export const templateDefinitionSchema = z.object({
  phases: z
    .array(
      z.object({
        name: zText(120),
        description: z.string().trim().max(2000).optional(),
        durationDays: z.number().int().min(1).max(365),
        tasks: z
          .array(
            z.object({
              title: zText(200),
              description: z.string().trim().max(5000).optional(),
              visibility: z.enum(['internal', 'client']),
              client_action: z.boolean().optional(),
              priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
            }),
          )
          .max(100),
        milestones: z.array(z.object({ title: zText(200), description: z.string().trim().max(2000).optional() })).max(20),
      }),
    )
    .min(1, 'Add at least one phase')
    .max(30),
});

const templateSchema = z.object({ name: zText(120), description: zOptText(2000), project_type: zText(120), definition: templateDefinitionSchema });
const parseTemplate = (t: any) => ({ ...t, definition: JSON.parse(t.definition) as TemplateDefinition });

adminRouter.get('/templates', async (_req, res) => {
  res.json((await all('SELECT * FROM templates ORDER BY lower(name)')).map(parseTemplate));
});

adminRouter.post('/templates', requirePermission('templates.manage'), async (req, res) => {
  const body = parse(templateSchema, req.body);
  const id = newId();
  const ts = now();
  await insert('templates', { id, name: body.name, description: body.description, project_type: body.project_type, definition: JSON.stringify(body.definition), created_by: req.user!.id, created_at: ts, updated_at: ts });
  await logActivity({ projectId: null, actorId: req.user!.id, action: 'template.created', summary: `Template “${body.name}” created`, entityType: 'template', entityId: id, visibility: 'internal' });
  res.status(201).json({ id });
});

adminRouter.put('/templates/:id', requirePermission('templates.manage'), async (req, res) => {
  const body = parse(templateSchema, req.body);
  const id = pid(req.params.id);
  if (!(await get('SELECT 1 FROM templates WHERE id = ?', id))) throw notFound('Template');
  await update('templates', id, { name: body.name, description: body.description, project_type: body.project_type, definition: JSON.stringify(body.definition), updated_at: now() });
  await logActivity({ projectId: null, actorId: req.user!.id, action: 'template.updated', summary: `Template “${body.name}” updated`, entityType: 'template', entityId: id, visibility: 'internal' });
  res.json({ ok: true });
});

adminRouter.delete('/templates/:id', requirePermission('templates.manage'), async (req, res) => {
  const id = pid(req.params.id);
  const t = await get<{ name: string }>('SELECT name FROM templates WHERE id = ?', id);
  if (!t) throw notFound('Template');
  await run('DELETE FROM templates WHERE id = ?', id);
  await logActivity({ projectId: null, actorId: req.user!.id, action: 'template.deleted', summary: `Template “${t.name}” deleted`, visibility: 'internal' });
  res.json({ ok: true });
});

// ---------------- Email outbox & audit ----------------

adminRouter.get('/outbox', requirePermission('outbox.view'), async (_req, res) => {
  res.json(await all('SELECT * FROM email_outbox ORDER BY created_at DESC LIMIT 200'));
});

adminRouter.get('/audit', requirePermission('clients.manage'), async (req, res) => {
  const before = typeof req.query.before === 'string' ? req.query.before : null;
  res.json(
    await all(
      `SELECT a.*, u.name AS actor_name, p.name AS project_name FROM activity a
         LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN projects p ON p.id = a.project_id
        WHERE (?::text IS NULL OR a.created_at < ?) ORDER BY a.created_at DESC LIMIT 50`,
      before,
      before,
    ),
  );
});

adminRouter.get('/staff-options', async (_req, res) => {
  res.json(await all(`SELECT id, name, title, role FROM users WHERE client_id IS NULL AND status != 'suspended' ORDER BY lower(name)`));
});
