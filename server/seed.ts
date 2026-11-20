import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { UPLOAD_DIR, all, db, get, insert, run, tx } from './db.ts';
import { hashPassword } from './lib/auth.ts';
import { newId } from './lib/util.ts';
import { DEFAULT_TEMPLATES } from './templates.ts';
import { instantiateTemplate } from './routes/projects.ts';

export const DEMO_PASSWORD = 'RixzaDemo2026';

const DAY = 864e5;
const ago = (days: number, hours = 10) => {
  const d = new Date(Date.now() - days * DAY);
  d.setUTCHours(hours, (days * 37) % 60, 0, 0);
  return d.toISOString();
};
const dateIn = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

// ---- tiny PNG generator for a believable design preview ----
function crc32(buf: Buffer) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function mockupPng(w = 960, h = 600) {
  type Rect = [number, number, number, number, [number, number, number]];
  const rects: Rect[] = [
    [0, 0, w, h, [250, 250, 250]],
    [0, 0, w, 56, [255, 255, 255]],
    [40, 22, 90, 12, [0, 0, 0]],
    [560, 24, 60, 8, [160, 160, 168]], [640, 24, 60, 8, [160, 160, 168]], [720, 24, 60, 8, [160, 160, 168]],
    [820, 16, 100, 26, [0, 0, 255]],
    [0, 56, w, 1, [232, 232, 236]],
    [40, 120, 420, 28, [10, 10, 10]], [40, 160, 360, 28, [10, 10, 10]],
    [40, 214, 380, 8, [150, 150, 158]], [40, 232, 330, 8, [150, 150, 158]],
    [40, 270, 140, 36, [0, 0, 255]],
    [500, 96, 420, 240, [20, 20, 24]], [520, 280, 120, 6, [0, 0, 255]],
    [40, 380, 280, 180, [255, 255, 255]], [340, 380, 280, 180, [255, 255, 255]], [640, 380, 280, 180, [255, 255, 255]],
    [60, 400, 120, 10, [10, 10, 10]], [360, 400, 120, 10, [10, 10, 10]], [660, 400, 120, 10, [10, 10, 10]],
    [60, 424, 220, 6, [180, 180, 186]], [360, 424, 220, 6, [180, 180, 186]], [660, 424, 220, 6, [180, 180, 186]],
  ];
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      let col: [number, number, number] = [255, 255, 255];
      for (const [rx, ry, rw, rh, c] of rects) if (x >= rx && x < rx + rw && y >= ry && y < ry + rh) col = c;
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = col[0]; raw[o + 1] = col[1]; raw[o + 2] = col[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function writeFile(projectId: string, name: string, mime: string, content: Buffer | string, o: { category: string; by: string; visibility: 'client' | 'internal'; at: string; task_id?: string; deliverable_version_id?: string; comment_id?: string; version?: number; supersedes_id?: string }) {
  const key = crypto.randomBytes(24).toString('hex');
  const buf = typeof content === 'string' ? Buffer.from(content) : content;
  fs.writeFileSync(path.join(UPLOAD_DIR, key), buf);
  const id = newId();
  insert('files', { id, project_id: projectId, category: o.category, name, mime, size: buf.length, storage_key: key, uploaded_by: o.by, visibility: o.visibility, task_id: o.task_id, deliverable_version_id: o.deliverable_version_id, comment_id: o.comment_id, version: o.version ?? 1, supersedes_id: o.supersedes_id, created_at: o.at });
  return id;
}

const act = (projectId: string | null, actor: string | null, action: string, summary: string, at: string, visibility: 'client' | 'internal' = 'client', entity?: [string, string, string?]) =>
  insert('activity', { id: newId(), project_id: projectId, actor_id: actor, action, summary, entity_type: entity?.[0], entity_id: entity?.[1], entity_label: entity?.[2], visibility, created_at: at });

export function resetDatabase() {
  const tables = all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map((t) => t.name);
  db.exec('PRAGMA foreign_keys = OFF');
  for (const t of tables) db.exec(`DELETE FROM ${t}`);
  db.exec('PRAGMA foreign_keys = ON');
  for (const f of fs.readdirSync(UPLOAD_DIR)) fs.unlinkSync(path.join(UPLOAD_DIR, f));
}

export async function seedDemo() {
  const pw = await hashPassword(DEMO_PASSWORD);
  tx(() => {
    const at = ago(60);
    const user = (email: string, name: string, role: string, title: string | null, client_id: string | null = null, status = 'active') => {
      const id = newId();
      insert('users', { id, email, name, title, role, client_id, status, password_hash: status === 'active' ? pw : null, created_at: at, updated_at: at, last_login_at: status === 'active' ? ago(1) : null });
      return id;
    };
    const admin = user('admin@rixza.com', 'Alex Durand', 'super_admin', 'Managing Director');
    const pm = user('lea@rixza.com', 'Léa Martin', 'project_manager', 'Senior Project Manager');
    const designer = user('sam@rixza.com', 'Sam Okafor', 'team_member', 'Lead Product Designer');
    const dev = user('noah@rixza.com', 'Noah Berg', 'team_member', 'Full-Stack Engineer');

    const templateIds: Record<string, string> = {};
    for (const t of DEFAULT_TEMPLATES) {
      const id = newId();
      templateIds[t.name] = id;
      insert('templates', { id, name: t.name, description: t.description, project_type: t.project_type, definition: JSON.stringify(t.definition), created_by: admin, created_at: at, updated_at: at });
    }

    const client = (company: string, name: string, email: string, website: string) => {
      const id = newId();
      insert('clients', { id, name, company, email, website, status: 'active', created_at: at, updated_at: at });
      act(null, admin, 'client.created', `Client account created for ${company}`, at, 'internal', ['client', id, company]);
      return id;
    };

    // ================= Client 1 — Northwind Hotels (project well underway) =================
    const northwind = client('Northwind Hotels', 'Amelia Clarke', 'amelia@northwind.example', 'https://northwind.example');
    const amelia = user('amelia@northwind.example', 'Amelia Clarke', 'client', 'Head of Marketing', northwind);
    const james = user('james@northwind.example', 'James Whitfield', 'client_collaborator', 'Digital Coordinator', northwind);

    const p1 = newId();
    insert('projects', { id: p1, client_id: northwind, name: 'Corporate Website Redesign', type: 'Website', description: 'A new multilingual corporate website for Northwind Hotels with room showcases, a booking engine integration and a CMS your team can manage.', manager_id: pm, start_date: dateIn(-42), due_date: dateIn(68), status: 'active', health: 'on_track', internal_notes: 'Client is responsive. Booking engine API keys pending from their IT vendor — follow up weekly.', template_id: templateIds['Website Development'], created_at: ago(43), updated_at: ago(1) });
    for (const m of [pm, designer, dev]) insert('project_members', { project_id: p1, user_id: m, created_at: ago(43) });
    instantiateTemplate(p1, DEFAULT_TEMPLATES[0].definition, dateIn(-42), dateIn(68), pm, pm);
    act(p1, pm, 'project.created', 'Project workspace created from the Website Development template', ago(43), 'client', ['project', p1]);

    const phases = all<{ id: string; name: string; position: number }>('SELECT id, name, position FROM phases WHERE project_id = ? ORDER BY position', p1);
    const tasks = all<{ id: string; title: string; phase_id: string; visibility: string }>('SELECT id, title, phase_id, visibility FROM tasks WHERE project_id = ?', p1);
    const T = (title: string) => tasks.find((t) => t.title === title)!;
    const setTask = (title: string, status: string, o: { assignee?: string; due?: string; doneAt?: string } = {}) =>
      run('UPDATE tasks SET status = ?, assignee_id = COALESCE(?, assignee_id), due_date = COALESCE(?, due_date), completed_at = ?, updated_at = ? WHERE id = ?', status, o.assignee ?? null, o.due ?? null, ['approved', 'completed'].includes(status) ? (o.doneAt ?? ago(20)) : null, o.doneAt ?? ago(2), T(title).id);

    // Phase 1 & 2 complete
    setTask('Kick-off workshop', 'completed', { assignee: pm, doneAt: ago(41) });
    setTask('Submit company information & brand assets', 'completed', { doneAt: ago(37) });
    setTask('Competitive & audience analysis', 'completed', { assignee: designer, doneAt: ago(35) });
    setTask('Project brief validation', 'approved', { doneAt: ago(33) });
    setTask('Sitemap & page inventory', 'completed', { assignee: designer, doneAt: ago(28) });
    setTask('Wireframes for key pages', 'completed', { assignee: designer, doneAt: ago(24) });
    setTask('Technical architecture & hosting plan', 'completed', { assignee: dev, doneAt: ago(25) });
    setTask('Review the proposed site structure', 'approved', { doneAt: ago(22) });
    // Phase 3 — UI/UX in progress
    setTask('Moodboard & visual direction', 'completed', { assignee: designer, doneAt: ago(15) });
    setTask('Homepage design', 'in_review', { assignee: designer, due: dateIn(2) });
    setTask('Inner page templates', 'in_progress', { assignee: designer, due: dateIn(9) });
    setTask('Design system & components', 'in_progress', { assignee: designer, due: dateIn(12) });
    setTask('Approve homepage design', 'in_review', { assignee: pm, due: dateIn(4) });
    setTask('Approve inner page designs', 'todo', { assignee: pm, due: dateIn(14) });
    setTask('Development environment setup', 'todo', { assignee: dev, due: dateIn(8) });
    setTask('Provide final page content', 'todo', { due: dateIn(30) });
    run(`UPDATE tasks SET priority = 'high' WHERE id = ?`, T('Inner page templates').id);
    // Keep the demo timeline realistic: current design phase still within schedule.
    run('UPDATE phases SET end_date = ? WHERE id = ?', dateIn(6), phases[2].id);
    run('UPDATE phases SET start_date = ?, end_date = ? WHERE id = ?', dateIn(7), dateIn(12), phases[3].id);
    run('UPDATE milestones SET due_date = ? WHERE phase_id = ?', dateIn(12), phases[3].id);
    run(`UPDATE phases SET status = 'completed' WHERE project_id = ? AND position IN (0, 1)`, p1);
    run(`UPDATE phases SET status = 'in_progress' WHERE project_id = ? AND position = 2`, p1);
    run(`UPDATE milestones SET status = 'completed', completed_at = ? WHERE project_id = ? AND phase_id IN (?, ?)`, ago(22), p1, phases[0].id, phases[1].id);

    act(p1, pm, 'phase.started', 'Discovery & Strategy phase started', ago(42), 'client', ['phase', phases[0].id, phases[0].name]);
    act(p1, amelia, 'file.uploaded', 'New document uploaded: Northwind brand guidelines 2025.txt', ago(37));
    act(p1, pm, 'phase.completed', 'Discovery & Strategy phase completed', ago(33), 'client', ['phase', phases[0].id, phases[0].name]);
    act(p1, pm, 'milestone.completed', 'Milestone reached: Strategy approved', ago(33));
    act(p1, pm, 'phase.started', 'Planning & Architecture phase started', ago(32), 'client', ['phase', phases[1].id, phases[1].name]);
    act(p1, amelia, 'deliverable.changes_requested', 'Amelia Clarke requested changes to Site structure & wireframes (version 1)', ago(26));
    act(p1, amelia, 'deliverable.approved', 'Site structure & wireframes approved by Amelia Clarke (version 2)', ago(22));
    act(p1, pm, 'phase.completed', 'Planning & Architecture phase completed', ago(22), 'client', ['phase', phases[1].id, phases[1].name]);
    act(p1, pm, 'milestone.completed', 'Milestone reached: Structure approved', ago(22));
    act(p1, designer, 'phase.started', 'UI/UX Design phase started', ago(21), 'client', ['phase', phases[2].id, phases[2].name]);
    act(p1, designer, 'task.status', 'Moodboard & visual direction moved to Completed', ago(15), 'client', ['task', T('Moodboard & visual direction').id, 'Moodboard & visual direction']);
    act(p1, dev, 'task.status', 'Development environment setup moved to To Do', ago(6), 'internal', ['task', T('Development environment setup').id, 'Development environment setup']);
    act(p1, designer, 'task.status', 'Homepage design moved to In Review', ago(1, 9), 'client', ['task', T('Homepage design').id, 'Homepage design']);

    // Files
    writeFile(p1, 'Northwind brand guidelines 2025.txt', 'text/plain', 'Northwind Hotels — Brand guidelines (excerpt)\n\nPrimary colours: Deep Navy #12233F, Sand #E9DFCF\nTypeface: Canela (headlines), Inter (body)\nTone of voice: warm, discreet, confident.\n', { category: 'Brand Assets', by: amelia, visibility: 'client', at: ago(37) });
    writeFile(p1, 'Project brief.md', 'text/markdown', '# Corporate Website Redesign — Brief\n\n## Goals\n- Increase direct bookings by 20%\n- Showcase the 14 properties consistently\n- Give the marketing team autonomy through a CMS\n\n## Audience\nLeisure and business travellers, event planners.\n', { category: 'Brief & Requirements', by: pm, visibility: 'client', at: ago(40) });
    writeFile(p1, 'Room photography inventory.csv', 'text/csv', 'property,rooms,photos_available\nLondon Mayfair,42,yes\nEdinburgh Old Town,28,partial\nBath Spa,19,no\n', { category: 'Documents', by: james, visibility: 'client', at: ago(12) });
    writeFile(p1, 'Resourcing & margin.txt', 'text/plain', 'INTERNAL — Design: 18d, Dev: 32d, PM: 9d. Margin target 38%.\n', { category: 'Reports', by: pm, visibility: 'internal', at: ago(30) });

    // Deliverables
    const deliverable = (title: string, description: string, status: string, phaseIdx: number, taskTitle: string | null, created: string, review_due: string | null, version: number) => {
      const id = newId();
      insert('deliverables', { id, project_id: p1, phase_id: phases[phaseIdx].id, task_id: taskTitle ? T(taskTitle).id : null, title, description, status, review_due, current_version: version, created_by: pm, created_at: created, updated_at: ago(1) });
      return id;
    };
    const version = (deliverableId: string, v: number, by: string, at: string, notes: string | null, link?: string) => {
      const id = newId();
      insert('deliverable_versions', { id, deliverable_id: deliverableId, version: v, notes, link_url: link ?? null, submitted_by: by, submitted_at: at, created_at: at });
      return id;
    };
    const approval = (deliverableId: string, versionId: string, v: number, decision: string, feedback: string | null, at: string) => {
      const id = newId();
      insert('approvals', { id, deliverable_id: deliverableId, version_id: versionId, version: v, user_id: amelia, decision, feedback, ip: '127.0.0.1', created_at: at });
      return id;
    };

    const d1 = deliverable('Project brief & strategy', 'Goals, audiences, positioning and success metrics for the new website.', 'finalized', 0, 'Project brief validation', ago(36), null, 1);
    const d1v1 = version(d1, 1, pm, ago(35), 'Strategy document following the kick-off workshop.');
    writeFile(p1, 'Strategy document v1.md', 'text/markdown', '# Strategy\n\nPositioning: “Quietly exceptional stays.”\n\nKPIs: direct bookings, newsletter sign-ups, event enquiries.\n', { category: 'Final Deliverables', by: pm, visibility: 'client', at: ago(35), deliverable_version_id: d1v1 });
    approval(d1, d1v1, 1, 'approved', 'Clear and aligned with our goals. Approved.', ago(33));

    const d2 = deliverable('Site structure & wireframes', 'Sitemap and low-fidelity wireframes for the home, property, room and booking pages.', 'approved', 1, 'Review the proposed site structure', ago(28), null, 2);
    const d2v1 = version(d2, 1, designer, ago(27), 'First proposal of the site structure.');
    writeFile(p1, 'Sitemap v1.txt', 'text/plain', 'Home\n├── Hotels\n│   └── Property\n│       └── Rooms\n├── Offers\n├── Events\n└── About\n', { category: 'Design Files', by: designer, visibility: 'client', at: ago(27), deliverable_version_id: d2v1 });
    const a2 = approval(d2, d2v1, 1, 'changes_requested', 'Could we bring “Offers” into the main navigation and add a Meetings & Events section per property?', ago(26));
    const d2v2 = version(d2, 2, designer, ago(24), 'Offers promoted to the main navigation. Added Meetings & Events per property.');
    writeFile(p1, 'Sitemap v2.txt', 'text/plain', 'Home\n├── Hotels\n│   └── Property\n│       ├── Rooms\n│       └── Meetings & Events\n├── Offers\n├── Events\n└── About\n', { category: 'Design Files', by: designer, visibility: 'client', at: ago(24), deliverable_version_id: d2v2 });
    insert('revision_requests', { id: newId(), deliverable_id: d2, version_id: d2v1, approval_id: a2, requested_by: amelia, details: 'Could we bring “Offers” into the main navigation and add a Meetings & Events section per property?', status: 'resolved', resolved_by: designer, resolved_version_id: d2v2, created_at: ago(26), resolved_at: ago(24) });
    approval(d2, d2v2, 2, 'approved', null, ago(22));

    const d3 = deliverable('Homepage design', 'High-fidelity homepage design, desktop and mobile.', 'submitted', 3, 'Approve homepage design', ago(5), dateIn(4), 1);
    const d3v1 = version(d3, 1, designer, ago(1, 9), 'Desktop homepage in the agreed visual direction. Mobile variant follows the same structure.');
    writeFile(p1, 'Homepage — desktop.png', 'image/png', mockupPng(), { category: 'Design Files', by: designer, visibility: 'client', at: ago(1, 9), deliverable_version_id: d3v1 });
    act(p1, designer, 'deliverable.submitted', 'Homepage design submitted for review (version 1)', ago(1, 9), 'client', ['deliverable', d3, 'Homepage design']);

    const d4 = deliverable('Inner page templates', 'Property, room and offer page templates.', 'draft', 2, 'Inner page templates', ago(3), dateIn(12), 0);
    void d4;

    // Comments
    const comment = (target: 'task_id' | 'thread_id' | 'deliverable_id', id: string, author: string, body: string, visibility: 'client' | 'internal', at: string, parent?: string) => {
      const cid = newId();
      insert('comments', { id: cid, project_id: p1, [target]: id, author_id: author, body, visibility, created_at: at, parent_id: parent ?? null });
      return cid;
    };
    const hp = T('Homepage design').id;
    const c1 = comment('task_id', hp, amelia, 'Looking forward to seeing this! Please make sure the booking widget is visible above the fold.', 'client', ago(6, 14));
    comment('task_id', hp, designer, 'Absolutely — the booking bar sits directly under the hero on desktop and is sticky on mobile.', 'client', ago(6, 16), c1);
    comment('task_id', hp, pm, 'Internal: keep the hero video optional, their CDN budget is tight.', 'internal', ago(5, 9));
    comment('deliverable_id', d3, pm, 'Hi Amelia, the homepage design is ready for your review. Let us know if you have any questions before approving.', 'client', ago(1, 10));

    const th1 = newId();
    insert('threads', { id: th1, project_id: p1, title: 'Photography for the room pages', visibility: 'client', created_by: james, created_at: ago(12), updated_at: ago(11), last_activity_at: ago(11) });
    comment('thread_id', th1, james, 'We only have partial photography for Edinburgh and none for Bath. Should we plan a shoot or use placeholders for launch?', 'client', ago(12));
    comment('thread_id', th1, pm, 'Good question, James. We recommend a half-day shoot for Bath before content integration (week 9). We’ll use high-quality placeholders in the meantime so design isn’t blocked.', 'client', ago(11));
    act(p1, james, 'thread.created', 'James Whitfield started a discussion: Photography for the room pages', ago(12), 'client', ['thread', th1, 'Photography for the room pages']);

    const th2 = newId();
    insert('threads', { id: th2, project_id: p1, title: 'Booking engine API — vendor follow-up', visibility: 'internal', created_by: dev, created_at: ago(8), updated_at: ago(7), last_activity_at: ago(7) });
    comment('thread_id', th2, dev, 'Still no sandbox keys from their IT vendor. This will block the booking integration in week 8 if we don’t have them by then.', 'internal', ago(8));
    comment('thread_id', th2, pm, 'Flagged on our weekly call. I’ll escalate to Amelia if nothing by Friday.', 'internal', ago(7));

    // Calendar events
    const ev = (title: string, type: string, starts_at: string, o: { all_day?: boolean; status?: string; owner?: string; desc?: string; expectation?: string; deliverable?: string; visibility?: string; ends_at?: string } = {}) =>
      insert('events', { id: newId(), project_id: p1, title, description: o.desc ?? null, type, starts_at, ends_at: o.ends_at ?? null, all_day: o.all_day ? 1 : 0, owner_id: o.owner ?? pm, deliverable_id: o.deliverable ?? null, status: o.status ?? 'scheduled', visibility: o.visibility ?? 'client', client_expectation: o.expectation ?? null, created_at: ago(40), updated_at: ago(40) });
    const at10 = (days: number, h = 10) => { const d = new Date(Date.now() + days * DAY); d.setUTCHours(h, 0, 0, 0); return d.toISOString(); };
    ev('Project kick-off', 'meeting', at10(-41, 9), { status: 'completed', desc: 'Kick-off workshop with the Northwind marketing team.', ends_at: at10(-41, 11) });
    ev('Homepage design review call', 'meeting', at10(3, 14), { desc: 'Walkthrough of the homepage design with Sam and Léa.', expectation: 'Join the call and bring any questions on the homepage design.', ends_at: at10(3, 15) });
    ev('Weekly progress check-in', 'meeting', at10(7, 9), { desc: 'Weekly 30-minute status update.', ends_at: new Date(Date.parse(at10(7, 9)) + 30 * 60e3).toISOString() });
    ev('Staging website delivered', 'delivery', dateIn(55), { all_day: true, desc: 'Full staging website available for your review.' });
    ev('Internal design QA', 'activity', at10(1, 13), { visibility: 'internal', owner: designer, desc: 'Internal review before client presentation.' });

    // Notifications
    const notif = (userId: string, type: string, title: string, link: string, at: string, read = false, body: string | null = null) =>
      insert('notifications', { id: newId(), user_id: userId, project_id: p1, type, title, body, link, created_at: at, read_at: read ? at : null });
    notif(amelia, 'deliverable.submitted', 'New deliverable to review: Homepage design', `deliverables/${d3}`, ago(1, 9), false, `Please review by ${new Date(dateIn(4)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}.`);
    notif(amelia, 'comment.created', 'Léa Martin commented on “Homepage design”', `deliverables/${d3}`, ago(1, 10));
    notif(amelia, 'phase.started', 'UI/UX Design has started', `project#${phases[2].id}`, ago(21), true);
    notif(amelia, 'milestone.completed', 'Milestone reached: Structure approved', 'project', ago(22), true);
    notif(james, 'comment.created', 'Léa Martin commented on “Photography for the room pages”', `discussions/${th1}`, ago(11));
    notif(pm, 'file.uploaded', 'James Whitfield uploaded Room photography inventory.csv', 'files', ago(12), true);

    // ================= Client 2 — Atlas Legal (just started) =================
    const atlas = client('Atlas Legal', 'Sofia Reyes', 'sofia@atlaslegal.example', 'https://atlaslegal.example');
    user('sofia@atlaslegal.example', 'Sofia Reyes', 'client', 'Managing Partner', atlas);
    const p2 = newId();
    insert('projects', { id: p2, client_id: atlas, name: 'Brand Identity', type: 'Branding', description: 'A modern, trustworthy identity for Atlas Legal.', manager_id: pm, start_date: dateIn(-3), due_date: dateIn(45), status: 'onboarding', health: 'on_track', template_id: templateIds['Branding'], created_at: ago(4), updated_at: ago(4) });
    for (const m of [pm, designer]) insert('project_members', { project_id: p2, user_id: m, created_at: ago(4) });
    instantiateTemplate(p2, DEFAULT_TEMPLATES[2].definition, dateIn(-3), dateIn(45), pm, pm);
    run(`UPDATE tasks SET due_date = ? WHERE project_id = ? AND title = 'Complete brand questionnaire'`, dateIn(5), p2);
    insert('activity', { id: newId(), project_id: p2, actor_id: pm, action: 'project.created', summary: 'Project workspace created from the Branding template', entity_type: 'project', entity_id: p2, visibility: 'client', created_at: ago(4) });

    // ================= Client 3 — invited, not yet activated =================
    const helios = client('Helios Energy', 'Marc Lefèvre', 'marc@helios.example', 'https://helios.example');
    user('marc@helios.example', 'Marc Lefèvre', 'client', null, helios, 'invited');
  });
  const count = get<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n;
  console.log(`\n  Demo data ready (${count} users). Sign in with any of these (password: ${DEMO_PASSWORD}):`);
  console.log('    admin@rixza.com            Super Admin');
  console.log('    lea@rixza.com              Project Manager');
  console.log('    sam@rixza.com              Team Member');
  console.log('    amelia@northwind.example   Client — Northwind Hotels');
  console.log('    james@northwind.example    Client Collaborator — Northwind Hotels');
  console.log('    sofia@atlaslegal.example   Client — Atlas Legal\n');
}

/** Production bootstrap: create the first Super Admin from environment variables. */
export async function bootstrapAdmin(email: string, password: string, name = 'RIXZA Admin') {
  if (get('SELECT 1 FROM users')) return;
  const ts = new Date().toISOString();
  insert('users', { id: newId(), email, name, role: 'super_admin', status: 'active', password_hash: await hashPassword(password), created_at: ts, updated_at: ts });
  for (const t of DEFAULT_TEMPLATES) insert('templates', { id: newId(), name: t.name, description: t.description, project_type: t.project_type, definition: JSON.stringify(t.definition), created_at: ts, updated_at: ts });
  console.log(`Super Admin ${email} created.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  if (process.argv.includes('--reset')) resetDatabase();
  await seedDemo();
}
