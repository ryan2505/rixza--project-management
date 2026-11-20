# RIXZA Client Portal

The private workspace each RIXZA client gets once a project is signed: real-time progress, Kanban board, calendar, roadmap, deliverables with formal approvals, files, discussions and notifications. RIXZA's team runs everything from an internal admin workspace that uses the same data.

## Quick start

Requires Node.js 22.18 or newer (Node 24/26 recommended). It uses the built-in `node:sqlite` and runs TypeScript natively, with no native build step.

```bash
npm install
npm run dev            # API on :4000 + Vite on http://localhost:5173
```

On the first run the database is empty, so demo data is created. The password for every demo account is `RixzaDemo2026`.

| Account | Role |
|---|---|
| admin@rixza.com | Super Admin |
| lea@rixza.com | Project Manager |
| sam@rixza.com | Team Member |
| amelia@northwind.example | Client: Northwind Hotels (can approve) |
| james@northwind.example | Client Collaborator: Northwind Hotels (cannot approve) |
| sofia@atlaslegal.example | Client: Atlas Legal (a second, isolated client) |

Other commands:

```bash
npm run seed              # wipe the database and recreate the demo data
npm run test:acceptance   # run the end-to-end acceptance scenario on a throwaway database
npm run build             # type-check, then build the SPA into dist/
npm start                 # serve the API and the built SPA on :4000
```

**Production:** set `NODE_ENV=production`, `APP_URL=https://portal.rixza.com`, `DATA_DIR=/var/lib/rixza`, and (first run only) `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` to create the first Super Admin. Production never seeds demo data. Run it behind HTTPS (cookies are `Secure` in production). Set `TRUST_PROXY=1` behind a reverse proxy.

## Architecture

```
shared/domain.ts     Roles, permissions, statuses and API types, shared by server and UI
server/
  schema.ts          Relational schema (SQLite, foreign keys on)
  db.ts              Data access: prepared-statement cache, nested transactions
  lib/auth.ts        scrypt hashing, hashed session tokens, CSRF guard, invite/reset tokens, rate limit
  lib/access.ts      THE access gate: projectAccess() + scopedRow() → caps per user & project
  lib/progress.ts    Progress, phase auto-status, overview metrics, "attention needed"
  lib/notify.ts      Activity/audit log, notifications, email outbox
  lib/events.ts      Server-Sent Events: "project X changed" → clients refetch through the API
  routes/*.ts        auth, admin, projects (+phases/milestones), tasks, comments, files,
                     deliverables (versions/approvals/revisions), calendar, notifications
  seed.ts, templates.ts
src/
  components/ui.tsx  Design system (buttons, inputs, modal, drawer, tabs, badges, toasts, …)
  components/        Shell (sidebar/header/mobile nav), TaskDrawer, Comments, files, status
  pages/             Client and staff pages share components; behaviour follows the server's caps
  pages/admin/       Overview, clients, projects, templates, team, outbox, audit log
scripts/acceptance.ts  The 16-step acceptance scenario plus security checks (73 checks)
```

**Synchronization.** Every write goes through the API and the database. It then writes an activity entry and pushes an SSE ping to every connected user who can see that project. Their browser refetches the open views through the normal authorized endpoints, so no data ever travels over the stream.

### Data model

`clients`, `users` (role + optional `client_id`), `sessions`, `auth_tokens`, `projects`, `project_members`, `phases`, `milestones`, `tasks`, `threads`, `comments` (exactly one target: task, thread or deliverable), `deliverables`, `deliverable_versions`, `approvals`, `revision_requests`, `events`, `event_participants`, `files` (version chain via `supersedes_id`), `notifications`, `activity` (also the audit log), `email_outbox`, `templates`.

Every project record carries `project_id`. Visibility (`internal` / `client`) is a column on tasks, comments, threads, milestones, events and files.

### Roles & permissions (enforced server-side)

| | Super Admin / Admin | Project Manager | Team Member | Client | Client Collaborator |
|---|---|---|---|---|---|
| Projects visible | all | managed + member | member | own organisation | own organisation |
| Internal items | ✓ | ✓ | ✓ | – | – |
| Phases, milestones, events, deliverables, visibility | ✓ | ✓ (own projects) | – | – | – |
| Create, edit and move tasks | ✓ | ✓ | ✓ | only In Review → Approved on their action tasks | – |
| Formal approval / request changes | – | – | – | ✓ | – |
| Comment, upload, discuss | ✓ | ✓ | ✓ | ✓ (client-visible only) | ✓ |
| Clients, team, outbox, audit | ✓ (Super Admin manages admins) | view clients | – | – | – |

Inaccessible projects return **404, not 403**, so one client can't even confirm that another client's project exists. Suspending a user or a whole client revokes their sessions immediately.

### Key product rules

- **Progress** is calculated from real tasks (approved or completed ÷ total, internal work included), or from milestones when no tasks exist. It is never entered by hand. Phases start and complete automatically as their tasks move, and the client is notified.
- **Approvals** are a separate action from comments. Each one records the user, the exact version, a timestamp, the IP address and the user agent. Approving a stale version is refused. A change request creates a revision request linked to that version, and the next submitted version resolves it.
- **Deliverable lifecycle:** Draft (internal) → Submitted for Review → Awaiting Client Feedback (once the client opens it) → Changes Requested ⇄ new version → Approved → Finalized (files move to *Final Deliverables*).
- **The calendar is a view over the data:** events, milestones, deliverable review deadlines and client-action tasks. Rescheduling a milestone updates the roadmap, the calendar and the client's notifications in one step.
- **Internal by default:** staff discussions, notes, uploads and new tasks start as Internal Only. Sharing with the client is always an explicit choice.

### Design system

The palette is Electric Blue `#0000FF`, Black and White, plus a calibrated neutral scale. Warning and danger tints appear only for states that need attention. The tokens live in `src/index.css` (`@theme`). The typeface is Inter Variable, self-hosted. Radius is 4–8 px. The type scale is 11, 12, 13, 14, 20 and 22 px. Buttons are 24, 28, 32 or 40 px tall. Shadows appear only on floating layers.

## Status against the brief

All four phases are implemented: foundation, project management, collaboration, and operational features (templates, activity and audit history, project health, admin metrics).

These items are still open:

- **Email delivery.** Every email (invitations, resets, notifications) is written to the outbox, which you can view under *Admin → Email outbox*. To send them for real, connect an SMTP or API provider in `deliver()` in `server/lib/notify.ts`.
- **Reporting.** It is limited to the admin overview metrics and the audit log. There are no exportable reports yet.
- **File storage.** Uploads are stored on local disk under `DATA_DIR/uploads` and only served through authorized endpoints. For a multi-server deployment, swap in object storage with signed URLs.
- **Rate limiting.** The login, reset and invite limits are kept in memory per process.
