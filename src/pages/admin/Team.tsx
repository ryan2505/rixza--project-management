import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MailPlus, MoreHorizontal, Send, ShieldCheck, ShieldOff } from 'lucide-react';
import { api } from '../../lib/api';
import { useAction, useMe } from '../../lib/queries';
import { fmtRelative } from '../../lib/format';
import { Avatar, Badge, Button, ErrorState, Field, IconButton, Input, Menu, MenuItem, Modal, PageHeader, Select, Skeleton, useConfirm } from '../../components/ui';
import { ROLE_LABEL, STAFF_ROLES, can, type Role } from '../../../shared/domain';

interface Member { id: string; email: string; name: string; title: string | null; role: Role; status: string; last_login_at: string | null; open_tasks: number }

const ROLE_HELP: Partial<Record<Role, string>> = {
  super_admin: 'Full access to the entire platform.',
  admin: 'Manages clients, projects, team and settings.',
  project_manager: 'Manages assigned projects, tasks, deliverables and client communication.',
  team_member: 'Works on assigned projects and tasks; communicates internally.',
};

export function TeamPage() {
  const me = useMe().data!.user!;
  const manage = can(me.role, 'team.manage');
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['admin', 'team'], queryFn: () => api.get<Member[]>('/admin/team') });
  const [invite, setInvite] = useState(false);
  const [f, setF] = useState({ name: '', email: '', title: '', role: 'team_member' as Role });
  useEffect(() => { if (invite) setF({ name: '', email: '', title: '', role: 'team_member' }); }, [invite]);
  const send = useAction(() => api.post('/admin/team', { ...f, title: f.title || null }), { success: 'Invitation sent', onSuccess: () => setInvite(false) });
  const patch = useAction(({ id, body }: { id: string; body: Record<string, string> }) => api.patch(`/admin/users/${id}`, body), { success: 'Team member updated' });
  const resend = useAction((id: string) => api.post(`/admin/users/${id}/resend-invite`), { success: 'Invitation re-sent' });
  const roles = STAFF_ROLES.filter((r) => r !== 'super_admin' || me.role === 'super_admin');

  return (
    <div>
      <PageHeader title="Team" description="RIXZA people and their roles. Permissions are enforced on the server for every request." actions={manage && <Button variant="primary" size="sm" icon={<MailPlus className="size-3.5" />} onClick={() => setInvite(true)}>Invite</Button>} />
      {q.isLoading ? <Skeleton className="h-64" /> : q.error ? <ErrorState error={q.error} /> : (
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <ul>
            {q.data!.map((u) => (
              <li key={u.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0">
                <Avatar name={u.name} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-13 font-medium">{u.name}{u.id === me.id && <span className="font-normal text-muted"> (you)</span>}</span>
                  <span className="block truncate text-xs text-muted">{u.title ? `${u.title} · ` : ''}{u.email}</span>
                </span>
                <span className="hidden text-xs text-muted md:block">{u.open_tasks} open task{u.open_tasks === 1 ? '' : 's'}</span>
                <span className="hidden w-28 text-right text-xs text-muted lg:block">{u.last_login_at ? fmtRelative(u.last_login_at) : '—'}</span>
                <Badge tone={u.role === 'super_admin' || u.role === 'admin' ? 'dark' : u.role === 'project_manager' ? 'brand' : 'neutral'}>{ROLE_LABEL[u.role]}</Badge>
                {u.status !== 'active' && <Badge tone={u.status === 'invited' ? 'warning' : 'danger'}>{u.status === 'invited' ? 'Invited' : 'Suspended'}</Badge>}
                {manage && u.id !== me.id && (u.role !== 'super_admin' || me.role === 'super_admin') ? (
                  <Menu trigger={({ toggle }) => <IconButton label="Member actions" onClick={toggle}><MoreHorizontal className="size-4" /></IconButton>}>
                    {(close) => (
                      <>
                        <div className="px-2 py-1 text-2xs font-medium uppercase tracking-wide text-subtle">Change role</div>
                        {roles.filter((r) => r !== u.role).map((r) => <MenuItem key={r} onClick={() => (close(), patch.mutate({ id: u.id, body: { role: r } }))}>{ROLE_LABEL[r]}</MenuItem>)}
                        <div className="my-1 border-t border-line" />
                        {u.status === 'invited' && <MenuItem icon={<Send />} onClick={() => (close(), resend.mutate(u.id))}>Resend invitation</MenuItem>}
                        {u.status === 'active' && <MenuItem danger icon={<ShieldOff />} onClick={async () => (close(), (await confirm({ title: `Suspend ${u.name}?`, description: 'They are signed out immediately and lose access.', danger: true, confirmLabel: 'Suspend' })) && patch.mutate({ id: u.id, body: { status: 'suspended' } }))}>Suspend</MenuItem>}
                        {u.status === 'suspended' && <MenuItem icon={<ShieldCheck />} onClick={() => (close(), patch.mutate({ id: u.id, body: { status: 'active' } }))}>Reactivate</MenuItem>}
                      </>
                    )}
                  </Menu>
                ) : <span className="w-8" />}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Modal open={invite} onClose={() => setInvite(false)} title="Invite a team member"
        footer={<><Button onClick={() => setInvite(false)}>Cancel</Button><Button variant="primary" icon={<Send className="size-3.5" />} loading={send.isPending} disabled={!f.name.trim() || !f.email.trim()} onClick={() => send.mutate()}>Send invitation</Button></>}>
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
            <Field label="Job title" optional><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          </div>
          <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Role" hint={ROLE_HELP[f.role]}>
            <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>{roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select>
          </Field>
        </div>
      </Modal>
    </div>
  );
}
