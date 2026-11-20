import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Briefcase, CalendarClock, Hourglass, PackageCheck, Plus, TimerOff } from 'lucide-react';
import { api } from '../../lib/api';
import { useMe } from '../../lib/queries';
import { dueInfo, firstName, fmtDate, fmtRelative, greeting } from '../../lib/format';
import { HealthBadge, ProjectStatusBadge, TaskStatusBadge } from '../../components/status';
import { Badge, Button, EmptyState, ErrorState, PageHeader, Panel, ProgressBar, Skeleton, Stat } from '../../components/ui';
import { can, type ProjectHealth, type ProjectStatus, type TaskStatus } from '../../../shared/domain';

interface Overview {
  metrics: { activeProjects: number; awaitingFeedback: number; atRisk: number; upcomingDeadlines: number; overdueTasks: number; pendingApprovals: number };
  projects: { id: string; name: string; type: string; status: ProjectStatus; health: ProjectHealth; due_date: string | null; client_company: string; manager_name: string | null; progress: number; awaiting: number; overdue: number }[];
  deadlines: { kind: string; id: string; title: string; date: string; project_id: string; project_name: string }[];
  overdueTasks: { id: string; title: string; due_date: string; project_id: string; project_name: string; assignee_name: string | null }[];
  pendingApprovals: { id: string; title: string; review_due: string | null; current_version: number; project_id: string; project_name: string }[];
  clientActivity: { id: string; summary: string; actor_name: string; project_name: string; project_id: string; created_at: string }[];
  myTasks: { id: string; title: string; status: TaskStatus; due_date: string | null; project_id: string; project_name: string }[];
}

const linkFor = (d: Overview['deadlines'][number]) =>
  `/admin/p/${d.project_id}/${d.kind === 'task' ? `board?task=${d.id}` : d.kind === 'deliverable' ? `deliverables/${d.id}` : `calendar?date=${d.date}`}`;

export function AdminOverviewPage() {
  const me = useMe().data!.user!;
  const q = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => api.get<Overview>('/admin/overview') });
  if (q.isLoading) return <div><Skeleton className="mb-6 h-8 w-72" /><div className="grid grid-cols-2 gap-4 lg:grid-cols-6">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-24" />)}</div></div>;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const o = q.data!;
  return (
    <div>
      <PageHeader
        title={`${greeting()}, ${firstName(me.name)}.`}
        description="The operational picture across every client project."
        actions={can(me.role, 'projects.create') && <Link to="/admin/projects/new"><Button variant="primary" size="sm" icon={<Plus className="size-3.5" />}>New project</Button></Link>}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Active projects" value={o.metrics.activeProjects} icon={<Briefcase />} />
        <Stat label="Awaiting client" value={o.metrics.awaitingFeedback} icon={<Hourglass />} />
        <Stat label="At risk" value={o.metrics.atRisk} icon={<AlertTriangle />} emphasis={o.metrics.atRisk > 0} />
        <Stat label="Deadlines · 14 days" value={o.metrics.upcomingDeadlines} icon={<CalendarClock />} />
        <Stat label="Overdue tasks" value={o.metrics.overdueTasks} icon={<TimerOff />} emphasis={o.metrics.overdueTasks > 0} />
        <Stat label="Pending approvals" value={o.metrics.pendingApprovals} icon={<PackageCheck />} />
      </div>

      <Panel title="Projects" className="mt-6" bodyClassName="p-0" actions={<Link to="/admin/projects" className="text-xs font-medium text-muted hover:text-ink">View all</Link>}>
        {o.projects.length === 0 ? (
          <EmptyState compact title="No projects yet" action={can(me.role, 'projects.create') && <Link to="/admin/projects/new"><Button size="sm" variant="primary">Create the first project</Button></Link>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-13">
              <thead>
                <tr className="border-b border-line text-left text-2xs font-medium uppercase tracking-wide text-muted">
                  <th className="px-4 py-2 font-medium">Project</th><th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2 font-medium">Health</th><th className="w-48 px-4 py-2 font-medium">Progress</th><th className="px-4 py-2 font-medium">Due</th><th className="px-4 py-2 font-medium">Signals</th>
                </tr>
              </thead>
              <tbody>
                {o.projects.slice(0, 8).map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0 hover:bg-canvas">
                    <td className="px-4 py-3">
                      <Link to={`/admin/p/${p.id}/overview`} className="font-medium hover:underline">{p.name}</Link>
                      <div className="text-xs text-muted">{p.client_company}{p.manager_name ? ` · ${p.manager_name}` : ''}</div>
                    </td>
                    <td className="px-4 py-3"><ProjectStatusBadge status={p.status} /></td>
                    <td className="px-4 py-3"><HealthBadge health={p.health} /></td>
                    <td className="px-4 py-3"><div className="flex items-center gap-2"><ProgressBar value={p.progress} size="xs" /><span className="w-9 text-right text-xs tabular">{p.progress}%</span></div></td>
                    <td className="px-4 py-3 text-xs text-muted">{fmtDate(p.due_date)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {p.awaiting > 0 && <Badge tone="warning">{p.awaiting} awaiting client</Badge>}
                        {p.overdue > 0 && <Badge tone="danger">{p.overdue} overdue</Badge>}
                        {!p.awaiting && !p.overdue && <span className="text-xs text-subtle">—</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Pending client approvals" bodyClassName="p-0">
          {o.pendingApprovals.length ? (
            <ul>{o.pendingApprovals.map((d) => (
              <li key={d.id}><Link to={`/admin/p/${d.project_id}/deliverables/${d.id}`} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0 hover:bg-hover">
                <span className="min-w-0 flex-1"><span className="block truncate text-13 font-medium">{d.title} <span className="font-normal text-muted">v{d.current_version}</span></span><span className="block truncate text-xs text-muted">{d.project_name}</span></span>
                {d.review_due && (() => { const di = dueInfo(d.review_due); return <Badge tone={di?.tone === 'neutral' ? 'neutral' : di!.tone}>{di!.label}</Badge>; })()}
              </Link></li>
            ))}</ul>
          ) : <EmptyState compact title="Nothing waiting on clients" />}
        </Panel>
        <Panel title="Upcoming deadlines" description="Next 14 days" bodyClassName="p-0">
          {o.deadlines.length ? (
            <ul>{o.deadlines.map((d) => (
              <li key={d.kind + d.id}><Link to={linkFor(d)} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0 hover:bg-hover">
                <span className="w-14 shrink-0 text-xs font-medium tabular text-ink-2">{fmtDate(d.date, false)}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-13">{d.title}</span><span className="block truncate text-xs text-muted">{d.project_name}</span></span>
                <Badge tone="neutral">{d.kind}</Badge>
              </Link></li>
            ))}</ul>
          ) : <EmptyState compact title="No deadlines in the next two weeks" />}
        </Panel>
        <Panel title="Overdue tasks" bodyClassName="p-0">
          {o.overdueTasks.length ? (
            <ul>{o.overdueTasks.map((t) => (
              <li key={t.id}><Link to={`/admin/p/${t.project_id}/board?task=${t.id}`} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0 hover:bg-hover">
                <span className="min-w-0 flex-1"><span className="block truncate text-13">{t.title}</span><span className="block truncate text-xs text-muted">{t.project_name}{t.assignee_name ? ` · ${t.assignee_name}` : ''}</span></span>
                <Badge tone="danger">{dueInfo(t.due_date)?.label}</Badge>
              </Link></li>
            ))}</ul>
          ) : <EmptyState compact title="No overdue tasks" description="Everything is on schedule." />}
        </Panel>
        <Panel title="Recent client activity" bodyClassName="p-0">
          {o.clientActivity.length ? (
            <ul>{o.clientActivity.map((a) => (
              <li key={a.id}><Link to={`/admin/p/${a.project_id}/overview`} className="block border-b border-line px-4 py-3 last:border-0 hover:bg-hover">
                <span className="block text-13">{a.summary}</span>
                <span className="block text-xs text-muted">{a.project_name} · {fmtRelative(a.created_at)}</span>
              </Link></li>
            ))}</ul>
          ) : <EmptyState compact title="No recent client activity" />}
        </Panel>
      </div>

      <Panel title="Assigned to me" className="mt-6" bodyClassName="p-0">
        {o.myTasks.length ? (
          <ul>{o.myTasks.map((t) => (
            <li key={t.id}><Link to={`/admin/p/${t.project_id}/board?task=${t.id}`} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0 hover:bg-hover">
              <span className="min-w-0 flex-1"><span className="block truncate text-13">{t.title}</span><span className="block truncate text-xs text-muted">{t.project_name}</span></span>
              {t.due_date && <span className="hidden text-xs text-muted sm:block">{fmtDate(t.due_date, false)}</span>}
              <TaskStatusBadge status={t.status} />
            </Link></li>
          ))}</ul>
        ) : <EmptyState compact title="No open tasks assigned to you" />}
      </Panel>
    </div>
  );
}
