# RIXZA Client Portal

The private workspace each RIXZA client gets once a project is signed: real-time progress, Kanban board, calendar, roadmap, deliverables with formal approvals, files, discussions and notifications. RIXZA's team runs everything from an internal admin workspace that uses the same data.

**Stack:** React 19, Vite, TypeScript and Tailwind v4 · Express 5 API · **PostgreSQL** (Supabase in production, embedded PGlite locally) · **Supabase Storage** for files · deployed on **Vercel**.

## Quick start (local)

Requires Node.js 22.18 or newer. Locally you don't need a database server: an embedded Postgres (PGlite) is created in `./data`.

```bash
npm install
npm run dev            # API on :4000 + Vite on http://localhost:5173
```

The first run seeds demo data. Every demo account's password is `RixzaDemo2026`.

| Account | Role |
|---|---|
| admin@rixza.com | Super Admin |
| lea@rixza.com | Project Manager |
| sam@rixza.com | Team Member |
| amelia@northwind.example | Client: Northwind Hotels (can approve) |
| james@northwind.example | Client Collaborator: Northwind Hotels (cannot approve) |
| sofia@atlaslegal.example | Client: Atlas Legal (a second, isolated client) |

| Command | |
|---|---|
| `npm run seed` | Wipe the database and recreate the demo data |
| `npm run test:acceptance` | Run the 16-step acceptance scenario plus security checks (73 checks) on a throwaway database |
| `npm run build` | Type-check, then build the SPA into `dist/` |
| `npm start` | Serve the API and the built SPA on :4000 |
| `npm run build:vercel` | Produce the Vercel deployment bundle in `.vercel/output` |
| `npm run serve:vercel-output` | Serve that exact bundle locally, the way Vercel will |

## Deploying to Supabase + Vercel

### 1. Supabase (database and files)

1. Create a project at [supabase.com](https://supabase.com).
2. Copy `.env.example` to `.env` and fill in:
   - `DATABASE_URL`: from **Project Settings → Database → Connection string → Transaction pooler** (port `6543`). Replace `[YOUR-PASSWORD]` with your database password.
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: from **Project Settings → API**. The service role key is secret and only used server-side.
3. Create the tables and the private storage bucket:
   ```bash
   npm run db:push
   ```
   Alternatively, paste [`supabase/migrations/20261120000000_rixza_init.sql`](supabase/migrations/20261120000000_rixza_init.sql) into the Supabase SQL editor, or run `supabase db push` with the Supabase CLI. The app also creates any missing tables on startup, so this step is idempotent.
4. Optional, for a demo environment: load the demo data into Supabase with `npm run seed:supabase`. This **erases** existing data.

**Security model.** Row Level Security is enabled on all 22 tables **with no policies**, so Supabase's public Data API (the `anon` and `authenticated` keys) can't read or write anything. Only the application server, connecting through `DATABASE_URL`, accesses the data, and it enforces every permission itself. Files sit in a **private** bucket and are only served through the authorized `/api/files/:id/download` endpoint. Never expose the service role key to the browser.

### 2. Vercel (application)

1. Import the GitHub repository into Vercel. `vercel.json` already sets the build command (`npm run build:vercel`). Keep the framework preset as **Other**.
2. Under **Settings → Environment Variables**, add:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Supabase transaction pooler URL (port 6543) |
   | `SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | service role key |
   | `APP_URL` | your public URL, e.g. `https://portal.rixza.com` (used in emails) |
   | `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` | first deploy only: creates the first Super Admin on an empty database |
   | `SEED_DEMO` | `1` only to load the demo data on an empty database |

3. Deploy. The build produces Vercel's Build Output API format:
   - The SPA is served as static files from the CDN.
   - `/api/*` runs as one Node.js 22 serverless function (Express, bundled with esbuild).
   - Every other path falls back to the SPA.

**Serverless differences, already handled:**
- Live updates use a persistent SSE connection locally. Vercel functions can't hold that open, so the portal automatically switches to a 20-second background refresh, plus a refresh whenever the tab regains focus.
- Vercel limits request bodies to about **4.5 MB**, so uploads are capped at 4 MB per file on Vercel. Change this with `MAX_UPLOAD_MB`; larger files would need direct-to-storage uploads.
- Sessions are database-backed, so they work across function instances. Login rate limiting is per instance.

Before deploying, you can check the production bundle locally: `npm run build:vercel && npm run serve:vercel-output`. Running `ACCEPTANCE_ENTRY=scripts/serve-vercel-output.mjs npm run test:acceptance` runs the full scenario against it.

## Architecture

```
shared/domain.ts       Roles, permissions, statuses and API types, shared by server and UI
server/
  schema.ts            PostgreSQL schema (+ RLS lockdown), single source of truth
  db.ts                pg pool (DATABASE_URL) or embedded PGlite; ?→$n params; async transactions
  app.ts               Express app (routes, middleware, startup initialization)
  index.ts             Long-running server (local / any Node host)
  vercel.ts            Serverless entry (bundled by scripts/build-vercel.mjs)
  lib/auth.ts          scrypt hashing, hashed session tokens, CSRF guard, invite/reset tokens
  lib/access.ts        THE access gate: projectAccess() + scopedRow() → caps per user & project
  lib/storage.ts       Supabase Storage (private bucket) or local disk
  lib/progress.ts      Progress, phase auto-status, overview metrics, "attention needed"
  lib/notify.ts        Activity/audit log, notifications, email outbox
  lib/events.ts        Server-Sent Events (long-running servers only)
  routes/*.ts          auth, admin, projects, tasks, comments, files, deliverables, calendar, notifications
src/                   React app: design system (components/ui.tsx), shell, pages (client + admin)
supabase/migrations/   Generated SQL migration (npm run db:export)
scripts/               acceptance test, Vercel build, local Vercel server, db push, schema export
```

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

- **Progress** is calculated from real tasks (approved or completed ÷ total, internal work included), or from milestones when no tasks exist. It is never entered by hand. Phases start and complete automatically as their tasks move.
- **Approvals** are a separate action from comments. Each one records the user, the exact version, a timestamp, the IP address and the user agent. Approving a stale version is refused. A change request creates a revision request linked to that version, and the next submitted version resolves it. A task linked to a deliverable can only be approved through that deliverable.
- **The calendar is a view over the data:** events, milestones, review deadlines and client-action tasks. Rescheduling a milestone updates the roadmap, the calendar and the client's notifications in one step.
- **Internal by default:** staff discussions, notes, uploads and new tasks start as Internal Only. Sharing with the client is always explicit.

## Still open

- **Email delivery.** Every email is stored in the outbox (*Admin → Email outbox*). To send them for real, connect a provider (Resend, Postmark, SMTP…) in `deliver()` in `server/lib/notify.ts`.
- **Large uploads on Vercel.** Files over 4 MB would need direct browser-to-Supabase Storage uploads with signed upload URLs.
- **Reporting.** It is limited to the admin overview metrics and the audit log.
