import { all, get, run } from '../db.ts';
import { now, today } from './util.ts';
import { clientUserIds, logActivity, notify, staffUserIds } from './notify.ts';
import type { Access } from './access.ts';
import type {
  Activity,
  AttentionItem,
  Milestone,
  Phase,
  PhaseDisplayStatus,
  ProjectOverview,
} from '../../shared/domain.ts';

const DONE = "('approved','completed')";

/** Phases with progress derived from their tasks (all tasks, including internal
 *  ones, so the percentage reflects the real amount of work — without exposing it). */
export function phasesWithProgress(projectId: string): Phase[] {
  const rows = all<Omit<Phase, 'progress' | 'display_status'>>(
    `SELECT ph.*, u.name AS owner_name,
            (SELECT COUNT(*) FROM tasks t WHERE t.phase_id = ph.id) AS task_total,
            (SELECT COUNT(*) FROM tasks t WHERE t.phase_id = ph.id AND t.status IN ${DONE}) AS task_done
       FROM phases ph LEFT JOIN users u ON u.id = ph.owner_id
      WHERE ph.project_id = ? ORDER BY ph.position`,
    projectId,
  );
  const t = today();
  return rows.map((p) => {
    const progress =
      p.status === 'completed' ? 100 : p.task_total ? Math.round((p.task_done / p.task_total) * 100) : 0;
    let display: PhaseDisplayStatus = p.status;
    if (p.status !== 'completed' && p.end_date && p.end_date < t) display = 'delayed';
    return { ...p, progress, display_status: display };
  });
}

export function projectProgress(projectId: string): { progress: number; basis: 'tasks' | 'milestones' | 'none'; taskTotal: number } {
  const t = get<{ total: number; done: number }>(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN status IN ${DONE} THEN 1 ELSE 0 END) AS done FROM tasks WHERE project_id = ?`,
    projectId,
  )!;
  if (t.total > 0) return { progress: Math.round(((t.done ?? 0) / t.total) * 100), basis: 'tasks', taskTotal: t.total };
  const m = get<{ total: number; done: number }>(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS done FROM milestones WHERE project_id = ?`,
    projectId,
  )!;
  if (m.total > 0) return { progress: Math.round(((m.done ?? 0) / m.total) * 100), basis: 'milestones', taskTotal: 0 };
  return { progress: 0, basis: 'none', taskTotal: 0 };
}

/**
 * Keeps phase status consistent with its tasks:
 *  - first task started in an upcoming phase → phase begins
 *  - all tasks done → phase completed
 *  - a completed phase whose task is reopened → back in progress
 * Each transition is logged and notified to the client.
 */
export function syncPhase(phaseId: string | null, actorId: string | null) {
  if (!phaseId) return;
  const ph = get<{ id: string; project_id: string; name: string; status: string }>(
    'SELECT id, project_id, name, status FROM phases WHERE id = ?',
    phaseId,
  );
  if (!ph) return;
  const c = get<{ total: number; done: number; started: number }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status IN ${DONE} THEN 1 ELSE 0 END) AS done,
            SUM(CASE WHEN status NOT IN ('backlog','todo') THEN 1 ELSE 0 END) AS started
       FROM tasks WHERE phase_id = ?`,
    phaseId,
  )!;
  let next = ph.status;
  if (c.total > 0 && c.done === c.total) next = 'completed';
  else if (ph.status === 'completed' && c.done < c.total) next = 'in_progress';
  else if (ph.status === 'upcoming' && (c.started ?? 0) > 0) next = 'in_progress';
  if (next !== ph.status) setPhaseStatus(ph, next as any, actorId);
}

export function setPhaseStatus(
  ph: { id: string; project_id: string; name: string; status: string },
  status: 'upcoming' | 'in_progress' | 'completed',
  actorId: string | null,
) {
  if (ph.status === status) return;
  run('UPDATE phases SET status = ?, updated_at = ? WHERE id = ?', status, now(), ph.id);
  if (status === 'in_progress' && ph.status === 'upcoming') {
    logActivity({ projectId: ph.project_id, actorId, action: 'phase.started', summary: `${ph.name} phase started`, entityType: 'phase', entityId: ph.id, entityLabel: ph.name, visibility: 'client' });
    notify(clientUserIds(ph.project_id), { projectId: ph.project_id, type: 'phase.started', title: `${ph.name} has started`, body: 'A new phase of your project is now underway.', link: `project#${ph.id}` });
    // First started phase moves an onboarding project into active delivery.
    run(`UPDATE projects SET status = 'active', updated_at = ? WHERE id = ? AND status = 'onboarding'`, now(), ph.project_id);
  } else if (status === 'completed') {
    logActivity({ projectId: ph.project_id, actorId, action: 'phase.completed', summary: `${ph.name} phase completed`, entityType: 'phase', entityId: ph.id, entityLabel: ph.name, visibility: 'client' });
    notify([...clientUserIds(ph.project_id), ...staffUserIds(ph.project_id)], { projectId: ph.project_id, type: 'phase.completed', title: `${ph.name} is complete`, link: `project#${ph.id}` }, actorId);
  } else {
    logActivity({ projectId: ph.project_id, actorId, action: 'phase.reopened', summary: `${ph.name} phase moved back to ${status === 'upcoming' ? 'upcoming' : 'in progress'}`, entityType: 'phase', entityId: ph.id, entityLabel: ph.name, visibility: 'client' });
  }
}

export function activityFeed(access: Access, limit = 20, before?: string): Activity[] {
  return all<Activity>(
    `SELECT a.*, u.name AS actor_name FROM activity a LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.project_id = ? AND ${access.caps.staff ? '1=1' : "a.visibility = 'client'"}
        AND (? IS NULL OR a.created_at < ?)
      ORDER BY a.created_at DESC LIMIT ?`,
    access.project.id,
    before ?? null,
    before ?? null,
    limit,
  );
}

export function attentionItems(access: Access): AttentionItem[] {
  const pid = access.project.id;
  const items: AttentionItem[] = [];
  const deliverables = all<{ id: string; title: string; status: string; review_due: string | null; current_version: number }>(
    `SELECT id, title, status, review_due, current_version FROM deliverables
      WHERE project_id = ? AND status IN ('submitted','awaiting_feedback')
      ORDER BY COALESCE(review_due, '9999') ASC`,
    pid,
  );
  for (const d of deliverables)
    items.push({
      kind: 'deliverable',
      id: d.id,
      title: `Review ${d.title}`,
      detail: `Version ${d.current_version} is ready for your approval.`,
      due: d.review_due,
      cta: 'Review',
      link: `deliverables/${d.id}`,
    });
  const tasks = all<{ id: string; title: string; due_date: string | null; status: string }>(
    // Tasks whose work is under review as a deliverable are already covered by that deliverable.
    `SELECT id, title, due_date, status FROM tasks t
      WHERE project_id = ? AND client_action = 1 AND visibility = 'client' AND status NOT IN ('approved','completed')
        AND NOT EXISTS (SELECT 1 FROM deliverables d WHERE d.task_id = t.id AND d.status IN ('submitted','awaiting_feedback'))
      ORDER BY COALESCE(due_date, '9999') ASC`,
    pid,
  );
  for (const t of tasks)
    items.push({
      kind: 'task',
      id: t.id,
      title: t.title,
      detail: t.status === 'in_review' ? 'Waiting for your review.' : 'This task needs input from your side.',
      due: t.due_date,
      cta: t.status === 'in_review' ? 'Review' : 'Open task',
      link: `board?task=${t.id}`,
    });
  return items.sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'));
}

export function projectOverview(access: Access): ProjectOverview {
  const pid = access.project.id;
  const vis = access.caps.staff ? '1=1' : "visibility = 'client'";
  const phases = phasesWithProgress(pid);
  const { progress, basis, taskTotal } = projectProgress(pid);
  const currentPhase =
    phases.find((p) => p.status === 'in_progress') ?? phases.find((p) => p.status !== 'completed') ?? null;
  const t = today();
  const nextMilestone =
    get<Milestone>(
      `SELECT * FROM milestones WHERE project_id = ? AND status = 'pending' AND ${vis} ORDER BY due_date ASC LIMIT 1`,
      pid,
    ) ?? null;
  const delivery =
    get<{ link: string; title: string; date: string }>(
      `SELECT 'deliverables/' || id AS link, title, review_due AS date FROM deliverables
        WHERE project_id = ? AND status NOT IN ('approved','finalized') AND review_due >= ? ${access.caps.staff ? '' : "AND status != 'draft'"}
        ORDER BY review_due ASC LIMIT 1`,
      pid,
      t,
    ) ??
    get<{ link: string; title: string; date: string }>(
      `SELECT 'calendar?date=' || substr(starts_at, 1, 10) AS link, title, substr(starts_at, 1, 10) AS date FROM events
        WHERE project_id = ? AND type = 'delivery' AND status = 'scheduled' AND substr(starts_at,1,10) >= ? AND ${vis}
        ORDER BY starts_at ASC LIMIT 1`,
      pid,
      t,
    );
  const s = get<{ done: number; active: number }>(
    `SELECT SUM(CASE WHEN status IN ${DONE} THEN 1 ELSE 0 END) AS done,
            SUM(CASE WHEN status IN ('in_progress','in_review') THEN 1 ELSE 0 END) AS active
       FROM tasks WHERE project_id = ? AND ${vis}`,
    pid,
  )!;
  const attention = attentionItems(access);
  const upcoming = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM milestones WHERE project_id = ? AND status = 'pending' AND ${vis}`,
    pid,
  )!.n;
  return {
    progress,
    progressBasis: basis,
    taskTotal,
    phases,
    currentPhase,
    phasesCompleted: phases.filter((p) => p.status === 'completed').length,
    nextMilestone,
    nextDelivery: delivery ?? null,
    stats: {
      tasksCompleted: s.done ?? 0,
      tasksInProgress: s.active ?? 0,
      pendingClientActions: attention.length,
      upcomingMilestones: upcoming,
    },
    attention,
    activity: activityFeed(access, 12),
  };
}
