import { Router } from 'express';
import { z } from 'zod';
import { all, get, insert, run, tx, update } from '../db.ts';
import { requireAuth } from '../lib/auth.ts';
import { projectAccess, scopedRow } from '../lib/access.ts';
import { clientUserIds, logActivity, notify } from '../lib/notify.ts';
import { badRequest, forbidden, newId, now, parse, zDateTime, zId, zOptText, zText, zVisibility } from '../lib/util.ts';
import { EVENT_TYPES, type CalendarEvent, type CalendarItem } from '../../shared/domain.ts';

export const calendarRouter = Router();
calendarRouter.use(requireAuth);
const P = (v: unknown) => String(v);

const fmt = (iso: string, allDay: boolean) =>
  new Date(allDay && iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', ...(allDay ? { timeZone: 'UTC' } : { hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }),
  });

/**
 * The project calendar is a *view* over the project data: explicit events plus
 * milestones, deliverable review deadlines and client-action task deadlines.
 * Rescheduling a milestone therefore updates the calendar & timeline at once.
 */
calendarRouter.get('/projects/:pid/calendar', async (req, res) => {
  const access = await projectAccess(req.user!, P(req.params.pid));
  const pid = access.project.id;
  const staff = access.caps.staff;
  const from = typeof req.query.from === 'string' ? req.query.from.slice(0, 10) : '0000-01-01';
  const to = typeof req.query.to === 'string' ? req.query.to.slice(0, 10) : '9999-12-31';
  const items: CalendarItem[] = [];
  const today = new Date().toISOString().slice(0, 10);

  const events = await all<any>(
    `SELECT e.*, u.name AS owner_name, t.title AS task_title, t.visibility AS task_vis, m.title AS milestone_title, m.visibility AS m_vis, d.title AS deliverable_title, d.status AS d_status
       FROM events e LEFT JOIN users u ON u.id = e.owner_id LEFT JOIN tasks t ON t.id = e.task_id
       LEFT JOIN milestones m ON m.id = e.milestone_id LEFT JOIN deliverables d ON d.id = e.deliverable_id
      WHERE e.project_id = ? AND substr(e.starts_at,1,10) <= ? AND substr(COALESCE(e.ends_at, e.starts_at),1,10) >= ? ${staff ? '' : "AND e.visibility = 'client'"}`,
    pid, to, from,
  );
  for (const e of events) {
    let related: CalendarItem['related'] = null;
    if (e.task_id && (staff || e.task_vis === 'client')) related = { kind: 'task', id: e.task_id, title: e.task_title };
    else if (e.deliverable_id && (staff || e.d_status !== 'draft')) related = { kind: 'deliverable', id: e.deliverable_id, title: e.deliverable_title };
    else if (e.milestone_id && (staff || e.m_vis === 'client')) related = { kind: 'milestone', id: e.milestone_id, title: e.milestone_title };
    items.push({
      key: `event:${e.id}`, source: 'event', source_id: e.id, title: e.title, description: e.description, type: e.type,
      starts_at: e.starts_at, ends_at: e.ends_at, all_day: !!e.all_day, status: e.status, owner_name: e.owner_name,
      visibility: e.visibility, client_expectation: e.client_expectation, related,
      important: e.status === 'scheduled' && ['review', 'approval', 'delivery', 'milestone'].includes(e.type),
    });
  }

  for (const m of await all<any>(
    `SELECT m.*, ph.name AS phase_name, u.name AS owner_name FROM milestones m LEFT JOIN phases ph ON ph.id = m.phase_id
       LEFT JOIN users u ON u.id = ph.owner_id WHERE m.project_id = ? AND m.due_date BETWEEN ? AND ? ${staff ? '' : "AND m.visibility = 'client'"}`,
    pid, from, to,
  ))
    items.push({
      key: `milestone:${m.id}`, source: 'milestone', source_id: m.id, title: m.title, description: m.description, type: 'milestone',
      starts_at: m.due_date, ends_at: null, all_day: true, status: m.status === 'completed' ? 'completed' : m.due_date < today ? 'overdue' : 'scheduled',
      owner_name: m.owner_name, visibility: m.visibility, client_expectation: null,
      related: m.phase_id ? { kind: 'milestone', id: m.id, title: m.phase_name ? `Phase: ${m.phase_name}` : m.title } : null,
      important: m.status !== 'completed',
    });

  for (const d of await all<any>(`SELECT d.* FROM deliverables d WHERE d.project_id = ? AND d.review_due BETWEEN ? AND ? ${staff ? '' : "AND d.status != 'draft'"}`, pid, from, to)) {
    const awaiting = ['submitted', 'awaiting_feedback'].includes(d.status);
    items.push({
      key: `deliverable:${d.id}`, source: 'deliverable', source_id: d.id, title: `Review: ${d.title}`, description: d.description, type: 'approval',
      starts_at: d.review_due, ends_at: null, all_day: true, status: ['approved', 'finalized'].includes(d.status) ? 'completed' : 'scheduled',
      owner_name: null, visibility: d.status === 'draft' ? 'internal' : 'client',
      client_expectation: awaiting ? 'Review the deliverable and approve it or request changes.' : d.status === 'draft' ? 'Will be shared for review.' : null,
      related: { kind: 'deliverable', id: d.id, title: d.title }, important: awaiting,
    });
  }

  for (const t of await all<any>(
    `SELECT t.*, u.name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
      WHERE t.project_id = ? AND t.due_date BETWEEN ? AND ? ${staff ? '' : "AND t.client_action = 1 AND t.visibility = 'client'"}`,
    pid, from, to,
  ))
    items.push({
      key: `task:${t.id}`, source: 'task', source_id: t.id, title: t.title, description: t.description, type: t.client_action ? 'review' : 'activity',
      starts_at: t.due_date, ends_at: null, all_day: true, status: ['approved', 'completed'].includes(t.status) ? 'completed' : 'scheduled',
      owner_name: t.assignee_name, visibility: t.visibility, client_expectation: t.client_action ? 'Your input is needed on this task.' : null,
      related: { kind: 'task', id: t.id, title: t.title }, important: !!t.client_action && !['approved', 'completed'].includes(t.status),
    });

  items.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  res.json(items);
});

const eventSchema = z.object({
  title: zText(200),
  description: zOptText(5000),
  type: z.enum(EVENT_TYPES),
  starts_at: zDateTime,
  ends_at: zDateTime.nullish(),
  all_day: z.boolean().default(false),
  owner_id: zId.nullish(),
  task_id: zId.nullish(),
  milestone_id: zId.nullish(),
  deliverable_id: zId.nullish(),
  status: z.enum(['scheduled', 'completed', 'cancelled']).default('scheduled'),
  visibility: zVisibility.default('client'),
  client_expectation: zOptText(1000),
  participant_ids: z.array(zId).max(50).default([]),
});

async function validateEventRefs(pid: string, b: Partial<z.infer<typeof eventSchema>>) {
  for (const [col, table] of [['task_id', 'tasks'], ['milestone_id', 'milestones'], ['deliverable_id', 'deliverables']] as const) {
    const v = (b as any)[col];
    if (v && !(await get(`SELECT 1 FROM ${table} WHERE id = ? AND project_id = ?`, v, pid))) throw badRequest(`Linked ${table.slice(0, -1)} not found in this project.`);
  }
  if (b.ends_at && b.starts_at && b.ends_at < b.starts_at) throw badRequest('The end must be after the start.');
}

async function setParticipants(eventId: string, pid: string, ids: string[]) {
  await run('DELETE FROM event_participants WHERE event_id = ?', eventId);
  const allowed = new Set(
    (
      await all<{ id: string }>(
        `SELECT id FROM users WHERE client_id = (SELECT client_id FROM projects WHERE id = ?)
         OR id = (SELECT manager_id FROM projects WHERE id = ?) OR id IN (SELECT user_id FROM project_members WHERE project_id = ?)`,
        pid, pid, pid,
      )
    ).map((r) => r.id),
  );
  for (const id of ids) if (allowed.has(id)) await run('INSERT INTO event_participants (event_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING', eventId, id);
}

const normalise = (b: { starts_at?: string; ends_at?: string | null; all_day?: boolean }) => ({
  starts_at: b.starts_at && (b.all_day ? b.starts_at.slice(0, 10) : new Date(b.starts_at).toISOString()),
  ends_at: b.ends_at === undefined ? undefined : b.ends_at && (b.all_day ? b.ends_at.slice(0, 10) : new Date(b.ends_at).toISOString()),
});

calendarRouter.get('/events/:id', async (req, res) => {
  const { row } = await scopedRow<CalendarEvent>(req.user!, 'events', P(req.params.id), 'Event');
  const participants = await all<{ id: string }>('SELECT u.id, u.name, u.role FROM event_participants p JOIN users u ON u.id = p.user_id WHERE p.event_id = ?', row.id);
  res.json({ ...row, participants, participant_ids: participants.map((p) => p.id) });
});

calendarRouter.post('/projects/:pid/events', async (req, res) => {
  const access = await projectAccess(req.user!, P(req.params.pid));
  if (!access.caps.manage) throw forbidden();
  const body = parse(eventSchema, req.body);
  await validateEventRefs(access.project.id, body);
  const id = newId();
  const { participant_ids, ...rest } = body;
  const times = normalise(body);
  await tx(async () => {
    const ts = now();
    await insert('events', { ...rest, ...times, all_day: body.all_day ? 1 : 0, id, project_id: access.project.id, created_at: ts, updated_at: ts });
    await setParticipants(id, access.project.id, participant_ids);
    await logActivity({ projectId: access.project.id, actorId: req.user!.id, action: 'event.created', summary: `${body.title} scheduled for ${fmt(times.starts_at!, body.all_day)}`, entityType: 'event', entityId: id, entityLabel: body.title, visibility: body.visibility });
  });
  if (body.visibility === 'client')
    await notify([...(await clientUserIds(access.project.id)), ...participant_ids], { projectId: access.project.id, type: 'event.created', title: `Scheduled: ${body.title}`, body: fmt(times.starts_at!, body.all_day), link: `calendar?date=${times.starts_at!.slice(0, 10)}&event=${id}` }, req.user!.id);
  res.status(201).json({ id });
});

calendarRouter.patch('/events/:id', async (req, res) => {
  const { row, access } = await scopedRow<CalendarEvent>(req.user!, 'events', P(req.params.id), 'Event');
  if (!access.caps.manage) throw forbidden();
  const body = parse(eventSchema.partial(), req.body);
  Object.keys(body).forEach((k) => (body as any)[k] === undefined && delete (body as any)[k]);
  const allDay = body.all_day ?? !!row.all_day;
  await validateEventRefs(row.project_id, { ...body, starts_at: body.starts_at ?? row.starts_at });
  const { participant_ids, ...rest } = body;
  const times = normalise({ starts_at: body.starts_at ?? (body.all_day !== undefined ? row.starts_at : undefined), ends_at: body.ends_at, all_day: allDay });
  const visible = (body.visibility ?? row.visibility) === 'client';
  const title = body.title ?? row.title;
  const moved = !!times.starts_at && times.starts_at !== row.starts_at;
  await tx(async () => {
    await update('events', row.id, { ...rest, ...times, all_day: body.all_day === undefined ? undefined : body.all_day ? 1 : 0, updated_at: now() });
    if (participant_ids) await setParticipants(row.id, row.project_id, participant_ids);
    if (moved) {
      await logActivity({ projectId: row.project_id, actorId: req.user!.id, action: 'event.rescheduled', summary: `${title} rescheduled to ${fmt(times.starts_at!, allDay)}`, entityType: 'event', entityId: row.id, entityLabel: title, visibility: visible ? 'client' : 'internal', meta: { from: row.starts_at, to: times.starts_at } });
    } else if (body.status && body.status !== row.status) {
      await logActivity({ projectId: row.project_id, actorId: req.user!.id, action: 'event.status', summary: `${title} marked ${body.status}`, entityType: 'event', entityId: row.id, entityLabel: title, visibility: visible ? 'client' : 'internal' });
    } else {
      await logActivity({ projectId: row.project_id, actorId: req.user!.id, action: 'event.updated', summary: `${title} updated`, entityType: 'event', entityId: row.id, entityLabel: title, visibility: 'internal' });
    }
  });
  if (visible && (moved || body.status === 'cancelled')) {
    const participants = (await all<{ user_id: string }>('SELECT user_id FROM event_participants WHERE event_id = ?', row.id)).map((p) => p.user_id);
    await notify([...(await clientUserIds(row.project_id)), ...participants], {
      projectId: row.project_id,
      type: 'deadline.changed',
      title: body.status === 'cancelled' ? `Cancelled: ${title}` : `Rescheduled: ${title}`,
      body: moved ? `New date: ${fmt(times.starts_at!, allDay)} (was ${fmt(row.starts_at, !!row.all_day)}).` : null,
      link: `calendar?date=${(times.starts_at ?? row.starts_at).slice(0, 10)}&event=${row.id}`,
    }, req.user!.id);
  }
  res.json({ ok: true });
});

calendarRouter.delete('/events/:id', async (req, res) => {
  const { row, access } = await scopedRow<CalendarEvent>(req.user!, 'events', P(req.params.id), 'Event');
  if (!access.caps.manage) throw forbidden();
  await run('DELETE FROM events WHERE id = ?', row.id);
  await logActivity({ projectId: row.project_id, actorId: req.user!.id, action: 'event.deleted', summary: `${row.title} removed from the calendar`, entityType: 'event', entityId: row.id, visibility: row.visibility });
  if (row.visibility === 'client')
    await notify(await clientUserIds(row.project_id), { projectId: row.project_id, type: 'deadline.changed', title: `Removed from calendar: ${row.title}`, link: 'calendar' }, req.user!.id);
  res.json({ ok: true });
});
