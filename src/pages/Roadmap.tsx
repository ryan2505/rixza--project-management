import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Check, ChevronDown, Flag, MoreHorizontal, PackageCheck, Pencil, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { api } from '../lib/api';
import { useAction, useActivity, useRoadmap, useStaffOptions, type Roadmap } from '../lib/queries';
import { useWorkspace } from '../lib/workspace';
import { dueInfo, fmtDate, fmtDateShort } from '../lib/format';
import { ActivityTimeline } from '../components/Activity';
import { DeliverableStatusBadge, PhaseStatusBadge, TaskStatusBadge, VisibilityBadge } from '../components/status';
import { Badge, Button, EmptyState, ErrorState, Field, IconButton, Input, Menu, MenuItem, Modal, PageHeader, Panel, ProgressBar, Segmented, Select, Skeleton, Textarea, cx, useConfirm } from '../components/ui';
import type { Milestone, Phase, PhaseStatus, Visibility } from '../../shared/domain';

function PhaseMarker({ status }: { status: Phase['display_status'] }) {
  if (status === 'completed')
    return <span className="flex size-6 items-center justify-center rounded-full bg-ink text-white"><Check className="size-3.5" strokeWidth={3} /></span>;
  if (status === 'in_progress')
    return <span className="flex size-6 items-center justify-center rounded-full border-2 border-brand bg-surface"><span className="size-2 rounded-full bg-brand" /></span>;
  if (status === 'delayed')
    return <span className="flex size-6 items-center justify-center rounded-full border-2 border-danger bg-surface"><span className="size-2 rounded-full bg-danger" /></span>;
  return <span className="flex size-6 items-center justify-center rounded-full border-2 border-line-strong bg-surface" />;
}

function PhaseModal({ open, onClose, phase }: { open: boolean; onClose: () => void; phase?: Phase }) {
  const { pid } = useWorkspace();
  const staff = useStaffOptions(open);
  const [f, setF] = useState({ name: '', description: '', start_date: '', end_date: '', owner_id: '', status: 'upcoming' as PhaseStatus });
  useEffect(() => {
    if (open) setF({ name: phase?.name ?? '', description: phase?.description ?? '', start_date: phase?.start_date ?? '', end_date: phase?.end_date ?? '', owner_id: phase?.owner_id ?? '', status: phase?.status ?? 'upcoming' });
  }, [open, phase]);
  const save = useAction(
    () => {
      const body = { name: f.name, description: f.description || null, start_date: f.start_date || null, end_date: f.end_date || null, owner_id: f.owner_id || null, status: f.status };
      return phase ? api.patch(`/projects/phases/${phase.id}`, body) : api.post(`/projects/${pid}/phases`, body);
    },
    { success: phase ? 'Phase updated' : 'Phase added', onSuccess: onClose },
  );
  return (
    <Modal open={open} onClose={onClose} title={phase ? 'Edit phase' : 'Add phase'} description="Changes to dates notify the client automatically."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate()}>Save phase</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label="Description" optional><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={2} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date"><Input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field>
          <Field label="Expected end date"><Input type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Responsible">
            <Select value={f.owner_id} onChange={(e) => setF({ ...f, owner_id: e.target.value })}>
              <option value="">Unassigned</option>
              {staff.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </Field>
          <Field label="Status" hint="Also updates automatically from tasks.">
            <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as PhaseStatus })}>
              <option value="upcoming">Upcoming</option>
              <option value="in_progress">In progress</option>
              <option value="completed">Completed</option>
            </Select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function MilestoneModal({ open, onClose, milestone, phases, defaultPhase }: { open: boolean; onClose: () => void; milestone?: Milestone; phases: Phase[]; defaultPhase?: string }) {
  const { pid } = useWorkspace();
  const [f, setF] = useState({ title: '', description: '', due_date: '', phase_id: '', visibility: 'client' as Visibility });
  useEffect(() => {
    if (open) setF({ title: milestone?.title ?? '', description: milestone?.description ?? '', due_date: milestone?.due_date ?? '', phase_id: milestone?.phase_id ?? defaultPhase ?? '', visibility: milestone?.visibility ?? 'client' });
  }, [open, milestone, defaultPhase]);
  const save = useAction(
    () => {
      const body = { ...f, description: f.description || null, phase_id: f.phase_id || null };
      return milestone ? api.patch(`/projects/milestones/${milestone.id}`, body) : api.post(`/projects/${pid}/milestones`, body);
    },
    { success: milestone ? 'Milestone updated' : 'Milestone created', onSuccess: onClose },
  );
  return (
    <Modal open={open} onClose={onClose} title={milestone ? 'Edit milestone' : 'New milestone'}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.title.trim() || !f.due_date} onClick={() => save.mutate()}>Save milestone</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus /></Field>
        <Field label="Description" optional><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={2} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
          <Field label="Phase">
            <Select value={f.phase_id} onChange={(e) => setF({ ...f, phase_id: e.target.value })}>
              <option value="">No phase</option>
              {phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Visibility" hint={f.visibility === 'client' ? 'The client sees this milestone and is notified of date changes.' : 'Only the RIXZA team sees this milestone.'}>
          <Segmented value={f.visibility} onChange={(v) => setF({ ...f, visibility: v })} options={[{ value: 'internal', label: 'Internal only' }, { value: 'client', label: 'Client visible' }]} />
        </Field>
      </div>
    </Modal>
  );
}

function PhaseCard({ phase, data, index, isLast, expanded, onToggle, onEdit, onAddMilestone, onEditMilestone, onMove }: {
  phase: Phase; data: Roadmap; index: number; isLast: boolean; expanded: boolean; onToggle: () => void; onEdit: () => void; onAddMilestone: () => void; onEditMilestone: (m: Milestone) => void; onMove: (dir: -1 | 1) => void;
}) {
  const { base, caps } = useWorkspace();
  const confirm = useConfirm();
  const tasks = data.tasks.filter((t) => t.phase_id === phase.id);
  const milestones = data.milestones.filter((m) => m.phase_id === phase.id);
  const deliverables = data.deliverables.filter((d) => d.phase_id === phase.id);
  const del = useAction(() => api.del(`/projects/phases/${phase.id}`), { success: 'Phase removed' });
  const toggleMilestone = useAction((m: Milestone) => api.patch(`/projects/milestones/${m.id}`, { status: m.status === 'completed' ? 'pending' : 'completed' }), { success: 'Milestone updated' });
  const current = phase.display_status === 'in_progress';
  return (
    <li id={phase.id} className="relative flex scroll-mt-24 gap-4">
      <div className="flex flex-col items-center">
        <PhaseMarker status={phase.display_status} />
        {!isLast && <span className={cx('w-px flex-1', phase.status === 'completed' ? 'bg-ink' : 'bg-line')} />}
      </div>
      <div className={cx('mb-4 min-w-0 flex-1 rounded-lg border bg-surface transition-colors', current ? 'border-brand/40 shadow-[0_0_0_3px_rgb(0_0_255/0.05)]' : 'border-line')}>
        <div className="flex items-start gap-3 p-4">
          <button onClick={onToggle} className="min-w-0 flex-1 text-left" aria-expanded={expanded}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-2xs font-medium text-subtle tabular">{String(index + 1).padStart(2, '0')}</span>
              <h3 className="text-sm font-semibold">{phase.name}</h3>
              <PhaseStatusBadge status={phase.display_status} />
            </div>
            {phase.description && <p className="mt-1 text-13 text-muted">{phase.description}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
              <span>{phase.start_date ? `${fmtDateShort(phase.start_date)} → ${fmtDate(phase.end_date)}` : 'Dates to be confirmed'}</span>
              {phase.owner_name && <span>Responsible: <span className="text-ink-2">{phase.owner_name}</span></span>}
              <span>{phase.task_done}/{phase.task_total} tasks</span>
              {milestones.length > 0 && <span>{milestones.length} milestone{milestones.length > 1 ? 's' : ''}</span>}
              {deliverables.length > 0 && <span>{deliverables.length} deliverable{deliverables.length > 1 ? 's' : ''}</span>}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <ProgressBar value={phase.progress} size="xs" tone={phase.status === 'completed' ? 'ink' : 'brand'} className="max-w-xs" />
              <span className="text-xs font-medium tabular text-ink-2">{phase.progress}%</span>
            </div>
          </button>
          <div className="flex items-center gap-1">
            {caps.manage && (
              <Menu trigger={({ toggle }) => <IconButton label="Phase actions" onClick={toggle}><MoreHorizontal className="size-4" /></IconButton>}>
                {(close) => (
                  <>
                    <MenuItem icon={<Pencil />} onClick={() => (close(), onEdit())}>Edit phase</MenuItem>
                    <MenuItem icon={<Flag />} onClick={() => (close(), onAddMilestone())}>Add milestone</MenuItem>
                    <MenuItem icon={<ArrowUp />} onClick={() => (close(), onMove(-1))}>Move up</MenuItem>
                    <MenuItem icon={<ArrowDown />} onClick={() => (close(), onMove(1))}>Move down</MenuItem>
                    <MenuItem icon={<Trash2 />} danger onClick={async () => { close(); if (await confirm({ title: `Delete “${phase.name}”?`, description: 'Tasks and milestones in this phase are kept but no longer linked to a phase.', confirmLabel: 'Delete phase', danger: true })) del.mutate(); }}>Delete phase</MenuItem>
                  </>
                )}
              </Menu>
            )}
            <IconButton label={expanded ? 'Collapse' : 'Expand'} onClick={onToggle}>
              <ChevronDown className={cx('size-4 transition-transform', expanded && 'rotate-180')} />
            </IconButton>
          </div>
        </div>
        {expanded && (
          <div className="grid gap-px border-t border-line bg-line md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="bg-surface p-4">
              <div className="mb-2 text-2xs font-medium uppercase tracking-[0.06em] text-subtle">Tasks</div>
              {tasks.length ? (
                <ul className="flex flex-col">
                  {tasks.map((t) => (
                    <li key={t.id}>
                      <Link to={`${base}/board?task=${t.id}`} className="-mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hover">
                        <span className={cx('size-1.5 shrink-0 rounded-full', ['approved', 'completed'].includes(t.status) ? 'bg-ink' : t.status === 'backlog' || t.status === 'todo' ? 'bg-line-strong' : 'bg-brand')} />
                        <span className={cx('min-w-0 flex-1 truncate text-13', ['approved', 'completed'].includes(t.status) && 'text-muted line-through decoration-line-strong')}>{t.title}</span>
                        {caps.staff && t.visibility === 'internal' && <VisibilityBadge visibility="internal" compact />}
                        {!!t.client_action && <Badge tone="warning">Your action</Badge>}
                        <span className="hidden sm:inline"><TaskStatusBadge status={t.status} /></span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-13 text-muted">Tasks for this phase will appear here.</p>
              )}
            </div>
            <div className="flex flex-col gap-4 bg-surface p-4">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-2xs font-medium uppercase tracking-[0.06em] text-subtle">Milestones</span>
                  {caps.manage && <button className="text-xs font-medium text-brand hover:underline" onClick={onAddMilestone}>Add</button>}
                </div>
                {milestones.length ? (
                  <ul className="flex flex-col gap-1.5">
                    {milestones.map((m) => (
                      <li key={m.id} className="group flex items-center gap-2 text-13">
                        <button
                          disabled={!caps.manage}
                          onClick={() => toggleMilestone.mutate(m)}
                          title={caps.manage ? (m.status === 'completed' ? 'Mark as pending' : 'Mark as reached') : undefined}
                          className={cx('flex size-4 shrink-0 items-center justify-center rounded-full border', m.status === 'completed' ? 'border-ink bg-ink text-white' : 'border-line-strong', caps.manage && 'hover:border-brand')}
                        >
                          {m.status === 'completed' && <Check className="size-2.5" strokeWidth={3} />}
                        </button>
                        <span className={cx('min-w-0 flex-1 truncate', m.status === 'completed' && 'text-muted')}>{m.title}</span>
                        <span className="text-xs text-muted tabular">{fmtDateShort(m.due_date)}</span>
                        {caps.manage && <IconButton size="sm" label="Edit milestone" className="opacity-0 group-hover:opacity-100" onClick={() => onEditMilestone(m)}><Pencil className="size-3" /></IconButton>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-13 text-muted">No milestones in this phase.</p>
                )}
              </div>
              {deliverables.length > 0 && (
                <div>
                  <div className="mb-2 text-2xs font-medium uppercase tracking-[0.06em] text-subtle">Deliverables</div>
                  <ul className="flex flex-col gap-1">
                    {deliverables.map((d) => (
                      <li key={d.id}>
                        <Link to={`${base}/deliverables/${d.id}`} className="-mx-2 flex items-center gap-2 rounded-md px-2 py-1 text-13 hover:bg-hover">
                          <PackageCheck className="size-3.5 text-muted" />
                          <span className="min-w-0 flex-1 truncate">{d.title}</span>
                          <DeliverableStatusBadge status={d.status} clientView={!caps.staff} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

export function RoadmapPage() {
  const { pid, base, caps, project } = useWorkspace();
  const q = useRoadmap(pid);
  const activity = useActivity(pid);
  const loc = useLocation();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [phaseModal, setPhaseModal] = useState<{ open: boolean; phase?: Phase }>({ open: false });
  const [msModal, setMsModal] = useState<{ open: boolean; milestone?: Milestone; phase?: string }>({ open: false });
  const reorder = useAction((ids: string[]) => api.post(`/projects/${pid}/phases/reorder`, { ids }), { success: 'Roadmap reordered' });

  // Open the current phase (or the one linked via #hash) by default.
  useEffect(() => {
    if (!q.data) return;
    const hash = loc.hash.slice(1);
    const target = hash && q.data.phases.find((p) => p.id === hash) ? hash : q.data.phases.find((p) => p.status === 'in_progress')?.id;
    if (target) {
      setExpanded((s) => new Set(s).add(target));
      if (hash) setTimeout(() => document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    }
  }, [q.data?.phases.length, loc.hash]); // eslint-disable-line react-hooks/exhaustive-deps

  const unphased = q.data?.milestones.filter((m) => !m.phase_id) ?? [];
  const move = (i: number, dir: -1 | 1) => {
    const ids = q.data!.phases.map((p) => p.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder.mutate(ids);
  };

  return (
    <div>
      <PageHeader
        title={caps.staff ? 'Roadmap' : 'My Project'}
        description={`The complete structure of ${project.name} — phases, milestones and what each one delivers.`}
        actions={caps.manage && (
          <>
            <Button size="sm" icon={<Flag className="size-3.5" />} onClick={() => setMsModal({ open: true })}>Milestone</Button>
            <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setPhaseModal({ open: true })}>Add phase</Button>
          </>
        )}
      />
      <div className="mb-5 flex flex-wrap items-center gap-4 text-xs text-muted">
        {[
          ['Completed', <span key="c" className="size-2.5 rounded-full bg-ink" />],
          ['Current', <span key="i" className="size-2.5 rounded-full border-2 border-brand" />],
          ['Upcoming', <span key="u" className="size-2.5 rounded-full border-2 border-line-strong" />],
          ['Delayed', <span key="d" className="size-2.5 rounded-full border-2 border-danger" />],
        ].map(([label, dot]) => <span key={label as string} className="flex items-center gap-1.5">{dot}{label}</span>)}
      </div>

      {q.isLoading ? (
        <div className="flex flex-col gap-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data!.phases.length === 0 ? (
        <Panel>
          <EmptyState icon={<Flag />} title="The roadmap is being prepared" description="Your project manager will publish the phases of your project here shortly." action={caps.manage && <Button variant="primary" onClick={() => setPhaseModal({ open: true })}>Add the first phase</Button>} />
        </Panel>
      ) : (
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
          <ol>
            {q.data!.phases.map((p, i) => (
              <PhaseCard
                key={p.id}
                phase={p}
                data={q.data!}
                index={i}
                isLast={i === q.data!.phases.length - 1}
                expanded={expanded.has(p.id)}
                onToggle={() => setExpanded((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })}
                onEdit={() => setPhaseModal({ open: true, phase: p })}
                onAddMilestone={() => setMsModal({ open: true, phase: p.id })}
                onEditMilestone={(m) => setMsModal({ open: true, milestone: m })}
                onMove={(dir) => move(i, dir)}
              />
            ))}
          </ol>
          <div className="flex flex-col gap-6">
            <Panel title="Milestones" bodyClassName="p-2">
              {q.data!.milestones.length === 0 ? (
                <EmptyState compact title="No milestones yet" />
              ) : (
                <ul>
                  {q.data!.milestones.map((m) => {
                    const due = dueInfo(m.due_date);
                    return (
                      <li key={m.id}>
                        <button disabled={!caps.manage} onClick={() => setMsModal({ open: true, milestone: m })} className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left enabled:hover:bg-hover">
                          <Flag className={cx('size-3.5 shrink-0', m.status === 'completed' ? 'text-ink' : 'text-brand')} />
                          <span className="min-w-0 flex-1">
                            <span className={cx('block truncate text-13', m.status === 'completed' && 'text-muted line-through decoration-line-strong')}>{m.title}</span>
                            <span className="block text-xs text-muted">{fmtDate(m.due_date)}</span>
                          </span>
                          {m.status === 'completed' ? <Badge tone="dark">Reached</Badge> : due?.tone === 'danger' ? <Badge tone="danger">Overdue</Badge> : null}
                          {caps.staff && m.visibility === 'internal' && <VisibilityBadge visibility="internal" compact />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {unphased.length > 0 && <p className="px-2 pt-1 text-2xs text-subtle">{unphased.length} not linked to a phase</p>}
            </Panel>
            <Panel title="Project history" description="Every important change, in order." actions={<span className="text-xs text-muted">{activity.data?.length ?? 0} events</span>}>
              {activity.isLoading ? <Skeleton className="h-40" /> : activity.data?.length ? (
                <div className="max-h-[520px] overflow-y-auto pr-1 scrollbar-thin">
                  <ActivityTimeline items={activity.data} base={base} showVisibility={caps.staff} />
                </div>
              ) : <EmptyState compact title="No history yet" />}
            </Panel>
          </div>
        </div>
      )}
      <PhaseModal open={phaseModal.open} phase={phaseModal.phase} onClose={() => setPhaseModal({ open: false })} />
      <MilestoneModal open={msModal.open} milestone={msModal.milestone} defaultPhase={msModal.phase} phases={q.data?.phases ?? []} onClose={() => setMsModal({ open: false })} />
    </div>
  );
}
