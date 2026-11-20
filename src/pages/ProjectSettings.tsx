import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAction, useStaffOptions } from '../lib/queries';
import { useWorkspace } from '../lib/workspace';
import { Avatar, Badge, Button, Field, Input, PageHeader, Panel, Select, Textarea } from '../components/ui';
import { HEALTH_LABEL, PROJECT_HEALTH, PROJECT_STATUSES, PROJECT_STATUS_LABEL, ROLE_LABEL, type ProjectHealth, type ProjectStatus } from '../../shared/domain';

export function ProjectSettingsPage() {
  const { pid, detail } = useWorkspace();
  const p = detail.project;
  const staff = useStaffOptions();
  const [f, setF] = useState({ name: '', type: '', description: '', manager_id: '', start_date: '', due_date: '', status: 'active' as ProjectStatus, health: 'on_track' as ProjectHealth, internal_notes: '' });
  const [members, setMembers] = useState<string[]>([]);
  useEffect(() => {
    setF({ name: p.name, type: p.type, description: p.description ?? '', manager_id: p.manager_id ?? '', start_date: p.start_date ?? '', due_date: p.due_date ?? '', status: p.status, health: p.health ?? 'on_track', internal_notes: p.internal_notes ?? '' });
    setMembers(detail.members.map((m) => m.id));
  }, [p, detail.members]);

  const save = useAction(() => api.patch(`/projects/${pid}`, { ...f, description: f.description || null, manager_id: f.manager_id || null, start_date: f.start_date || null, due_date: f.due_date || null, internal_notes: f.internal_notes || null }), { success: 'Project updated', refreshMe: true });
  const saveMembers = useAction(() => api.put(`/projects/${pid}/members`, { user_ids: members }), { success: 'Project team updated' });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Project settings" description={<>Client: <Link to={`/admin/clients/${detail.client.id}`} className="text-brand hover:underline">{detail.client.company}</Link></>} />
      <div className="flex flex-col gap-6">
        <Panel title="General">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Project name" className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Project type"><Input value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} /></Field>
            <Field label="Project manager">
              <Select value={f.manager_id} onChange={(e) => setF({ ...f, manager_id: e.target.value })}>
                <option value="">None</option>
                {staff.data?.filter((u) => u.role !== 'team_member').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </Field>
            <Field label="Start date"><Input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field>
            <Field label="Expected completion" hint="The client is notified when this changes."><Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
            <Field label="Description" className="sm:col-span-2"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={3} /></Field>
          </div>
        </Panel>

        <Panel title="Status" description="The public status is shown to the client. Health is internal only.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status (client visible)">
              <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as ProjectStatus })}>
                {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>)}
              </Select>
            </Field>
            <Field label={<span className="flex items-center gap-1.5">Health <Badge tone="outline">Internal</Badge></span>}>
              <Select value={f.health} onChange={(e) => setF({ ...f, health: e.target.value as ProjectHealth })}>
                {PROJECT_HEALTH.map((h) => <option key={h} value={h}>{HEALTH_LABEL[h]}</option>)}
              </Select>
            </Field>
            <Field label={<span className="flex items-center gap-1.5">Internal notes <Badge tone="outline">Internal</Badge></span>} className="sm:col-span-2">
              <Textarea value={f.internal_notes} onChange={(e) => setF({ ...f, internal_notes: e.target.value })} rows={4} placeholder="Risks, commercial context, follow-ups… never shown to the client." />
            </Field>
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="primary" loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate()}>Save changes</Button>
          </div>
        </Panel>

        <Panel title="Project team" description="Team members can see and work on this project. Task assignees are added automatically.">
          <ul className="grid gap-1 sm:grid-cols-2">
            {staff.data?.map((u) => {
              const on = members.includes(u.id) || u.id === f.manager_id;
              return (
                <li key={u.id}>
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 hover:bg-hover">
                    <input type="checkbox" className="accent-[#0000FF]" checked={on} disabled={u.id === f.manager_id} onChange={(e) => setMembers(e.target.checked ? [...members, u.id] : members.filter((m) => m !== u.id))} />
                    <Avatar name={u.name} size={24} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-13">{u.name}</span>
                      <span className="block truncate text-xs text-muted">{u.title ?? ROLE_LABEL[u.role]}{u.id === f.manager_id ? ' · Manager' : ''}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="mt-4 flex justify-end">
            <Button loading={saveMembers.isPending} onClick={() => saveMembers.mutate()}>Update team</Button>
          </div>
        </Panel>

        <Panel title="Client access" description="People from the client organisation who can access this workspace.">
          {detail.clientUsers.length ? (
            <ul className="flex flex-col gap-1">
              {detail.clientUsers.map((u) => (
                <li key={u.id} className="flex items-center gap-2.5 px-1 py-1.5">
                  <Avatar name={u.name} role={u.role} size={24} />
                  <span className="flex-1 text-13">{u.name} <span className="text-muted">· {u.email}</span></span>
                  <Badge tone="neutral">{ROLE_LABEL[u.role]}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-13 text-muted">No active client users yet.</p>
          )}
          <Link to={`/admin/clients/${detail.client.id}`} className="mt-3 inline-block text-xs font-medium text-brand hover:underline">Manage client access →</Link>
        </Panel>
      </div>
    </div>
  );
}
