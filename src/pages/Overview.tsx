import { Link } from 'react-router-dom';
import { ArrowRight, BellRing, CalendarDays, CheckCircle2, Circle, CircleCheckBig, Flag, FolderUp, Loader, MessagesSquare, Route as RouteIcon, Sparkles, Hourglass } from 'lucide-react';
import { useOverview, useMe } from '../lib/queries';
import { useWorkspace } from '../lib/workspace';
import { dueInfo, firstName, fmtDate, greeting, plural } from '../lib/format';
import { ActivityTimeline } from '../components/Activity';
import { HealthBadge, PhaseStatusBadge, ProjectStatusBadge } from '../components/status';
import { Avatar, Badge, Button, EmptyState, ErrorState, Panel, ProgressBar, Skeleton, Stat, cx } from '../components/ui';
import { ROLE_LABEL, type Phase, type ProjectOverview } from '../../shared/domain';

function PhaseStrip({ phases, base }: { phases: Phase[]; base: string }) {
  if (!phases.length) return null;
  return (
    <div>
      <div className="flex gap-1">
        {phases.map((p) => (
          <Link
            key={p.id}
            to={`${base}/project#${p.id}`}
            title={`${p.name} — ${p.progress}%`}
            className="group relative h-1.5 flex-1 overflow-hidden rounded-full bg-line"
          >
            <span
              className={cx(
                'absolute inset-y-0 left-0 rounded-full',
                p.display_status === 'completed' ? 'bg-ink' : p.display_status === 'delayed' ? 'bg-danger' : 'bg-brand',
              )}
              style={{ width: `${p.progress}%` }}
            />
          </Link>
        ))}
      </div>
      <div className="mt-2 hidden justify-between text-2xs text-subtle sm:flex">
        <span>{phases[0].name}</span>
        <span>{phases[phases.length - 1].name}</span>
      </div>
    </div>
  );
}

function ProgressPanel({ o, base }: { o: ProjectOverview; base: string }) {
  const basis =
    o.progressBasis === 'tasks'
      ? `Calculated from ${o.taskTotal} project tasks across all phases.`
      : o.progressBasis === 'milestones'
        ? 'Calculated from completed milestones.'
        : 'Progress will appear as soon as work is planned.';
  return (
    <Panel bodyClassName="p-0">
      <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="border-b border-line p-5 lg:border-r lg:border-b-0 lg:p-6">
          <div className="text-xs font-medium text-muted">Overall completion</div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-[52px] leading-none font-semibold tracking-[-0.04em] tabular text-ink">{o.progress}</span>
            <span className="text-xl font-medium text-muted">%</span>
          </div>
          <ProgressBar value={o.progress} size="md" className="mt-5" />
          <p className="mt-3 text-xs text-muted">{basis}</p>
        </div>
        <div className="grid grid-cols-2 gap-px bg-line">
          {[
            {
              label: 'Current phase',
              icon: <Loader className="text-brand" />,
              value: o.currentPhase?.name ?? 'Not started',
              sub: o.currentPhase ? `${o.currentPhase.progress}% complete` : null,
              to: o.currentPhase ? `project#${o.currentPhase.id}` : 'project',
            },
            {
              label: 'Phases completed',
              icon: <CircleCheckBig />,
              value: `${o.phasesCompleted} of ${o.phases.length}`,
              sub: o.phases.length ? `${o.phases.length - o.phasesCompleted} remaining` : null,
              to: 'project',
            },
            {
              label: 'Upcoming milestone',
              icon: <Flag />,
              value: o.nextMilestone?.title ?? 'None scheduled',
              sub: o.nextMilestone ? fmtDate(o.nextMilestone.due_date) : null,
              to: o.nextMilestone ? `calendar?date=${o.nextMilestone.due_date}` : 'calendar',
            },
            {
              label: 'Expected next delivery',
              icon: <CalendarDays />,
              value: o.nextDelivery?.title ?? 'To be scheduled',
              sub: o.nextDelivery ? fmtDate(o.nextDelivery.date) : null,
              to: o.nextDelivery?.link ?? 'calendar',
            },
          ].map((c) => (
            <Link key={c.label} to={`${base}/${c.to}`} className="group bg-surface p-4 transition-colors hover:bg-canvas lg:p-5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted [&>svg]:size-3.5">
                {c.icon}
                {c.label}
              </div>
              <div className="mt-2 line-clamp-2 text-13 font-medium text-ink group-hover:text-brand">{c.value}</div>
              {c.sub && <div className="mt-0.5 text-xs text-muted">{c.sub}</div>}
            </Link>
          ))}
        </div>
      </div>
      {o.phases.length > 0 && (
        <div className="border-t border-line px-5 py-4 lg:px-6">
          <PhaseStrip phases={o.phases} base={base} />
        </div>
      )}
    </Panel>
  );
}

function GettingStarted({ base }: { base: string }) {
  const steps = [
    { icon: <Sparkles />, title: 'Your workspace is ready', text: 'Everything about your project lives here — progress, files, decisions and conversations.', done: true },
    { icon: <RouteIcon />, title: 'Explore your roadmap', text: 'See the phases your project will go through and the key milestones.', to: 'project', cta: 'View roadmap' },
    { icon: <FolderUp />, title: 'Share your materials', text: 'Upload your brief, brand assets and any documents that will help the team.', to: 'files', cta: 'Upload files' },
    { icon: <MessagesSquare />, title: 'Say hello to your team', text: 'Ask questions or share context directly with your RIXZA project team.', to: 'discussions', cta: 'Start a conversation' },
  ];
  return (
    <Panel title="Getting started" description="Your project has just begun. Here’s what happens next." className="mb-6">
      <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.title} className="flex flex-col rounded-md border border-line p-4">
            <div className="flex items-center justify-between">
              <span className={cx('flex size-7 items-center justify-center rounded-md [&>svg]:size-3.5', s.done ? 'bg-brand text-white' : 'bg-hover text-ink-2')}>{s.done ? <CheckCircle2 /> : s.icon}</span>
              <span className="text-2xs font-medium text-subtle tabular">0{i + 1}</span>
            </div>
            <p className="mt-3 text-13 font-medium">{s.title}</p>
            <p className="mt-1 flex-1 text-xs leading-5 text-muted">{s.text}</p>
            {s.to && (
              <Link to={`${base}/${s.to}`} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
                {s.cta} <ArrowRight className="size-3" />
              </Link>
            )}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

export function OverviewPage() {
  const { pid, base, detail, caps } = useWorkspace();
  const me = useMe().data!;
  const q = useOverview(pid);
  const p = detail.project;

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          {caps.staff ? (
            <>
              <div className="mb-1 text-xs font-medium text-muted">{detail.client.company}</div>
              <h1 className="flex flex-wrap items-center gap-2 text-[22px] leading-8 font-semibold">
                {p.name} {p.health && <HealthBadge health={p.health} />}
              </h1>
              <p className="mt-1 text-13 text-muted">Internal view — you can see everything, including internal items.</p>
            </>
          ) : (
            <>
              <h1 className="text-[22px] leading-8 font-semibold">{greeting()}, {firstName(me.user!.name)}.</h1>
              <p className="mt-1 text-13 text-muted">Here’s the current status of your project.</p>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link to={`${base}/board`}><Button size="sm">Open board</Button></Link>
          <Link to={`${base}/discussions`}><Button size="sm" variant="dark" icon={<MessagesSquare className="size-3.5" />}>Message the team</Button></Link>
        </div>
      </div>

      {/* Project identity */}
      <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 xl:grid-cols-6">
        {[
          { label: 'Project', value: <span className="font-medium">{p.name}</span> },
          { label: 'Type', value: p.type },
          {
            label: 'Project manager',
            value: detail.manager ? (
              <span className="flex items-center gap-1.5"><Avatar name={detail.manager.name} size={18} />{detail.manager.name}</span>
            ) : '—',
          },
          { label: 'Start date', value: fmtDate(p.start_date) },
          { label: 'Expected completion', value: fmtDate(p.due_date) },
          { label: 'Status', value: <ProjectStatusBadge status={p.status} /> },
        ].map((f) => (
          <div key={f.label} className="bg-surface px-4 py-3">
            <div className="text-2xs font-medium uppercase tracking-[0.06em] text-subtle">{f.label}</div>
            <div className="mt-1 truncate text-13 text-ink">{f.value}</div>
          </div>
        ))}
      </div>

      {q.isLoading ? (
        <div className="flex flex-col gap-6">
          <Skeleton className="h-64" />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
        </div>
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          {p.status === 'onboarding' && q.data!.progress < 10 && !caps.staff && <GettingStarted base={base} />}
          <ProgressPanel o={q.data!} base={base} />

          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
            <Stat label="Tasks completed" value={q.data!.stats.tasksCompleted} icon={<CheckCircle2 />} />
            <Stat label="Tasks in progress" value={q.data!.stats.tasksInProgress} icon={<Loader />} />
            <Stat label={caps.staff ? 'Waiting on client' : 'Pending actions'} value={q.data!.stats.pendingClientActions} icon={<BellRing />} emphasis={q.data!.stats.pendingClientActions > 0} hint={q.data!.stats.pendingClientActions > 0 && !caps.staff ? 'Your input is needed' : undefined} />
            <Stat label="Upcoming milestones" value={q.data!.stats.upcomingMilestones} icon={<Flag />} />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <div className="flex flex-col gap-6 lg:col-span-2">
              <Panel
                title={caps.staff ? 'Waiting on the client' : 'Your attention is needed'}
                description={q.data!.attention.length ? plural(q.data!.attention.length, 'item') + ' awaiting a response' : undefined}
                bodyClassName="p-0"
              >
                {q.data!.attention.length === 0 ? (
                  <EmptyState
                    compact
                    icon={<CheckCircle2 />}
                    title="You’re all caught up."
                    description={caps.staff ? 'Nothing is currently waiting on the client.' : 'There are no deliverables waiting for your review. We’ll let you know when something needs you.'}
                  />
                ) : (
                  <ul>
                    {q.data!.attention.map((a) => {
                      const due = dueInfo(a.due);
                      return (
                        <li key={a.kind + a.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0">
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand">
                            {a.kind === 'deliverable' ? <Hourglass className="size-3.5" /> : <Circle className="size-3.5" />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-13 font-medium">{a.title}</p>
                            <p className="truncate text-xs text-muted">{a.detail}</p>
                          </div>
                          {due && <Badge tone={due.tone === 'neutral' ? 'neutral' : due.tone} className="hidden sm:inline-flex">{due.label}</Badge>}
                          <Link to={`${base}/${a.link}`}>
                            <Button size="sm" variant={caps.staff ? 'secondary' : 'primary'}>{caps.staff ? 'Open' : a.cta}</Button>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Panel>

              <Panel title="Recent activity" actions={<Link to={`${base}/project`} className="text-xs font-medium text-muted hover:text-ink">View timeline</Link>}>
                {q.data!.activity.length ? (
                  <ActivityTimeline items={q.data!.activity} base={base} showVisibility={caps.staff} />
                ) : (
                  <EmptyState compact title="No activity yet" description="Updates from your team will appear here as work progresses." />
                )}
              </Panel>
            </div>

            <div className="flex flex-col gap-6">
              <Panel title="Next milestone">
                {q.data!.nextMilestone ? (
                  <div>
                    <div className="flex items-start gap-3">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-ink text-white"><Flag className="size-3.5" /></span>
                      <div className="min-w-0">
                        <p className="text-13 font-medium">{q.data!.nextMilestone.title}</p>
                        <p className="text-xs text-muted">{fmtDate(q.data!.nextMilestone.due_date)}</p>
                      </div>
                    </div>
                    {(() => {
                      const d = dueInfo(q.data!.nextMilestone!.due_date);
                      const ph = q.data!.phases.find((x) => x.id === q.data!.nextMilestone!.phase_id);
                      return (
                        <div className="mt-4 flex flex-col gap-2 border-t border-line pt-3 text-xs">
                          <div className="flex justify-between"><span className="text-muted">Status</span>{d && <Badge tone={d.tone === 'neutral' ? 'brand' : d.tone}>{d.label.replace('Due', 'Planned')}</Badge>}</div>
                          {ph && <div className="flex justify-between gap-3"><span className="text-muted">Phase</span><span className="flex items-center gap-1.5 truncate">{ph.name} <PhaseStatusBadge status={ph.display_status} /></span></div>}
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <EmptyState compact title="No upcoming milestones." description="Your project timeline will be updated as work progresses." />
                )}
              </Panel>

              <Panel title="Your RIXZA team" bodyClassName="p-2">
                {[detail.manager, ...detail.members.filter((m) => m.id !== detail.manager?.id)].filter(Boolean).map((m) => (
                  <div key={m!.id} className="flex items-center gap-2.5 rounded-md px-2 py-2">
                    <Avatar name={m!.name} size={28} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-13 font-medium">{m!.name}</p>
                      <p className="truncate text-xs text-muted">{m!.title ?? ROLE_LABEL[m!.role]}{m!.id === detail.manager?.id ? ' · Your project manager' : ''}</p>
                    </div>
                  </div>
                ))}
                <Link to={`${base}/discussions`} className="mt-1 flex items-center justify-center gap-1.5 rounded-md border-t border-line px-2 pt-2.5 pb-1 text-xs font-medium text-brand hover:underline">
                  Start a conversation <ArrowRight className="size-3" />
                </Link>
              </Panel>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
