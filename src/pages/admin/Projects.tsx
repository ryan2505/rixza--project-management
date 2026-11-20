import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Briefcase, Check, LayoutTemplate, Plus, Search } from 'lucide-react';
import { api } from '../../lib/api';
import { useAction, useMe, useProjects, useStaffOptions } from '../../lib/queries';
import { fmtDate } from '../../lib/format';
import { HealthBadge, ProjectStatusBadge } from '../../components/status';
import { Avatar, Button, EmptyState, ErrorState, Field, Input, PageHeader, Panel, ProgressBar, Segmented, Select, Skeleton, Textarea, cx } from '../../components/ui';
import { ROLE_LABEL, can, type Client, type ProjectTemplate } from '../../../shared/domain';

export function ProjectsPage() {
  const me = useMe().data!.user!;
  const q = useProjects();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'active' | 'all' | 'completed'>('active');
  const list = (q.data ?? []).filter(
    (p) => `${p.name} ${p.client_company} ${p.type}`.toLowerCase().includes(search.toLowerCase()) && (filter === 'all' || (filter === 'completed' ? p.status === 'completed' : p.status !== 'completed')),
  );
  return (
    <div>
      <PageHeader title="Projects" description="Every client workspace you have access to." actions={can(me.role, 'projects.create') && <Link to="/admin/projects/new"><Button variant="primary" size="sm" icon={<Plus className="size-3.5" />}>New project</Button></Link>} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search projects" className="pl-8" />
        </div>
        <Segmented value={filter} onChange={setFilter} options={[{ value: 'active', label: 'Active' }, { value: 'completed', label: 'Completed' }, { value: 'all', label: 'All' }]} />
      </div>
      {q.isLoading ? <Skeleton className="h-64" /> : q.error ? <ErrorState error={q.error} /> : list.length === 0 ? (
        <Panel><EmptyState icon={<Briefcase />} title="No projects" description={search ? 'Try another search.' : undefined} /></Panel>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => (
            <Link key={p.id} to={`/admin/p/${p.id}/overview`} className="group flex flex-col rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line-strong">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xs text-muted">{p.client_company}</div>
                  <div className="truncate text-sm font-semibold group-hover:text-brand">{p.name}</div>
                </div>
                {p.health && <HealthBadge health={p.health} />}
              </div>
              <div className="mt-4 flex items-center gap-2"><ProgressBar value={p.progress} size="xs" /><span className="text-xs font-medium tabular">{p.progress}%</span></div>
              <div className="mt-4 flex items-center justify-between text-xs text-muted">
                <span className="flex items-center gap-1.5">{p.manager_name && <Avatar name={p.manager_name} size={18} />}{p.type}</span>
                <span>Due {fmtDate(p.due_date)}</span>
              </div>
              <div className="mt-3"><ProjectStatusBadge status={p.status} /></div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function NewProjectPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const clients = useQuery({ queryKey: ['admin', 'clients'], queryFn: () => api.get<Client[]>('/admin/clients') });
  const templates = useQuery({ queryKey: ['admin', 'templates'], queryFn: () => api.get<ProjectTemplate[]>('/admin/templates') });
  const staff = useStaffOptions();
  const me = useMe().data!.user!;
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ client_id: params.get('client') ?? '', name: '', type: '', description: '', manager_id: me.role === 'project_manager' ? me.id : '', start_date: today, due_date: '', template_id: '' });
  const [members, setMembers] = useState<string[]>([]);
  const tpl = useMemo(() => templates.data?.find((t) => t.id === f.template_id), [templates.data, f.template_id]);
  useEffect(() => {
    if (tpl && !f.type) setF((x) => ({ ...x, type: tpl.project_type }));
  }, [tpl]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = useAction(
    () => api.post<{ id: string }>('/projects', { ...f, description: f.description || null, manager_id: f.manager_id || null, due_date: f.due_date || null, template_id: f.template_id || null, member_ids: members }),
    { success: 'Project created — the client has been notified.', refreshMe: true, onSuccess: (r) => navigate(`/admin/p/${r.id}/project`) },
  );
  const valid = f.client_id && f.name.trim() && f.type.trim() && f.start_date && (!f.due_date || f.due_date >= f.start_date);

  return (
    <div className="mx-auto max-w-4xl">
      <Link to="/admin/projects" className="mb-4 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-ink"><ArrowLeft className="size-3.5" /> Projects</Link>
      <PageHeader title="New project" description="Create a dedicated workspace for a client. Start from a template to get phases, tasks and milestones laid out automatically." />
      <div className="flex flex-col gap-6">
        <Panel title="1 · Template">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[{ id: '', name: 'Blank project', description: 'Start empty and define phases yourself.', project_type: '' } as any, ...(templates.data ?? [])].map((t: ProjectTemplate) => {
              const on = f.template_id === t.id;
              return (
                <button key={t.id || 'blank'} type="button" onClick={() => setF({ ...f, template_id: t.id, type: t.project_type || f.type })}
                  className={cx('relative rounded-lg border p-3 text-left transition-colors', on ? 'border-brand bg-brand-50/50 ring-1 ring-brand' : 'border-line hover:border-line-strong')}>
                  {on && <span className="absolute top-3 right-3 flex size-4 items-center justify-center rounded-full bg-brand text-white"><Check className="size-2.5" strokeWidth={3} /></span>}
                  <span className="flex items-center gap-2 text-13 font-medium"><LayoutTemplate className="size-3.5 text-muted" />{t.name}</span>
                  <span className="mt-1 block text-xs text-muted">{t.description}</span>
                  {t.definition && <span className="mt-2 block text-2xs text-subtle">{t.definition.phases.length} phases · {t.definition.phases.reduce((s, p) => s + p.tasks.length, 0)} tasks</span>}
                </button>
              );
            })}
          </div>
        </Panel>
        <Panel title="2 · Project">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client">
              <Select value={f.client_id} onChange={(e) => setF({ ...f, client_id: e.target.value })}>
                <option value="">Select a client…</option>
                {clients.data?.filter((c) => c.status === 'active').map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}
              </Select>
            </Field>
            <Field label="Project name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Corporate Website Redesign" /></Field>
            <Field label="Project type"><Input value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} placeholder="e.g. Website" /></Field>
            <Field label="Project manager">
              <Select value={f.manager_id} onChange={(e) => setF({ ...f, manager_id: e.target.value })}>
                <option value="">Select…</option>
                {staff.data?.filter((u) => u.role !== 'team_member').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </Field>
            <Field label="Start date"><Input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field>
            <Field label="Expected completion" optional hint={tpl ? 'Template phases are scaled to fit this window.' : undefined} error={f.due_date && f.due_date < f.start_date ? 'Must be after the start date' : null}>
              <Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
            </Field>
            <Field label="Description" optional className="sm:col-span-2" hint="Shown to the client on their overview."><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={3} /></Field>
          </div>
        </Panel>
        <Panel title="3 · Team">
          <div className="grid gap-1 sm:grid-cols-2">
            {staff.data?.map((u) => (
              <label key={u.id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 hover:bg-hover">
                <input type="checkbox" className="accent-[#0000FF]" checked={members.includes(u.id) || u.id === f.manager_id} disabled={u.id === f.manager_id} onChange={(e) => setMembers(e.target.checked ? [...members, u.id] : members.filter((m) => m !== u.id))} />
                <Avatar name={u.name} size={24} />
                <span className="min-w-0"><span className="block truncate text-13">{u.name}</span><span className="block truncate text-xs text-muted">{u.title ?? ROLE_LABEL[u.role]}</span></span>
              </label>
            ))}
          </div>
        </Panel>
        <div className="flex justify-end gap-2">
          <Link to="/admin/projects"><Button>Cancel</Button></Link>
          <Button variant="primary" size="lg" disabled={!valid} loading={create.isPending} onClick={() => create.mutate()}>Create project</Button>
        </div>
      </div>
    </div>
  );
}
