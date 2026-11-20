import { all, get } from '../db.ts';
import { notFound } from './util.ts';
import { isAdminRole, isStaffRole, type ProjectCaps, type SessionUser } from '../../shared/domain.ts';

export interface ProjectRow {
  id: string;
  client_id: string;
  name: string;
  type: string;
  description: string | null;
  manager_id: string | null;
  start_date: string | null;
  due_date: string | null;
  status: string;
  health: string;
  internal_notes: string | null;
  template_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Access {
  user: SessionUser;
  project: ProjectRow;
  caps: ProjectCaps;
}

async function isMember(projectId: string, userId: string) {
  return !!(await get('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?', projectId, userId));
}

/**
 * The single gate for every project-scoped request. Throws 404 (never 403) when the
 * user has no access so that project existence is not disclosed to other clients.
 */
export async function projectAccess(user: SessionUser, projectId: string): Promise<Access> {
  const project = await get<ProjectRow>('SELECT * FROM projects WHERE id = ?', projectId);
  if (!project) throw notFound('Project');

  const role = user.role;
  let allowed = false;
  let manage = false;
  let editTasks = false;

  if (isAdminRole(role)) {
    allowed = manage = editTasks = true;
  } else if (role === 'project_manager') {
    allowed = project.manager_id === user.id || (await isMember(project.id, user.id));
    manage = editTasks = allowed;
  } else if (role === 'team_member') {
    allowed = await isMember(project.id, user.id);
    editTasks = allowed;
  } else {
    // client & client_collaborator: strictly their own organisation's projects
    allowed = user.client_id != null && project.client_id === user.client_id;
  }
  if (!allowed) throw notFound('Project');

  return {
    user,
    project,
    caps: { staff: isStaffRole(role), manage, editTasks, approve: role === 'client', moveClientReview: role === 'client' },
  };
}

/** Loads a project-scoped row and verifies the caller may see it (incl. visibility). */
export async function scopedRow<T extends { project_id: string; visibility?: string }>(
  user: SessionUser,
  table: 'tasks' | 'deliverables' | 'events' | 'files' | 'threads' | 'comments' | 'milestones' | 'phases',
  id: string,
  label: string,
): Promise<{ row: T; access: Access }> {
  const row = await get<T>(`SELECT * FROM ${table} WHERE id = ?`, id);
  if (!row) throw notFound(label);
  const access = await projectAccess(user, row.project_id);
  if (!access.caps.staff) {
    if (row.visibility === 'internal') throw notFound(label);
    if (table === 'deliverables' && (row as any).status === 'draft') throw notFound(label);
    if (table === 'files' && (row as any).deleted_at) throw notFound(label);
  }
  return { row, access };
}

export async function accessibleProjectIds(user: SessionUser): Promise<string[]> {
  if (isAdminRole(user.role)) return (await all<{ id: string }>('SELECT id FROM projects')).map((r) => r.id);
  if (user.role === 'project_manager' || user.role === 'team_member') {
    return (
      await all<{ id: string }>(
        `SELECT id FROM projects WHERE manager_id = ?
         UNION SELECT project_id FROM project_members WHERE user_id = ?`,
        user.id,
        user.id,
      )
    ).map((r) => r.id);
  }
  if (!user.client_id) return [];
  return (await all<{ id: string }>('SELECT id FROM projects WHERE client_id = ?', user.client_id)).map((r) => r.id);
}

export async function canAccessProject(user: SessionUser, projectId: string) {
  try {
    await projectAccess(user, projectId);
    return true;
  } catch {
    return false;
  }
}
