// Shared domain vocabulary — used by both the API (for validation & enforcement)
// and the UI (for labels & presentation). The server is always the authority.

export const ROLES = ['super_admin', 'admin', 'project_manager', 'team_member', 'client', 'client_collaborator'] as const;
export type Role = (typeof ROLES)[number];
export const STAFF_ROLES = ['super_admin', 'admin', 'project_manager', 'team_member'] as const satisfies readonly Role[];
export const CLIENT_ROLES = ['client', 'client_collaborator'] as const satisfies readonly Role[];

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Super Admin',
  admin: 'Administrator',
  project_manager: 'Project Manager',
  team_member: 'Team Member',
  client: 'Client',
  client_collaborator: 'Client Collaborator',
};

export const isStaffRole = (r: Role) => (STAFF_ROLES as readonly Role[]).includes(r);
export const isClientRole = (r: Role) => (CLIENT_ROLES as readonly Role[]).includes(r);
export const isAdminRole = (r: Role) => r === 'super_admin' || r === 'admin';

/** Global (non project-scoped) permissions. Enforced server-side via requirePermission(). */
export const GLOBAL_PERMISSIONS = {
  'clients.manage': ['super_admin', 'admin'],
  'clients.view': ['super_admin', 'admin', 'project_manager'],
  'team.manage': ['super_admin', 'admin'],
  'projects.create': ['super_admin', 'admin', 'project_manager'],
  'templates.manage': ['super_admin', 'admin', 'project_manager'],
  'outbox.view': ['super_admin', 'admin'],
  'admin.access': ['super_admin', 'admin', 'project_manager', 'team_member'],
} as const satisfies Record<string, readonly Role[]>;
export type GlobalPermission = keyof typeof GLOBAL_PERMISSIONS;
export const can = (role: Role, perm: GlobalPermission) => (GLOBAL_PERMISSIONS[perm] as readonly Role[]).includes(role);

/** Project-scoped capabilities, computed by the server per user & project. */
export interface ProjectCaps {
  staff: boolean; // RIXZA side — can see internal items
  manage: boolean; // phases, milestones, events, deliverables, settings, visibility
  editTasks: boolean; // create/update/move any task
  approve: boolean; // formally approve / request changes on deliverables
  moveClientReview: boolean; // client may move their review tasks In Review → Approved
}

export const VISIBILITY = ['internal', 'client'] as const;
export type Visibility = (typeof VISIBILITY)[number];
export const VISIBILITY_LABEL: Record<Visibility, string> = { internal: 'Internal only', client: 'Client visible' };

export const TASK_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'approved', 'completed'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  approved: 'Approved',
  completed: 'Completed',
};
export const DONE_STATUSES: TaskStatus[] = ['approved', 'completed'];

export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABEL: Record<Priority, string> = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };
export const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export const PROJECT_STATUSES = ['onboarding', 'active', 'on_hold', 'completed'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  onboarding: 'Onboarding',
  active: 'In progress',
  on_hold: 'On hold',
  completed: 'Completed',
};

export const PROJECT_HEALTH = ['on_track', 'at_risk', 'off_track'] as const;
export type ProjectHealth = (typeof PROJECT_HEALTH)[number];
export const HEALTH_LABEL: Record<ProjectHealth, string> = { on_track: 'On track', at_risk: 'At risk', off_track: 'Off track' };

export const PHASE_STATUSES = ['upcoming', 'in_progress', 'completed'] as const;
export type PhaseStatus = (typeof PHASE_STATUSES)[number];
export type PhaseDisplayStatus = PhaseStatus | 'delayed';
export const PHASE_STATUS_LABEL: Record<PhaseDisplayStatus, string> = {
  upcoming: 'Upcoming',
  in_progress: 'Current',
  completed: 'Completed',
  delayed: 'Delayed',
};

export const DELIVERABLE_STATUSES = ['draft', 'submitted', 'awaiting_feedback', 'changes_requested', 'approved', 'finalized'] as const;
export type DeliverableStatus = (typeof DELIVERABLE_STATUSES)[number];
export const DELIVERABLE_STATUS_LABEL: Record<DeliverableStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted for Review',
  awaiting_feedback: 'Awaiting Client Feedback',
  changes_requested: 'Changes Requested',
  approved: 'Approved',
  finalized: 'Finalized',
};
/** Deliverable states in which the client is expected to respond. */
export const REVIEWABLE_STATUSES: DeliverableStatus[] = ['submitted', 'awaiting_feedback'];

export const EVENT_TYPES = ['milestone', 'delivery', 'review', 'meeting', 'approval', 'activity', 'other'] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  milestone: 'Milestone',
  delivery: 'Delivery',
  review: 'Client review',
  meeting: 'Meeting',
  approval: 'Approval deadline',
  activity: 'Project activity',
  other: 'Important date',
};
export const EVENT_STATUSES = ['scheduled', 'completed', 'cancelled'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const FILE_CATEGORIES = [
  'Brief & Requirements',
  'Brand Assets',
  'Documents',
  'Design Files',
  'Development',
  'Reports',
  'Final Deliverables',
  'Other',
] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number];

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

// ---------- API payload types ----------

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  title: string | null;
  role: Role;
  client_id: string | null;
  email_notifications: number;
}

export interface UserSummary {
  id: string;
  name: string;
  title: string | null;
  role: Role;
  email?: string;
}

export interface Client {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string | null;
  website: string | null;
  notes: string | null;
  status: 'active' | 'suspended';
  created_at: string;
  updated_at: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  type: string;
  status: ProjectStatus;
  health?: ProjectHealth;
  client_id: string;
  client_company: string;
  manager_name: string | null;
  start_date: string | null;
  due_date: string | null;
  progress: number;
}

export interface Project {
  id: string;
  client_id: string;
  name: string;
  type: string;
  description: string | null;
  manager_id: string | null;
  start_date: string | null;
  due_date: string | null;
  status: ProjectStatus;
  health?: ProjectHealth; // staff only
  internal_notes?: string | null; // staff only
  created_at: string;
  updated_at: string;
}

export interface ProjectDetail {
  project: Project;
  client: Pick<Client, 'id' | 'company' | 'name'>;
  manager: UserSummary | null;
  members: UserSummary[];
  clientUsers: UserSummary[];
  caps: ProjectCaps;
}

export interface Phase {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  position: number;
  start_date: string | null;
  end_date: string | null;
  status: PhaseStatus;
  owner_id: string | null;
  owner_name?: string | null;
  progress: number;
  task_total: number;
  task_done: number;
  display_status: PhaseDisplayStatus;
}

export interface Milestone {
  id: string;
  project_id: string;
  phase_id: string | null;
  title: string;
  description: string | null;
  due_date: string;
  status: 'pending' | 'completed';
  completed_at: string | null;
  visibility: Visibility;
}

export interface Task {
  id: string;
  project_id: string;
  phase_id: string | null;
  phase_name?: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  assignee_id: string | null;
  assignee_name?: string | null;
  due_date: string | null;
  visibility: Visibility;
  client_action: number;
  position: number;
  comment_count: number;
  attachment_count: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface FileItem {
  id: string;
  project_id: string;
  category: FileCategory;
  name: string;
  mime: string;
  size: number;
  uploaded_by: string | null;
  uploader_name?: string | null;
  visibility: Visibility;
  task_id: string | null;
  comment_id: string | null;
  deliverable_version_id: string | null;
  version: number;
  supersedes_id: string | null;
  created_at: string;
}

export interface Comment {
  id: string;
  project_id: string;
  task_id: string | null;
  thread_id: string | null;
  deliverable_id: string | null;
  parent_id: string | null;
  author_id: string;
  author_name: string;
  author_role: Role;
  body: string;
  visibility: Visibility;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  files: FileItem[];
}

export interface Thread {
  id: string;
  project_id: string;
  title: string;
  visibility: Visibility;
  created_by: string;
  creator_name: string;
  created_at: string;
  last_activity_at: string;
  comment_count: number;
  last_comment?: string | null;
}

export interface DeliverableVersion {
  id: string;
  deliverable_id: string;
  version: number;
  notes: string | null;
  link_url: string | null;
  submitted_by: string;
  submitter_name: string;
  submitted_at: string | null;
  created_at: string;
  files: FileItem[];
}

export interface Approval {
  id: string;
  deliverable_id: string;
  version_id: string;
  version: number;
  user_id: string;
  user_name: string;
  decision: 'approved' | 'changes_requested';
  feedback: string | null;
  created_at: string;
}

export interface RevisionRequest {
  id: string;
  deliverable_id: string;
  version_id: string;
  version: number;
  approval_id: string;
  requested_by: string;
  requester_name: string;
  details: string;
  status: 'open' | 'resolved';
  resolved_version: number | null;
  created_at: string;
  resolved_at: string | null;
}

export interface Deliverable {
  id: string;
  project_id: string;
  phase_id: string | null;
  phase_name?: string | null;
  task_id: string | null;
  title: string;
  description: string | null;
  status: DeliverableStatus;
  review_due: string | null;
  current_version: number;
  created_by: string;
  creator_name?: string;
  last_submitted_at: string | null;
  last_submitter_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeliverableDetail {
  deliverable: Deliverable;
  versions: DeliverableVersion[];
  approvals: Approval[];
  revisions: RevisionRequest[];
}

export interface CalendarItem {
  key: string;
  source: 'event' | 'milestone' | 'deliverable' | 'task';
  source_id: string;
  title: string;
  description: string | null;
  type: EventType;
  starts_at: string; // ISO or YYYY-MM-DD for all-day
  ends_at: string | null;
  all_day: boolean;
  status: string;
  owner_name: string | null;
  visibility: Visibility;
  client_expectation: string | null;
  related: { kind: 'task' | 'milestone' | 'deliverable'; id: string; title: string } | null;
  important: boolean;
}

export interface CalendarEvent {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  type: EventType;
  starts_at: string;
  ends_at: string | null;
  all_day: number;
  owner_id: string | null;
  task_id: string | null;
  milestone_id: string | null;
  deliverable_id: string | null;
  status: EventStatus;
  visibility: Visibility;
  client_expectation: string | null;
  participant_ids: string[];
}

export interface Activity {
  id: string;
  project_id: string | null;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  summary: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_label: string | null;
  visibility: Visibility;
  created_at: string;
}

export interface Notification {
  id: string;
  project_id: string | null;
  project_name?: string | null;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface AttentionItem {
  kind: 'deliverable' | 'task';
  id: string;
  title: string;
  detail: string;
  due: string | null;
  cta: string;
  link: string;
}

export interface ProjectOverview {
  progress: number;
  progressBasis: 'tasks' | 'milestones' | 'none';
  phases: Phase[];
  currentPhase: Phase | null;
  phasesCompleted: number;
  nextMilestone: Milestone | null;
  nextDelivery: { title: string; date: string; link: string } | null;
  stats: { tasksCompleted: number; tasksInProgress: number; pendingClientActions: number; upcomingMilestones: number };
  attention: AttentionItem[];
  activity: Activity[];
  taskTotal: number;
}

export interface TemplateDefinition {
  phases: {
    name: string;
    description?: string;
    durationDays: number;
    tasks: { title: string; description?: string; visibility: Visibility; client_action?: boolean; priority?: Priority }[];
    milestones: { title: string; description?: string }[];
  }[];
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string | null;
  project_type: string;
  definition: TemplateDefinition;
  created_at: string;
  updated_at: string;
}
