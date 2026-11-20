import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Building2, MailPlus, MoreHorizontal, Plus, Search, Send, ShieldOff, ShieldCheck, Pencil } from 'lucide-react';
import { api } from '../../lib/api';
import { useAction, useMe } from '../../lib/queries';
import { fmtDate, fmtRelative } from '../../lib/format';
import { HealthBadge, ProjectStatusBadge } from '../../components/status';
import { Avatar, Badge, Button, Checkbox, EmptyState, ErrorState, Field, IconButton, Input, KeyValue, Menu, MenuItem, Modal, PageHeader, Panel, ProgressBar, Select, Skeleton, Textarea, useConfirm } from '../../components/ui';
import { ROLE_LABEL, can, type Client, type ProjectHealth, type ProjectStatus, type Role } from '../../../shared/domain';

type ClientRow = Client & { project_count: number; user_count: number; last_seen_at: string | null };

function ClientFormModal({ open, onClose, client }: { open: boolean; onClose: () => void; client?: Client }) {
  const navigate = useNavigate();
  const [f, setF] = useState({ company: '', name: '', email: '', phone: '', website: '', notes: '', invite: true });
  useEffect(() => {
    if (open) setF({ company: client?.company ?? '', name: client?.name ?? '', email: client?.email ?? '', phone: client?.phone ?? '', website: client?.website ?? '', notes: client?.notes ?? '', invite: true });
  }, [open, client]);
  const save = useAction(
    () => {
      const body = { company: f.company, name: f.name, email: f.email, phone: f.phone || null, website: f.website || null, notes: f.notes || null };
      return client ? api.patch(`/admin/clients/${client.id}`, body) : api.post<{ id: string }>('/admin/clients', { ...body, invite: f.invite });
    },
    {
      success: client ? 'Client updated' : f.invite ? 'Client created and invitation sent' : 'Client created',
      onSuccess: (r: any) => (onClose(), !client && r?.id && navigate(`/admin/clients/${r.id}`)),
    },
  );
  return (
    <Modal open={open} onClose={onClose} title={client ? 'Edit client' : 'New client'} size="lg"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.company.trim() || !f.name.trim() || !f.email.trim()} onClick={() => save.mutate()}>{client ? 'Save' : f.invite ? 'Create & invite' : 'Create client'}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company" className="sm:col-span-2"><Input value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} autoFocus /></Field>
        <Field label="Primary contact"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Contact email" hint={client ? 'Contact details only — login emails are managed per user.' : 'Used for the portal login.'}><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Phone" optional><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Website" optional><Input value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} /></Field>
        <Field label="Internal notes" optional className="sm:col-span-2"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={2} /></Field>
        {!client && <div className="sm:col-span-2"><Checkbox checked={f.invite} onChange={(v) => setF({ ...f, invite: v })} label="Send the portal invitation now" description="The contact receives a secure link (valid 7 days) to activate their account." /></div>}
      </div>
    </Modal>
  );
}

function InviteUserModal({ open, onClose, clientId }: { open: boolean; onClose: () => void; clientId: string }) {
  const [f, setF] = useState({ name: '', email: '', role: 'client_collaborator' as Role });
  useEffect(() => { if (open) setF({ name: '', email: '', role: 'client_collaborator' }); }, [open]);
  const save = useAction(() => api.post(`/admin/clients/${clientId}/users`, f), { success: 'Invitation sent', onSuccess: onClose });
  return (
    <Modal open={open} onClose={onClose} title="Invite a person" description="Give another person from this organisation access to its projects."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={<Send className="size-3.5" />} loading={save.isPending} disabled={!f.name.trim() || !f.email.trim()} onClick={() => save.mutate()}>Send invitation</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Full name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Role" hint={f.role === 'client' ? 'Full client access, including formal approvals.' : 'Can follow the project, comment and upload files. Cannot approve deliverables.'}>
          <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
            <option value="client_collaborator">Client Collaborator</option>
            <option value="client">Client (can approve)</option>
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

export function ClientsPage() {
  const me = useMe().data!.user!;
  const q = useQuery({ queryKey: ['admin', 'clients'], queryFn: () => api.get<ClientRow[]>('/admin/clients') });
  const [search, setSearch] = useState('');
  const [create, setCreate] = useState(false);
  const list = (q.data ?? []).filter((c) => `${c.company} ${c.name} ${c.email}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <div>
      <PageHeader title="Clients" description="Client organisations, their people and their access." actions={can(me.role, 'clients.manage') && <Button variant="primary" size="sm" icon={<Plus className="size-3.5" />} onClick={() => setCreate(true)}>New client</Button>} />
      <div className="relative mb-3 max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clients" className="pl-8" />
      </div>
      {q.isLoading ? <Skeleton className="h-64" /> : q.error ? <ErrorState error={q.error} /> : list.length === 0 ? (
        <Panel><EmptyState icon={<Building2 />} title={search ? 'No clients match your search' : 'No clients yet'} action={!search && can(me.role, 'clients.manage') && <Button variant="primary" onClick={() => setCreate(true)}>Create the first client</Button>} /></Panel>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <ul>
            {list.map((c) => (
              <li key={c.id}>
                <Link to={`/admin/clients/${c.id}`} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0 hover:bg-hover">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-line bg-canvas text-xs font-semibold">{c.company.slice(0, 2).toUpperCase()}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2"><span className="truncate text-13 font-medium">{c.company}</span>{c.status === 'suspended' && <Badge tone="danger">Suspended</Badge>}</span>
                    <span className="block truncate text-xs text-muted">{c.name} · {c.email}</span>
                  </span>
                  <span className="hidden text-xs text-muted sm:block">{c.project_count} project{c.project_count === 1 ? '' : 's'}</span>
                  <span className="hidden w-32 text-right text-xs text-muted md:block">{c.last_seen_at ? `Seen ${fmtRelative(c.last_seen_at)}` : 'Never signed in'}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ClientFormModal open={create} onClose={() => setCreate(false)} />
    </div>
  );
}

interface ClientDetail {
  client: Client;
  users: { id: string; email: string; name: string; title: string | null; role: Role; status: 'invited' | 'active' | 'suspended'; last_login_at: string | null; created_at: string }[];
  projects: { id: string; name: string; type: string; status: ProjectStatus; health: ProjectHealth; start_date: string | null; due_date: string | null; manager_name: string | null; progress: number }[];
  activity: { id: string; summary: string; actor_name: string | null; project_name: string | null; created_at: string }[];
}

export function ClientDetailPage() {
  const { id } = useParams();
  const me = useMe().data!.user!;
  const manage = can(me.role, 'clients.manage');
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['admin', 'client', id], queryFn: () => api.get<ClientDetail>(`/admin/clients/${id}`) });
  const [edit, setEdit] = useState(false);
  const [invite, setInvite] = useState(false);
  const patchUser = useAction(({ uid, body }: { uid: string; body: Record<string, string> }) => api.patch(`/admin/users/${uid}`, body), { success: 'Access updated' });
  const resend = useAction((uid: string) => api.post(`/admin/users/${uid}/resend-invite`), { success: 'Invitation re-sent' });
  const setStatus = useAction((status: string) => api.patch(`/admin/clients/${id}`, { status }), { success: 'Client access updated' });

  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.error) return <ErrorState error={q.error} />;
  const { client, users, projects, activity } = q.data!;
  return (
    <div>
      <Link to="/admin/clients" className="mb-4 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-ink"><ArrowLeft className="size-3.5" /> All clients</Link>
      <PageHeader
        title={<span className="flex items-center gap-2">{client.company}{client.status === 'suspended' && <Badge tone="danger">Suspended</Badge>}</span>}
        description={`Client since ${fmtDate(client.created_at)}`}
        actions={
          <>
            {can(me.role, 'projects.create') && <Link to={`/admin/projects/new?client=${client.id}`}><Button size="sm" icon={<Plus className="size-3.5" />}>New project</Button></Link>}
            {manage && <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => setEdit(true)}>Edit</Button>}
            {manage && (client.status === 'active' ? (
              <Button size="sm" variant="danger" icon={<ShieldOff className="size-3.5" />} onClick={async () => (await confirm({ title: `Suspend ${client.company}?`, description: 'All of their users are signed out immediately and can no longer access the portal. Their data is preserved.', danger: true, confirmLabel: 'Suspend access' })) && setStatus.mutate('suspended')}>Suspend</Button>
            ) : (
              <Button size="sm" icon={<ShieldCheck className="size-3.5" />} onClick={() => setStatus.mutate('active')}>Reactivate</Button>
            ))}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-6">
          <Panel title="People" actions={manage && <Button size="sm" icon={<MailPlus className="size-3.5" />} onClick={() => setInvite(true)}>Invite person</Button>} bodyClassName="p-0">
            <ul>
              {users.map((u) => (
                <li key={u.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0">
                  <Avatar name={u.name} role={u.role} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-13 font-medium">{u.name}</span>
                    <span className="block truncate text-xs text-muted">{u.email} · {ROLE_LABEL[u.role]}</span>
                  </span>
                  <span className="hidden text-xs text-muted md:block">{u.last_login_at ? `Seen ${fmtRelative(u.last_login_at)}` : '—'}</span>
                  <Badge tone={u.status === 'active' ? 'success' : u.status === 'invited' ? 'warning' : 'danger'}>{u.status === 'invited' ? 'Invitation pending' : u.status[0].toUpperCase() + u.status.slice(1)}</Badge>
                  {manage && (
                    <Menu trigger={({ toggle }) => <IconButton label="User actions" onClick={toggle}><MoreHorizontal className="size-4" /></IconButton>}>
                      {(close) => (
                        <>
                          {u.status === 'invited' && <MenuItem icon={<Send />} onClick={() => (close(), resend.mutate(u.id))}>Resend invitation</MenuItem>}
                          <MenuItem onClick={() => (close(), patchUser.mutate({ uid: u.id, body: { role: u.role === 'client' ? 'client_collaborator' : 'client' } }))}>
                            Make {u.role === 'client' ? 'Collaborator (no approvals)' : 'Client (can approve)'}
                          </MenuItem>
                          {u.status === 'active' && <MenuItem danger icon={<ShieldOff />} onClick={async () => (close(), (await confirm({ title: `Suspend ${u.name}?`, description: 'They are signed out immediately.', danger: true, confirmLabel: 'Suspend' })) && patchUser.mutate({ uid: u.id, body: { status: 'suspended' } }))}>Suspend access</MenuItem>}
                          {u.status === 'suspended' && <MenuItem icon={<ShieldCheck />} onClick={() => (close(), patchUser.mutate({ uid: u.id, body: { status: 'active' } }))}>Reactivate</MenuItem>}
                        </>
                      )}
                    </Menu>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Projects" bodyClassName="p-0">
            {projects.length ? (
              <ul>
                {projects.map((p) => (
                  <li key={p.id}>
                    <Link to={`/admin/p/${p.id}/overview`} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0 hover:bg-hover">
                      <span className="min-w-0 flex-1"><span className="block truncate text-13 font-medium">{p.name}</span><span className="block text-xs text-muted">{p.type} · {fmtDate(p.start_date)} → {fmtDate(p.due_date)}</span></span>
                      <span className="hidden w-32 items-center gap-2 sm:flex"><ProgressBar value={p.progress} size="xs" /><span className="text-xs tabular">{p.progress}%</span></span>
                      <HealthBadge health={p.health} />
                      <ProjectStatusBadge status={p.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <EmptyState compact title="No projects yet" action={can(me.role, 'projects.create') && <Link to={`/admin/projects/new?client=${client.id}`}><Button size="sm" variant="primary">Create a project</Button></Link>} />}
          </Panel>
        </div>
        <div className="flex flex-col gap-6">
          <Panel title="Details">
            <KeyValue items={[
              { label: 'Contact', value: client.name },
              { label: 'Email', value: <a href={`mailto:${client.email}`} className="text-brand hover:underline">{client.email}</a> },
              { label: 'Phone', value: client.phone ?? '—' },
              { label: 'Website', value: client.website ? <a href={client.website} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">{client.website.replace(/^https?:\/\//, '')}</a> : '—' },
            ]} />
            {client.notes && <p className="prose-comment mt-4 border-t border-line pt-3 text-13 text-ink-2">{client.notes}</p>}
          </Panel>
          <Panel title="Client activity">
            {activity.length ? (
              <ul className="flex flex-col gap-3">
                {activity.map((a) => (
                  <li key={a.id} className="text-13">
                    <p>{a.summary}</p>
                    <p className="text-xs text-muted">{[a.actor_name, a.project_name, fmtRelative(a.created_at)].filter(Boolean).join(' · ')}</p>
                  </li>
                ))}
              </ul>
            ) : <p className="text-13 text-muted">No activity yet.</p>}
          </Panel>
        </div>
      </div>
      <ClientFormModal open={edit} onClose={() => setEdit(false)} client={client} />
      <InviteUserModal open={invite} onClose={() => setInvite(false)} clientId={client.id} />
    </div>
  );
}
