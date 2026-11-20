// PostgreSQL schema (Supabase in production, embedded PGlite in development/tests).
// Every project-scoped record carries project_id so access can be enforced with a
// single join back to projects.client_id. Dates are ISO-8601 TEXT (UTC) for portability.
//
// Row Level Security is enabled on every table with NO policies: Supabase's public
// Data API (anon / authenticated keys) can read nothing. Only the server, connecting
// as the table owner through DATABASE_URL, can access data — and it enforces RBAC itself.

export const TABLES = [
  'clients', 'users', 'sessions', 'auth_tokens', 'templates', 'projects', 'project_members', 'phases',
  'milestones', 'tasks', 'threads', 'deliverables', 'deliverable_versions', 'approvals', 'revision_requests',
  'comments', 'events', 'event_participants', 'files', 'notifications', 'activity', 'email_outbox',
] as const;

export const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  company TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  website TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  name TEXT NOT NULL,
  title TEXT,
  password_hash TEXT,
  role TEXT NOT NULL CHECK (role IN ('super_admin','admin','project_manager','team_member','client','client_collaborator')),
  client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','suspended')),
  email_notifications INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT,
  CHECK ((role IN ('client','client_collaborator')) = (client_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,               -- sha256(token); the raw token only lives in the cookie
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS auth_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('invite','reset')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  project_type TEXT NOT NULL,
  definition TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT,
  manager_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  start_date TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'onboarding' CHECK (status IN ('onboarding','active','on_hold','completed')),
  health TEXT NOT NULL DEFAULT 'on_track' CHECK (health IN ('on_track','at_risk','off_track')),
  internal_notes TEXT,
  template_id TEXT REFERENCES templates(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id);

CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS phases (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  position INTEGER NOT NULL,
  start_date TEXT,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming','in_progress','completed')),
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_phases_project ON phases(project_id);

CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase_id TEXT REFERENCES phases(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed')),
  completed_at TEXT,
  visibility TEXT NOT NULL DEFAULT 'client' CHECK (visibility IN ('internal','client')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones(project_id);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase_id TEXT REFERENCES phases(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'backlog' CHECK (status IN ('backlog','todo','in_progress','in_review','approved','completed')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  due_date TEXT,
  visibility TEXT NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal','client')),
  client_action INTEGER NOT NULL DEFAULT 0,
  position DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id, status);

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'client' CHECK (visibility IN ('internal','client')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_threads_project ON threads(project_id);

CREATE TABLE IF NOT EXISTS deliverables (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase_id TEXT REFERENCES phases(id) ON DELETE SET NULL,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','awaiting_feedback','changes_requested','approved','finalized')),
  review_due TEXT,
  current_version INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deliverables_project ON deliverables(project_id);

CREATE TABLE IF NOT EXISTS deliverable_versions (
  id TEXT PRIMARY KEY,
  deliverable_id TEXT NOT NULL REFERENCES deliverables(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  notes TEXT,
  link_url TEXT,
  submitted_by TEXT NOT NULL REFERENCES users(id),
  submitted_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (deliverable_id, version)
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  deliverable_id TEXT NOT NULL REFERENCES deliverables(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES deliverable_versions(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  decision TEXT NOT NULL CHECK (decision IN ('approved','changes_requested')),
  feedback TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS revision_requests (
  id TEXT PRIMARY KEY,
  deliverable_id TEXT NOT NULL REFERENCES deliverables(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES deliverable_versions(id) ON DELETE CASCADE,
  approval_id TEXT NOT NULL REFERENCES approvals(id) ON DELETE CASCADE,
  requested_by TEXT NOT NULL REFERENCES users(id),
  details TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolved_by TEXT REFERENCES users(id),
  resolved_version_id TEXT REFERENCES deliverable_versions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  thread_id TEXT REFERENCES threads(id) ON DELETE CASCADE,
  deliverable_id TEXT REFERENCES deliverables(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('internal','client')),
  created_at TEXT NOT NULL,
  edited_at TEXT,
  deleted_at TEXT,
  CHECK ((task_id IS NOT NULL)::int + (thread_id IS NOT NULL)::int + (deliverable_id IS NOT NULL)::int = 1)
);
CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id);
CREATE INDEX IF NOT EXISTS idx_comments_thread ON comments(thread_id);
CREATE INDEX IF NOT EXISTS idx_comments_deliverable ON comments(deliverable_id);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL CHECK (type IN ('milestone','delivery','review','meeting','approval','activity','other')),
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  all_day INTEGER NOT NULL DEFAULT 0,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  milestone_id TEXT REFERENCES milestones(id) ON DELETE SET NULL,
  deliverable_id TEXT REFERENCES deliverables(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled')),
  visibility TEXT NOT NULL DEFAULT 'client' CHECK (visibility IN ('internal','client')),
  client_expectation TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id, starts_at);

CREATE TABLE IF NOT EXISTS event_participants (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('internal','client')),
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  comment_id TEXT REFERENCES comments(id) ON DELETE SET NULL,
  deliverable_version_id TEXT REFERENCES deliverable_versions(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1,
  supersedes_id TEXT REFERENCES files(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_files_project ON files(project_id);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);

-- Activity doubles as the audit log: client-visible entries feed the client timeline,
-- internal entries are only readable by RIXZA staff.
CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  entity_label TEXT,
  visibility TEXT NOT NULL CHECK (visibility IN ('internal','client')),
  meta TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_project ON activity(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS email_outbox (
  id TEXT PRIMARY KEY,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

${TABLES.map((t) => `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`).join('\n')}
`;
