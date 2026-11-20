/**
 * End-to-end acceptance test — runs the 16-step scenario from the product brief
 * against a real server process with a fresh, empty database.
 *
 *   npm run test:acceptance
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 4321;
const BASE = `http://localhost:${PORT}/api`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rixza-acceptance-'));
const ADMIN = { email: 'founder@rixza.test', password: 'AcceptanceTest2026' };

let passed = 0;
const failures: string[] = [];
function check(cond: unknown, label: string) {
  if (cond) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failures.push(label);
    console.log(`  \x1b[31m✗ ${label}\x1b[0m`);
  }
}
const step = (n: number | string, title: string) => console.log(`\n\x1b[1m${n}. ${title}\x1b[0m`);

class Session {
  cookie = '';
  async req<T = any>(method: string, p: string, body?: unknown, opts: { csrf?: boolean } = {}): Promise<{ status: number; data: T }> {
    const isForm = body instanceof FormData;
    const res = await fetch(BASE + p, {
      method,
      headers: {
        ...(opts.csrf === false ? {} : { 'x-requested-with': 'rixza' }),
        ...(body !== undefined && !isForm ? { 'content-type': 'application/json' } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) if (c.startsWith('rixza_session=')) this.cookie = c.split(';')[0];
    const text = await res.text();
    let data: any = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* binary or text */
    }
    return { status: res.status, data };
  }
  get = <T = any>(p: string) => this.req<T>('GET', p);
  post = <T = any>(p: string, b: unknown = {}) => this.req<T>('POST', p, b);
  patch = <T = any>(p: string, b: unknown) => this.req<T>('PATCH', p, b);
  async login(email: string, password: string) {
    return this.post('/auth/login', { email, password });
  }
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Server did not start');
}

async function inviteTokenFor(admin: Session, email: string) {
  const out = await admin.get<{ to_email: string; body: string }[]>('/admin/outbox');
  const mail = out.data.find((m) => m.to_email === email && m.body.includes('/invite/'));
  return mail?.body.match(/\/invite\/([A-Za-z0-9_-]+)/)?.[1];
}

async function main() {
  // ACCEPTANCE_ENTRY=scripts/serve-vercel-output.mjs tests the bundled Vercel output instead.
  const entry = process.env.ACCEPTANCE_ENTRY ?? 'server/index.ts';
  const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', entry], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR, NODE_ENV: 'test', SKIP_SEED: '1', BOOTSTRAP_ADMIN_EMAIL: ADMIN.email, BOOTSTRAP_ADMIN_PASSWORD: ADMIN.password, EMAIL_LOG: 'off' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverErr = '';
  server.stderr.on('data', (d) => (serverErr += d));
  try {
    await waitForServer();
    const admin = new Session();
    const clientA = new Session();
    const clientB = new Session();
    const anon = new Session();

    step(0, 'Security baseline');
    check((await anon.get('/projects')).status === 401, 'Unauthenticated API access is rejected (401)');
    check((await admin.req('POST', '/auth/login', { ...ADMIN }, { csrf: false })).status === 403, 'Mutating request without CSRF header is rejected (403)');
    check((await admin.login(ADMIN.email, 'wrong-password-1')).status === 401, 'Wrong password is rejected');
    check((await admin.login(ADMIN.email, ADMIN.password)).status === 200, 'Super Admin signs in');

    step(1, 'Administrator creates a client account');
    const created = await admin.post<{ id: string; userId: string }>('/admin/clients', { company: 'Acme Hotels', name: 'Clara Client', email: 'clara@acme.test', invite: true });
    check(created.status === 201 && created.data.id, 'Client organisation + primary contact created');
    const clientId = created.data.id;

    step(2, 'Administrator invites the client');
    const tokenA = await inviteTokenFor(admin, 'clara@acme.test');
    check(!!tokenA, 'Invitation email with a one-time activation link is in the outbox');
    check((await clientA.login('clara@acme.test', 'whatever123')).status === 401, 'Invited (not yet activated) user cannot sign in');

    step(3, 'Client receives the invitation and activates the account');
    const inv = await anon.get(`/auth/invite/${tokenA}`);
    check(inv.status === 200 && inv.data.company === 'Acme Hotels', 'Invitation link resolves to the right organisation');
    check((await clientA.post('/auth/invite/accept', { token: tokenA, name: 'Clara Client', password: 'short' })).status === 400, 'Weak password is rejected');
    const acc = await clientA.post('/auth/invite/accept', { token: tokenA, name: 'Clara Client', password: 'ClientPassw0rd!' });
    check(acc.status === 200 && clientA.cookie, 'Account activated and signed in');
    check((await anon.post('/auth/invite/accept', { token: tokenA, name: 'X', password: 'ClientPassw0rd!' })).status === 400, 'Invitation link cannot be reused');

    step(4, 'Administrator creates a project and assigns it to the client');
    const me = (await admin.get('/auth/me')).data.user;
    const templates = (await admin.get<any[]>('/admin/templates')).data;
    const tpl = templates.find((t) => t.name === 'Website Development');
    const start = new Date().toISOString().slice(0, 10);
    const due = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);
    const proj = await admin.post<{ id: string }>('/projects', { client_id: clientId, name: 'Acme Website', type: 'Website', start_date: start, due_date: due, template_id: tpl.id, manager_id: me.id });
    check(proj.status === 201, 'Project created from the Website Development template');
    const pid = proj.data.id;

    step(5, 'Administrator defines phases, milestones and tasks');
    const roadmap0 = (await admin.get(`/projects/${pid}/roadmap`)).data;
    check(roadmap0.phases.length === 10 && roadmap0.milestones.length > 0, `Template produced ${roadmap0.phases.length} phases and ${roadmap0.milestones.length} milestones`);
    const ph = await admin.post(`/projects/${pid}/phases`, { name: 'Post-launch Support', start_date: due, end_date: due });
    check(ph.status === 201, 'Custom phase added');
    const msDate = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
    const ms = await admin.post<{ id: string }>(`/projects/${pid}/milestones`, { title: 'Kick-off complete', due_date: msDate, phase_id: roadmap0.phases[0].id, visibility: 'client' });
    check(ms.status === 201, 'Client-visible milestone created');
    const clientTask = await admin.post(`/projects/${pid}/tasks`, { title: 'Validate the sitemap', status: 'in_review', visibility: 'client', client_action: true, phase_id: roadmap0.phases[0].id, due_date: msDate });
    const internalTask = await admin.post(`/projects/${pid}/tasks`, { title: 'SECRET internal margin review', status: 'todo', visibility: 'internal', phase_id: roadmap0.phases[0].id });
    check(clientTask.status === 201 && internalTask.status === 201, 'Client-visible and internal tasks created');
    const internalThread = await admin.post<{ id: string }>(`/projects/${pid}/threads`, { title: 'Internal resourcing', body: 'SECRET internal note', visibility: 'internal' });
    check(internalThread.status === 201, 'Internal discussion created');
    await admin.post(`/projects/${pid}/comments`, { target: 'task', target_id: clientTask.data.id, body: 'SECRET internal comment', visibility: 'internal' });

    step(6, 'Client logs in and sees the dedicated workspace');
    await clientA.post('/auth/logout');
    check((await clientA.login('clara@acme.test', 'ClientPassw0rd!')).status === 200, 'Client signs in with the new password');
    const meA = (await clientA.get('/auth/me')).data;
    check(meA.projects.length === 1 && meA.projects[0].id === pid, 'Client sees exactly their project');
    check((await clientA.get('/admin/overview')).status === 403, 'Client cannot reach the admin workspace API');

    step(7, 'Client sees the actual progress');
    const ov1 = (await clientA.get(`/projects/${pid}/overview`)).data;
    check(typeof ov1.progress === 'number' && ov1.progressBasis === 'tasks', `Progress is computed from tasks (${ov1.progress}%)`);
    check(ov1.attention.some((a: any) => a.id === clientTask.data.id), '“Your attention is needed” lists the client action');
    const allTasks = (await admin.get<any[]>(`/projects/${pid}/tasks`)).data;
    for (const t of allTasks.filter((t) => t.phase_id === roadmap0.phases[0].id && t.id !== clientTask.data.id)) await admin.post(`/tasks/${t.id}/move`, { status: 'completed', position: t.position });
    const ov2 = (await clientA.get(`/projects/${pid}/overview`)).data;
    check(ov2.progress > ov1.progress, `Completing tasks raises progress (${ov1.progress}% → ${ov2.progress}%)`);
    check(ov2.phases[0].status === 'in_progress', 'Phase moved to in progress automatically');

    step(8, 'Client navigates the Kanban board and calendar');
    const tasksA = (await clientA.get<any[]>(`/projects/${pid}/tasks`)).data;
    check(tasksA.some((t) => t.id === clientTask.data.id), 'Client-visible task is on the client board');
    check(!tasksA.some((t) => t.visibility === 'internal') && !JSON.stringify(tasksA).includes('SECRET'), 'No internal task is visible to the client');
    check((await clientA.get(`/tasks/${internalTask.data.id}`)).status === 404, 'Internal task is not reachable by id (404)');
    const cal = (await clientA.get<any[]>(`/projects/${pid}/calendar?from=${start}&to=${due}`)).data;
    check(cal.some((i) => i.source === 'milestone' && i.source_id === ms.data.id), 'Milestone appears on the client calendar');
    check((await clientA.post(`/tasks/${internalTask.data.id}/move`, { status: 'completed', position: 1 })).status === 404, 'Client cannot move internal tasks');
    const otherVisible = tasksA.find((t) => t.id !== clientTask.data.id);
    if (otherVisible) check((await clientA.post(`/tasks/${otherVisible.id}/move`, { status: 'completed', position: 1 })).status === 403, 'Client cannot move ordinary tasks (server-enforced)');

    step(9, 'Client opens a task and leaves a comment');
    const td = (await clientA.get(`/tasks/${clientTask.data.id}`)).data;
    check(td.task.title === 'Validate the sitemap', 'Task detail opens');
    check(!JSON.stringify(td).includes('SECRET'), 'Internal comments on the task are hidden from the client');
    const cm = await clientA.post(`/projects/${pid}/comments`, { target: 'task', target_id: clientTask.data.id, body: 'Looks good — one question on the footer.' });
    check(cm.status === 201, 'Client comment posted');
    check((await clientA.post(`/projects/${pid}/comments`, { target: 'task', target_id: clientTask.data.id, body: 'x', visibility: 'internal' })).status === 403, 'Client cannot post internal comments');

    step(10, 'The RIXZA team receives the comment');
    const notesAdmin = (await admin.get<any[]>('/notifications')).data;
    check(notesAdmin.some((n) => n.type.startsWith('comment') && n.link?.includes(clientTask.data.id)), 'Project manager notified, linking to the task');
    const threadsA = (await clientA.get<any[]>(`/projects/${pid}/threads`)).data;
    check(!threadsA.some((t) => t.id === internalThread.data.id), 'Internal discussion hidden from the client list');
    check((await clientA.get(`/threads/${internalThread.data.id}`)).status === 404, 'Internal discussion not reachable by id');

    step(11, 'The RIXZA team submits a deliverable');
    const dl = await admin.post<{ id: string }>(`/projects/${pid}/deliverables`, { title: 'Homepage design', task_id: clientTask.data.id, review_due: msDate });
    check(dl.status === 201, 'Draft deliverable created');
    check((await clientA.get(`/deliverables/${dl.data.id}`)).status === 404, 'Draft is invisible to the client');
    const fd = new FormData();
    fd.append('files', new Blob(['fake png bytes'], { type: 'image/png' }), 'homepage-v1.png');
    fd.append('notes', 'First version');
    fd.append('submit', 'true');
    const v1 = await admin.req('POST', `/deliverables/${dl.data.id}/versions`, fd);
    check(v1.status === 201 && v1.data.version === 1, 'Version 1 uploaded and submitted');

    step(12, 'The client receives a notification');
    const notesA = (await clientA.get<any[]>('/notifications')).data;
    check(notesA.some((n) => n.type === 'deliverable.submitted' && n.link === `deliverables/${dl.data.id}`), 'Client notified with a direct link to the deliverable');
    check((await clientA.post(`/tasks/${clientTask.data.id}/move`, { status: 'approved', position: 1 })).status === 403, 'Linked task cannot be approved from the board — only through the deliverable');

    step(13, 'Client reviews and requests changes, then approves');
    const d1 = (await clientA.get(`/deliverables/${dl.data.id}`)).data;
    check(d1.versions.length === 1 && d1.versions[0].files.length === 1, 'Client sees version 1 and its file');
    const fileId = d1.versions[0].files[0].id;
    const dlFile = await clientA.get(`/files/${fileId}/download`);
    check(dlFile.status === 200, 'Client downloads the deliverable file through the authorised endpoint');
    await clientA.post(`/deliverables/${dl.data.id}/view`);
    check((await clientA.get(`/deliverables/${dl.data.id}`)).data.deliverable.status === 'awaiting_feedback', 'Opening it moves status to Awaiting Client Feedback');
    check((await clientA.post(`/deliverables/${dl.data.id}/decision`, { decision: 'changes_requested', version: 1, confirm: true })).status === 400, 'Change request without feedback is rejected');
    const chg = await clientA.post(`/deliverables/${dl.data.id}/decision`, { decision: 'changes_requested', version: 1, feedback: 'Bigger booking button please', confirm: true });
    check(chg.status === 200, 'Changes requested on v1');
    const fd2 = new FormData();
    fd2.append('link_url', 'https://staging.example.com');
    fd2.append('notes', 'Bigger booking button');
    fd2.append('submit', 'true');
    check((await admin.req('POST', `/deliverables/${dl.data.id}/versions`, fd2)).status === 201, 'Team submits version 2');
    check((await clientA.post(`/deliverables/${dl.data.id}/decision`, { decision: 'approved', version: 1, confirm: true })).status === 409, 'Approving a stale version is refused');
    const ok = await clientA.post(`/deliverables/${dl.data.id}/decision`, { decision: 'approved', version: 2, confirm: true });
    check(ok.status === 200, 'Client approves version 2');

    step(14, 'Approval and revision request are recorded');
    const d2 = (await admin.get(`/deliverables/${dl.data.id}`)).data;
    check(d2.deliverable.status === 'approved', 'Deliverable status is Approved');
    const appr = d2.approvals.find((a: any) => a.decision === 'approved');
    check(appr && appr.version === 2 && appr.user_name === 'Clara Client' && appr.created_at, 'Approval stored with user, version and timestamp');
    check(d2.revisions.length === 1 && d2.revisions[0].status === 'resolved' && d2.revisions[0].resolved_version === 2, 'Revision request linked to v1 and resolved by v2');
    const comments = d2.comments as any[];
    check(Array.isArray(comments), 'Comments are kept separate from approvals');

    step(15, 'Timeline and activity history reflect the changes');
    const act = (await clientA.get<any[]>(`/projects/${pid}/activity`)).data;
    check(act.some((a) => a.action === 'deliverable.approved') && act.some((a) => a.action === 'deliverable.changes_requested'), 'Activity history shows the review decisions');
    check(!act.some((a) => a.visibility === 'internal'), 'Client activity feed contains no internal entries');
    const t2 = (await admin.get(`/tasks/${clientTask.data.id}`)).data.task;
    check(t2.status === 'approved', 'Linked task moved to Approved');
    await admin.patch(`/projects/milestones/${ms.data.id}`, { due_date: due });
    const cal2 = (await clientA.get<any[]>(`/projects/${pid}/calendar?from=${start}&to=${due}`)).data;
    check(cal2.find((i) => i.source_id === ms.data.id)?.starts_at === due, 'Rescheduled milestone moves on the client calendar');
    const notesA2 = (await clientA.get<any[]>('/notifications')).data;
    check(notesA2.some((n) => n.type === 'deadline.changed'), 'Client notified of the deadline change');

    step(16, 'A second client cannot access any of the first client’s data');
    const cB = await admin.post<{ id: string }>('/admin/clients', { company: 'Beta Legal', name: 'Bob Beta', email: 'bob@beta.test', invite: true });
    const tokenB = await inviteTokenFor(admin, 'bob@beta.test');
    await clientB.post('/auth/invite/accept', { token: tokenB, name: 'Bob Beta', password: 'BetaPassw0rd!' });
    check(cB.status === 201 && clientB.cookie, 'Second client activated');
    check((await clientB.get<any[]>('/projects')).data.length === 0, 'Project list is empty for the second client');
    check((await clientB.get(`/projects/${pid}`)).status === 404, 'Project is not reachable (404, existence not disclosed)');
    check((await clientB.get(`/projects/${pid}/tasks`)).status === 404, 'Tasks not reachable');
    check((await clientB.get(`/tasks/${clientTask.data.id}`)).status === 404, 'Task not reachable by id');
    check((await clientB.get(`/deliverables/${dl.data.id}`)).status === 404, 'Deliverable not reachable');
    check((await clientB.get(`/files/${fileId}/download`)).status === 404, 'File download refused');
    check((await clientB.get(`/projects/${pid}/calendar`)).status === 404, 'Calendar not reachable');
    check((await clientB.post(`/projects/${pid}/comments`, { target: 'task', target_id: clientTask.data.id, body: 'hi' })).status === 404, 'Cannot comment on the other client’s task');
    check((await clientB.post(`/deliverables/${dl.data.id}/decision`, { decision: 'approved', version: 2, confirm: true })).status === 404, 'Cannot approve the other client’s deliverable');
    const fdB = new FormData();
    fdB.append('files', new Blob(['x']), 'x.txt');
    check((await clientB.req('POST', `/projects/${pid}/files`, fdB)).status === 404, 'Cannot upload into the other client’s project');

    step('+', 'Additional permission checks');
    await admin.post(`/admin/clients/${clientId}/users`, { name: 'Colin Collab', email: 'colin@acme.test', role: 'client_collaborator' });
    const collab = new Session();
    await collab.post('/auth/invite/accept', { token: await inviteTokenFor(admin, 'colin@acme.test'), name: 'Colin Collab', password: 'CollabPassw0rd!' });
    const dl2 = await admin.post<{ id: string }>(`/projects/${pid}/deliverables`, { title: 'Brand guidelines' });
    const fd3 = new FormData();
    fd3.append('link_url', 'https://example.com/guidelines');
    fd3.append('submit', 'true');
    await admin.req('POST', `/deliverables/${dl2.data.id}/versions`, fd3);
    check((await collab.post(`/deliverables/${dl2.data.id}/decision`, { decision: 'approved', version: 1, confirm: true })).status === 403, 'Client Collaborator cannot formally approve');
    check((await collab.get(`/deliverables/${dl2.data.id}`)).status === 200, 'Client Collaborator can view the deliverable');
    await admin.patch(`/admin/clients/${clientId}`, { status: 'suspended' });
    check((await clientA.get('/projects')).status === 401, 'Suspending the client revokes active sessions immediately');
  } finally {
    const exited = new Promise((r) => server.once('exit', r));
    server.kill();
    await exited;
    // Windows may hold the SQLite file briefly after exit.
    for (let i = 0; i < 10; i++) {
      try {
        fs.rmSync(DATA_DIR, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  }
  console.log(`\n${failures.length ? '\x1b[31m' : '\x1b[32m'}${passed} passed, ${failures.length} failed\x1b[0m`);
  if (failures.length) {
    if (serverErr) console.log('\nServer stderr:\n' + serverErr.slice(-3000));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
