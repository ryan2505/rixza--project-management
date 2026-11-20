import { Router } from 'express';
import { z } from 'zod';
import { all, get, insert, run, tx, update } from '../db.ts';
import { requireAuth } from '../lib/auth.ts';
import { projectAccess, scopedRow, type Access } from '../lib/access.ts';
import { clientUserIds, logActivity, notify, staffUserIds } from '../lib/notify.ts';
import { syncPhase } from '../lib/progress.ts';
import { HttpError, badRequest, forbidden, newId, now, parse, zDate, zId, zOptText, zText } from '../lib/util.ts';
import { cleanupUploads, storeFiles, upload } from './files.ts';
import { listComments } from './comments.ts';
import {
  FILE_CATEGORIES,
  REVIEWABLE_STATUSES,
  type Approval,
  type Deliverable,
  type DeliverableDetail,
  type DeliverableVersion,
  type FileItem,
  type RevisionRequest,
} from '../../shared/domain.ts';

export const deliverablesRouter = Router();
deliverablesRouter.use(requireAuth);

const fmtDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

const SELECT = `SELECT d.*, ph.name AS phase_name, cu.name AS creator_name,
    (SELECT v.submitted_at FROM deliverable_versions v WHERE v.deliverable_id = d.id AND v.submitted_at IS NOT NULL ORDER BY v.version DESC LIMIT 1) AS last_submitted_at,
    (SELECT su.name FROM deliverable_versions v JOIN users su ON su.id = v.submitted_by WHERE v.deliverable_id = d.id AND v.submitted_at IS NOT NULL ORDER BY v.version DESC LIMIT 1) AS last_submitter_name
  FROM deliverables d LEFT JOIN phases ph ON ph.id = d.phase_id LEFT JOIN users cu ON cu.id = d.created_by`;

function detail(access: Access, id: string): DeliverableDetail {
  const deliverable = get<Deliverable>(`${SELECT} WHERE d.id = ?`, id)!;
  const versions = all<DeliverableVersion>(
    `SELECT v.*, u.name AS submitter_name FROM deliverable_versions v JOIN users u ON u.id = v.submitted_by
      WHERE v.deliverable_id = ? ${access.caps.staff ? '' : 'AND v.submitted_at IS NOT NULL'} ORDER BY v.version DESC`,
    id,
  );
  const files = versions.length
    ? all<FileItem>(
        `SELECT f.*, u.name AS uploader_name FROM files f LEFT JOIN users u ON u.id = f.uploaded_by
          WHERE f.deliverable_version_id IN (${versions.map(() => '?').join(',')}) AND f.deleted_at IS NULL
          ${access.caps.staff ? '' : "AND f.visibility = 'client'"}`,
        ...versions.map((v) => v.id),
      )
    : [];
  return {
    deliverable,
    versions: versions.map((v) => ({ ...v, files: files.filter((f) => f.deliverable_version_id === v.id) })),
    approvals: all<Approval>(
      `SELECT a.id, a.deliverable_id, a.version_id, a.version, a.user_id, a.decision, a.feedback, a.created_at, u.name AS user_name
         FROM approvals a JOIN users u ON u.id = a.user_id WHERE a.deliverable_id = ? ORDER BY a.created_at DESC`,
      id,
    ),
    revisions: all<RevisionRequest>(
      `SELECT r.*, u.name AS requester_name, v.version AS version, rv.version AS resolved_version
         FROM revision_requests r JOIN users u ON u.id = r.requested_by JOIN deliverable_versions v ON v.id = r.version_id
         LEFT JOIN deliverable_versions rv ON rv.id = r.resolved_version_id
        WHERE r.deliverable_id = ? ORDER BY r.created_at DESC`,
      id,
    ),
  };
}

deliverablesRouter.get('/projects/:pid/deliverables', (req, res) => {
  const access = projectAccess(req.user!, req.params.pid);
  res.json(
    all<Deliverable>(
      `${SELECT} WHERE d.project_id = ? ${access.caps.staff ? '' : "AND d.status != 'draft'"} ORDER BY d.updated_at DESC`,
      access.project.id,
    ),
  );
});

const deliverableSchema = z.object({
  title: zText(200),
  description: zOptText(10000),
  phase_id: zId.nullish(),
  task_id: zId.nullish(),
  review_due: zDate.nullish(),
});

function validateRefs(projectId: string, b: { phase_id?: string | null; task_id?: string | null }) {
  if (b.phase_id && !get('SELECT 1 FROM phases WHERE id = ? AND project_id = ?', b.phase_id, projectId)) throw badRequest('Phase does not belong to this project.');
  if (b.task_id && !get('SELECT 1 FROM tasks WHERE id = ? AND project_id = ?', b.task_id, projectId)) throw badRequest('Task does not belong to this project.');
}

deliverablesRouter.post('/projects/:pid/deliverables', (req, res) => {
  const access = projectAccess(req.user!, req.params.pid);
  if (!access.caps.manage) throw forbidden();
  const body = parse(deliverableSchema, req.body);
  validateRefs(access.project.id, body);
  const id = newId();
  const ts = now();
  insert('deliverables', { id, project_id: access.project.id, ...body, status: 'draft', current_version: 0, created_by: req.user!.id, created_at: ts, updated_at: ts });
  logActivity({ projectId: access.project.id, actorId: req.user!.id, action: 'deliverable.created', summary: `Draft deliverable created: ${body.title}`, entityType: 'deliverable', entityId: id, entityLabel: body.title, visibility: 'internal' });
  res.status(201).json({ id });
});

deliverablesRouter.get('/deliverables/:id', (req, res) => {
  const { row, access } = scopedRow<Deliverable>(req.user!, 'deliverables', req.params.id, 'Deliverable');
  res.json({ ...detail(access, row.id), comments: listComments(access, 'deliverable_id', row.id) });
});

deliverablesRouter.patch('/deliverables/:id', (req, res) => {
  const { row, access } = scopedRow<Deliverable>(req.user!, 'deliverables', req.params.id, 'Deliverable');
  if (!access.caps.manage) throw forbidden();
  const body = parse(deliverableSchema.partial(), req.body);
  validateRefs(row.project_id, body);
  tx(() => {
    update('deliverables', row.id, { ...body, updated_at: now() });
    const title = body.title ?? row.title;
    if (body.review_due !== undefined && body.review_due !== row.review_due && row.status !== 'draft') {
      logActivity({ projectId: row.project_id, actorId: req.user!.id, action: 'deliverable.rescheduled', summary: body.review_due ? `Review deadline for ${title} set to ${fmtDate(body.review_due)}` : `Review deadline removed from ${title}`, entityType: 'deliverable', entityId: row.id, entityLabel: title, visibility: 'client' });
      if (body.review_due) notify(clientUserIds(row.project_id), { projectId: row.project_id, type: 'deadline.changed', title: `Review deadline updated: ${title}`, body: `Please review by ${fmtDate(body.review_due)}.`, link: `deliverables/${row.id}` });
    } else {
      logActivity({ projectId: row.project_id, actorId: req.user!.id, action: 'deliverable.updated', summary: `${title} details updated`, entityType: 'deliverable', entityId: row.id, entityLabel: title, visibility: 'internal' });
    }
  });
  res.json({ ok: true });
});

deliverablesRouter.delete('/deliverables/:id', (req, res) => {
  const { row, access } = scopedRow<Deliverable>(req.user!, 'deliverables', req.params.id, 'Deliverable');
  if (!access.caps.manage) throw forbidden();
  if (row.status !== 'draft') throw badRequest('Only drafts can be deleted. Shared deliverables are part of the project record.');
  run('DELETE FROM deliverables WHERE id = ?', row.id);
  logActivity({ projectId: row.project_id, actorId: req.user!.id, action: 'deliverable.deleted', summary: `Draft deliverable deleted: ${row.title}`, visibility: 'internal' });
  res.json({ ok: true });
});

function submitVersion(access: Access, d: Deliverable, versionId: string, actorId: string) {
  const v = get<DeliverableVersion>('SELECT * FROM deliverable_versions WHERE id = ?', versionId)!;
  const ts = now();
  update('deliverable_versions', v.id, { submitted_at: ts });
  run(`UPDATE files SET visibility = 'client' WHERE deliverable_version_id = ?`, v.id);
  update('deliverables', d.id, { status: 'submitted', updated_at: ts });
  // A new submission answers any open revision requests.
  const open = all<{ id: string }>(`SELECT id FROM revision_requests WHERE deliverable_id = ? AND status = 'open'`, d.id);
  for (const r of open) update('revision_requests', r.id, { status: 'resolved', resolved_by: actorId, resolved_version_id: v.id, resolved_at: ts });
  logActivity({
    projectId: d.project_id, actorId, action: 'deliverable.submitted',
    summary: `${d.title} submitted for review (version ${v.version})${open.length ? ` — addresses ${open.length} revision request${open.length > 1 ? 's' : ''}` : ''}`,
    entityType: 'deliverable', entityId: d.id, entityLabel: d.title, visibility: 'client', meta: { version: v.version },
  });
  if (d.task_id) {
    const t = get<{ status: string; visibility: string; phase_id: string | null }>('SELECT status, visibility, phase_id FROM tasks WHERE id = ?', d.task_id);
    if (t && !['in_review', 'approved', 'completed'].includes(t.status)) {
      run(`UPDATE tasks SET status = 'in_review', updated_at = ? WHERE id = ?`, ts, d.task_id);
      syncPhase(t.phase_id, actorId);
    }
  }
  notify(
    clientUserIds(d.project_id),
    {
      projectId: d.project_id,
      type: 'deliverable.submitted',
      title: v.version > 1 ? `Revised version ready: ${d.title} (v${v.version})` : `New deliverable to review: ${d.title}`,
      body: d.review_due ? `Please review by ${fmtDate(d.review_due)}.` : 'Your approval is required.',
      link: `deliverables/${d.id}`,
    },
    actorId,
  );
  void access;
}

deliverablesRouter.post('/deliverables/:id/versions', upload.array('files', 10), (req, res) => {
  const uploaded = (req.files as Express.Multer.File[]) ?? [];
  try {
    const { row, access } = scopedRow<Deliverable>(req.user!, 'deliverables', String(req.params.id), 'Deliverable');
    if (!access.caps.manage) throw forbidden();
    const body = parse(
      z.object({
        notes: zOptText(10000),
        link_url: z.string().trim().url('Enter a valid URL (https://…)').max(1000).refine((u) => /^https?:\/\//i.test(u), 'Only http(s) links are allowed').optional().or(z.literal('').transform(() => undefined)),
        submit: z.enum(['true', 'false']).default('false'),
        category: z.enum(FILE_CATEGORIES).default('Design Files'),
      }),
      req.body,
    );
    if (!uploaded.length && !body.link_url) throw badRequest('Attach at least one file or a preview link.');
    if (['approved', 'finalized'].includes(row.status)) throw badRequest('This deliverable is already approved. Create a new deliverable for further work.');
    const pending = get('SELECT 1 FROM deliverable_versions WHERE deliverable_id = ? AND submitted_at IS NULL', row.id);
    if (pending) throw badRequest('A draft version is already waiting to be submitted.');
    if (REVIEWABLE_STATUSES.includes(row.status)) throw badRequest('The current version is still under client review.');
    const result = tx(() => {
      const vid = newId();
      const version = row.current_version + 1;
      insert('deliverable_versions', { id: vid, deliverable_id: row.id, version, notes: body.notes, link_url: body.link_url ?? null, submitted_by: req.user!.id, created_at: now() });
      update('deliverables', row.id, { current_version: version, updated_at: now() });
      storeFiles(access, uploaded, { category: body.category, visibility: 'internal', deliverable_version_id: vid, task_id: row.task_id });
      logActivity({ projectId: row.project_id, actorId: req.user!.id, action: 'deliverable.version', summary: `Version ${version} of ${row.title} prepared`, entityType: 'deliverable', entityId: row.id, entityLabel: row.title, visibility: 'internal' });
      if (body.submit === 'true') submitVersion(access, { ...row, current_version: version }, vid, req.user!.id);
      return { id: vid, version };
    });
    res.status(201).json(result);
  } catch (e) {
    cleanupUploads(uploaded);
    throw e;
  }
});

deliverablesRouter.post('/deliverables/:id/submit', (req, res) => {
  const { row, access } = scopedRow<Deliverable>(req.user!, 'deliverables', req.params.id, 'Deliverable');
  if (!access.caps.manage) throw forbidden();
  const v = get<{ id: string }>('SELECT id FROM deliverable_versions WHERE deliverable_id = ? AND submitted_at IS NULL ORDER BY version DESC LIMIT 1', row.id);
  if (!v) throw badRequest('Add a new version before submitting.');
  tx(() => submitVersion(access, row, v.id, req.user!.id));
  res.json({ ok: true });
});

// The client opened the deliverable: Submitted → Awaiting Client Feedback.
deliverablesRouter.post('/deliverables/:id/view', (req, res) => {
  const { row, access } = scopedRow<Deliverable>(req.user!, 'deliverables', req.params.id, 'Deliverable');
  if (!access.caps.staff && row.status === 'submitted') {
    update('deliverables', row.id, { status: 'awaiting_feedback', updated_at: now() });
    logActivity({ projectId: row.project_id, actorId: req.user!.id, action: 'deliverable.viewed', summary: `${req.user!.name} opened ${row.title} (v${row.current_version})`, entityType: 'deliverable', entityId: row.id, entityLabel: row.title, visibility: 'internal' });
  }
  res.json({ ok: true });
});

deliverablesRouter.post('/deliverables/:id/decision', (req, res) => {
  const { row, access } = scopedRow<Deliverable>(req.user!, 'deliverables', req.params.id, 'Deliverable');
  if (!access.caps.approve) throw forbidden('Only the primary client contact can approve deliverables or request changes.');
  const body = parse(
    z.object({
      decision: z.enum(['approved', 'changes_requested']),
      version: z.number().int().positive(),
      feedback: z.string().trim().max(10000).optional(),
      confirm: z.literal(true, { errorMap: () => ({ message: 'Please confirm your decision.' }) }),
    }),
    req.body,
  );
  if (!REVIEWABLE_STATUSES.includes(row.status)) throw badRequest('This deliverable is not awaiting your review.');
  const v = get<{ id: string; version: number }>('SELECT id, version FROM deliverable_versions WHERE deliverable_id = ? AND submitted_at IS NOT NULL ORDER BY version DESC LIMIT 1', row.id);
  if (!v) throw badRequest('There is no submitted version to review.');
  if (v.version !== body.version) throw new HttpError(409, `A newer version (v${v.version}) has been submitted. Please review the latest version.`);
  if (body.decision === 'changes_requested' && (body.feedback ?? '').length < 3) throw badRequest('Please describe the changes you would like.');
  const approvalId = newId();
  tx(() => {
    const ts = now();
    insert('approvals', {
      id: approvalId, deliverable_id: row.id, version_id: v.id, version: v.version, user_id: req.user!.id, decision: body.decision,
      feedback: body.feedback || null, ip: req.ip ?? null, user_agent: req.get('user-agent')?.slice(0, 300) ?? null, created_at: ts,
    });
    update('deliverables', row.id, { status: body.decision, updated_at: ts });
    if (body.decision === 'changes_requested') {
      insert('revision_requests', { id: newId(), deliverable_id: row.id, version_id: v.id, approval_id: approvalId, requested_by: req.user!.id, details: body.feedback!, status: 'open', created_at: ts });
    }
    if (row.task_id) {
      const t = get<{ status: string; phase_id: string | null }>('SELECT status, phase_id FROM tasks WHERE id = ?', row.task_id);
      if (t) {
        const next = body.decision === 'approved' ? 'approved' : 'in_progress';
        if (t.status !== next && t.status !== 'completed') {
          run('UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?', next, next === 'approved' ? ts : null, ts, row.task_id);
          syncPhase(t.phase_id, req.user!.id);
        }
      }
    }
    const approved = body.decision === 'approved';
    logActivity({
      projectId: row.project_id, actorId: req.user!.id, action: approved ? 'deliverable.approved' : 'deliverable.changes_requested',
      summary: approved ? `${row.title} approved by ${req.user!.name} (version ${v.version})` : `${req.user!.name} requested changes to ${row.title} (version ${v.version})`,
      entityType: 'deliverable', entityId: row.id, entityLabel: row.title, visibility: 'client', meta: { approvalId, version: v.version },
    });
  });
  notify(
    staffUserIds(row.project_id),
    {
      projectId: row.project_id,
      type: body.decision === 'approved' ? 'deliverable.approved' : 'revision.requested',
      title: body.decision === 'approved' ? `Approved: ${row.title} (v${v.version})` : `Changes requested: ${row.title} (v${v.version})`,
      body: body.feedback || null,
      link: `deliverables/${row.id}`,
    },
    req.user!.id,
  );
  // Let other client contacts know the decision was recorded.
  notify(clientUserIds(row.project_id), { projectId: row.project_id, type: 'deliverable.decision', title: `${req.user!.name} ${body.decision === 'approved' ? 'approved' : 'requested changes to'} ${row.title}`, link: `deliverables/${row.id}` }, req.user!.id);
  res.json({ ok: true, approvalId });
});

deliverablesRouter.post('/deliverables/:id/finalize', (req, res) => {
  const { row, access } = scopedRow<Deliverable>(req.user!, 'deliverables', req.params.id, 'Deliverable');
  if (!access.caps.manage) throw forbidden();
  if (row.status !== 'approved') throw badRequest('Only approved deliverables can be finalized.');
  tx(() => {
    update('deliverables', row.id, { status: 'finalized', updated_at: now() });
    run(
      `UPDATE files SET category = 'Final Deliverables' WHERE deliverable_version_id = (SELECT id FROM deliverable_versions WHERE deliverable_id = ? AND version = ?)`,
      row.id,
      row.current_version,
    );
    logActivity({ projectId: row.project_id, actorId: req.user!.id, action: 'deliverable.finalized', summary: `${row.title} finalized and added to Final Deliverables`, entityType: 'deliverable', entityId: row.id, entityLabel: row.title, visibility: 'client' });
  });
  notify(clientUserIds(row.project_id), { projectId: row.project_id, type: 'deliverable.finalized', title: `Final files available: ${row.title}`, link: `deliverables/${row.id}` });
  res.json({ ok: true });
});
