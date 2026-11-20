import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { DndContext, DragOverlay, PointerSensor, TouchSensor, pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';

/** Drop where the pointer is (card before column), falling back to overlap for keyboard/touch edge cases. */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (hits.length) return hits.sort((a, b) => (String(a.id).startsWith('before:') ? -1 : 0) - (String(b.id).startsWith('before:') ? -1 : 0));
  return rectIntersection(args);
};
import { Columns3, HandHelping, List, Lock, MessageSquare, Paperclip, Plus, Search, SquareKanban, X } from 'lucide-react';
import { api } from '../lib/api';
import { useRoadmap, useTasks, invalidateData } from '../lib/queries';
import { useWorkspace } from '../lib/workspace';
import { dueInfo, fmtDateShort } from '../lib/format';
import { NewTaskModal, TaskDrawer } from '../components/TaskDrawer';
import { PriorityMark, TaskStatusBadge } from '../components/status';
import { Avatar, Badge, Button, EmptyState, ErrorState, IconButton, Input, PageHeader, Segmented, Select, Skeleton, cx, useToast } from '../components/ui';
import { PRIORITIES, PRIORITY_LABEL, PRIORITY_RANK, TASK_STATUSES, TASK_STATUS_LABEL, type Task, type TaskStatus } from '../../shared/domain';

type Sort = 'board' | 'due' | 'priority';

function TaskCard({ task, onOpen, draggable, overlay }: { task: Task; onOpen: () => void; draggable: boolean; overlay?: boolean }) {
  const { caps } = useWorkspace();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `task:${task.id}`, disabled: !draggable, data: { task } });
  const drop = useDroppable({ id: `before:${task.id}`, data: { task } });
  const due = dueInfo(task.due_date);
  const done = ['approved', 'completed'].includes(task.status);
  const needsClient = !!task.client_action && !done;
  return (
    <div ref={drop.setNodeRef} className={cx('relative', drop.isOver && !isDragging && 'before:absolute before:-top-1 before:inset-x-0 before:h-0.5 before:rounded-full before:bg-brand')}>
      <div
        ref={setNodeRef}
        {...(draggable ? listeners : {})}
        {...(draggable ? attributes : {})}
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => e.key === 'Enter' && onOpen()}
        className={cx(
          'group rounded-lg border bg-surface p-3 text-left transition-[border-color,box-shadow] outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
          needsClient ? 'border-brand/30' : 'border-line hover:border-line-strong',
          draggable && 'cursor-grab active:cursor-grabbing touch-none',
          isDragging && !overlay && 'opacity-40',
          overlay && 'rotate-[1.5deg] shadow-pop',
        )}
      >
        <div className="flex items-start gap-2">
          <p className={cx('min-w-0 flex-1 text-13 leading-5 font-medium', done ? 'text-muted' : 'text-ink')}>{task.title}</p>
          {caps.staff && task.visibility === 'internal' && <Lock className="mt-1 size-3 shrink-0 text-subtle" aria-label="Internal" />}
        </div>
        {task.description && <p className="mt-1 line-clamp-2 text-xs leading-4 text-muted">{task.description}</p>}
        {(needsClient || task.phase_name) && (
          <div className="mt-2 flex flex-wrap gap-1">
            {needsClient && <Badge tone={task.status === 'in_review' ? 'brandSolid' : 'brand'}><HandHelping className="size-2.5" />{caps.staff ? 'Client action' : 'Your action'}</Badge>}
            {task.phase_name && <Badge tone="neutral" className="max-w-full truncate">{task.phase_name}</Badge>}
          </div>
        )}
        <div className="mt-3 flex items-center gap-2.5 text-xs text-muted">
          <PriorityMark priority={task.priority} />
          {task.due_date && (
            <span className={cx('tabular', !done && due?.tone === 'danger' && 'font-medium text-danger', !done && due?.tone === 'warning' && 'font-medium text-warning')}>{fmtDateShort(task.due_date)}</span>
          )}
          {task.comment_count > 0 && <span className="flex items-center gap-1"><MessageSquare className="size-3" />{task.comment_count}</span>}
          {task.attachment_count > 0 && <span className="flex items-center gap-1"><Paperclip className="size-3" />{task.attachment_count}</span>}
          <span className="flex-1" />
          {task.assignee_name ? <Avatar name={task.assignee_name} size={20} /> : <span className="size-5 rounded-full border border-dashed border-line-strong" title="Unassigned" />}
        </div>
      </div>
    </div>
  );
}

function Column({ status, tasks, onOpen, canDrag, canDropHere, onAdd }: { status: TaskStatus; tasks: Task[]; onOpen: (id: string) => void; canDrag: (t: Task) => boolean; canDropHere: boolean; onAdd?: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status}`, disabled: !canDropHere });
  return (
    <section className="flex w-[284px] shrink-0 snap-start flex-col sm:w-[272px]" aria-label={TASK_STATUS_LABEL[status]}>
      <header className="mb-2 flex h-8 items-center gap-2 px-1">
        <TaskStatusBadge status={status} />
        <span className="text-xs text-muted tabular">{tasks.length}</span>
        <span className="flex-1" />
        {onAdd && <IconButton size="sm" label={`Add task to ${TASK_STATUS_LABEL[status]}`} onClick={onAdd}><Plus className="size-3.5" /></IconButton>}
      </header>
      <div
        ref={setNodeRef}
        className={cx('flex min-h-32 flex-1 flex-col gap-2 rounded-lg p-1.5 transition-colors', isOver ? 'bg-brand-50 ring-1 ring-brand/30' : 'bg-hover/60')}
      >
        {tasks.map((t) => <TaskCard key={t.id} task={t} onOpen={() => onOpen(t.id)} draggable={canDrag(t)} />)}
        {tasks.length === 0 && <p className="px-2 py-6 text-center text-xs text-subtle">No tasks</p>}
      </div>
    </section>
  );
}

export function BoardPage() {
  const { pid, caps } = useWorkspace();
  const tasksQ = useTasks(pid);
  const roadmap = useRoadmap(pid);
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const openTask = params.get('task');
  const [search, setSearch] = useState('');
  const [phase, setPhase] = useState('');
  const [priority, setPriority] = useState('');
  const [assignee, setAssignee] = useState('');
  const [onlyActions, setOnlyActions] = useState(false);
  const [visibility, setVisibility] = useState('');
  const [sort, setSort] = useState<Sort>('board');
  const [view, setView] = useState<'board' | 'list'>(() => (typeof window !== 'undefined' && window.innerWidth < 640 ? 'list' : 'board'));
  const [newTask, setNewTask] = useState<{ open: boolean; status?: TaskStatus }>({ open: false });
  const [dragging, setDragging] = useState<Task | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }));

  const setOpen = (id: string | null) => {
    const p = new URLSearchParams(params);
    if (id) p.set('task', id);
    else p.delete('task');
    setParams(p, { replace: !id });
  };

  const assignees = useMemo(() => {
    const m = new Map<string, string>();
    tasksQ.data?.forEach((t) => t.assignee_id && t.assignee_name && m.set(t.assignee_id, t.assignee_name));
    return [...m.entries()];
  }, [tasksQ.data]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    const list = (tasksQ.data ?? []).filter(
      (t) =>
        (!s || t.title.toLowerCase().includes(s) || (t.description ?? '').toLowerCase().includes(s)) &&
        (!phase || t.phase_id === phase) &&
        (!priority || t.priority === priority) &&
        (!assignee || t.assignee_id === assignee) &&
        (!visibility || t.visibility === visibility) &&
        (!onlyActions || (t.client_action && !['approved', 'completed'].includes(t.status))),
    );
    const cmp: Record<Sort, (a: Task, b: Task) => number> = {
      board: (a, b) => a.position - b.position,
      due: (a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'),
      priority: (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.position - b.position,
    };
    return list.sort(cmp[sort]);
  }, [tasksQ.data, search, phase, priority, assignee, visibility, onlyActions, sort]);

  const canDrag = (t: Task) => caps.editTasks || (caps.moveClientReview && !!t.client_action && t.status === 'in_review');
  const canDropOn = (s: TaskStatus) => caps.editTasks || (caps.moveClientReview && s === 'approved');

  const onDragEnd = async (e: DragEndEvent) => {
    setDragging(null);
    const task = e.active.data.current?.task as Task | undefined;
    const overId = String(e.over?.id ?? '');
    if (!task || !overId) return;
    let status: TaskStatus;
    let position: number;
    const all = tasksQ.data ?? [];
    if (overId.startsWith('col:')) {
      status = overId.slice(4) as TaskStatus;
      const col = all.filter((t) => t.status === status && t.id !== task.id);
      position = (col.length ? Math.max(...col.map((t) => t.position)) : 0) + 1000;
    } else {
      const target = e.over!.data.current?.task as Task;
      if (!target || target.id === task.id) return;
      status = target.status;
      const col = all.filter((t) => t.status === status && t.id !== task.id).sort((a, b) => a.position - b.position);
      const idx = col.findIndex((t) => t.id === target.id);
      const prev = idx > 0 ? col[idx - 1].position : target.position - 1000;
      position = (prev + target.position) / 2;
    }
    if (status === task.status && Math.abs(position - task.position) < 1e-9) return;
    if (!canDropOn(status)) {
      toast.info('You can approve tasks waiting for your review by moving them to Approved. Other changes are handled by your RIXZA team.');
      return;
    }
    // Optimistic update
    const key = ['project', pid, 'tasks'];
    const prevData = qc.getQueryData<Task[]>(key);
    qc.setQueryData<Task[]>(key, (old) => old?.map((t) => (t.id === task.id ? { ...t, status, position } : t)));
    try {
      await api.post(`/tasks/${task.id}/move`, { status, position });
      if (status !== task.status) toast.success(`Moved to ${TASK_STATUS_LABEL[status]}`);
      invalidateData(qc);
    } catch (err) {
      qc.setQueryData(key, prevData);
      toast.error(err as Error);
    }
  };

  const filtersActive = !!(search || phase || priority || assignee || onlyActions || visibility);
  const clearFilters = () => (setSearch(''), setPhase(''), setPriority(''), setAssignee(''), setOnlyActions(false), setVisibility(''));

  return (
    <div>
      <PageHeader
        title="Board"
        description={caps.staff ? 'All project tasks. Internal tasks are marked with a lock and never shown to the client.' : 'The status of every task in your project. Tasks marked “Your action” need your input.'}
        actions={caps.editTasks && <Button variant="primary" size="sm" icon={<Plus className="size-3.5" />} onClick={() => setNewTask({ open: true, status: 'todo' })}>New task</Button>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-60">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks" className="pl-8" aria-label="Search tasks" />
        </div>
        <Select value={phase} onChange={(e) => setPhase(e.target.value)} className="w-[calc(50%-4px)] sm:w-40" aria-label="Filter by phase">
          <option value="">All phases</option>
          {roadmap.data?.phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-[calc(50%-4px)] sm:w-32" aria-label="Filter by priority">
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
        </Select>
        {assignees.length > 0 && (
          <Select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="w-[calc(50%-4px)] sm:w-40" aria-label="Filter by assignee">
            <option value="">Anyone</option>
            {assignees.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </Select>
        )}
        {caps.staff && (
          <Select value={visibility} onChange={(e) => setVisibility(e.target.value)} className="w-[calc(50%-4px)] sm:w-36" aria-label="Filter by visibility">
            <option value="">All visibility</option>
            <option value="client">Client visible</option>
            <option value="internal">Internal only</option>
          </Select>
        )}
        <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="w-[calc(50%-4px)] sm:w-36" aria-label="Sort">
          <option value="board">Sort: Board order</option>
          <option value="due">Sort: Due date</option>
          <option value="priority">Sort: Priority</option>
        </Select>
        <Button size="md" variant={onlyActions ? 'primary' : 'secondary'} icon={<HandHelping className="size-3.5" />} onClick={() => setOnlyActions((v) => !v)}>
          {caps.staff ? 'Client actions' : 'My actions'}
        </Button>
        {filtersActive && <Button variant="ghost" icon={<X className="size-3.5" />} onClick={clearFilters}>Clear</Button>}
        <span className="flex-1" />
        <Segmented value={view} onChange={setView} options={[{ value: 'board', label: 'Board', icon: <Columns3 className="size-3.5" /> }, { value: 'list', label: 'List', icon: <List className="size-3.5" /> }]} />
      </div>

      {tasksQ.isLoading ? (
        <div className="flex gap-3 overflow-hidden">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-80 w-[272px] shrink-0" />)}</div>
      ) : tasksQ.error ? (
        <ErrorState error={tasksQ.error} onRetry={() => tasksQ.refetch()} />
      ) : (tasksQ.data ?? []).length === 0 ? (
        <EmptyState icon={<SquareKanban />} title="No tasks yet" description={caps.staff ? 'Create the first task for this project.' : 'Tasks will appear here as your RIXZA team plans the work.'}
          action={caps.editTasks && <Button variant="primary" onClick={() => setNewTask({ open: true })}>New task</Button>} />
      ) : view === 'list' ? (
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          {filtered.length === 0 && <EmptyState compact title="No tasks match your filters" action={<Button size="sm" onClick={clearFilters}>Clear filters</Button>} />}
          {TASK_STATUSES.map((s) => {
            const list = filtered.filter((t) => t.status === s);
            if (!list.length) return null;
            return (
              <div key={s}>
                <div className="flex items-center gap-2 border-b border-line bg-canvas px-4 py-2"><TaskStatusBadge status={s} /><span className="text-xs text-muted">{list.length}</span></div>
                <ul>
                  {list.map((t) => {
                    const due = dueInfo(t.due_date);
                    const done = ['approved', 'completed'].includes(t.status);
                    return (
                      <li key={t.id}>
                        <button onClick={() => setOpen(t.id)} className="flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left last:border-0 hover:bg-hover">
                          <PriorityMark priority={t.priority} />
                          <span className="min-w-0 flex-1">
                            <span className={cx('block truncate text-13 font-medium', done && 'text-muted')}>{t.title}</span>
                            <span className="block truncate text-xs text-muted">{[t.phase_name, t.assignee_name].filter(Boolean).join(' · ') || '—'}</span>
                          </span>
                          {caps.staff && t.visibility === 'internal' && <Lock className="size-3 text-subtle" />}
                          {!!t.client_action && !done && <Badge tone="brand"><HandHelping className="size-2.5" /><span className="hidden sm:inline">{caps.staff ? 'Client' : 'Your action'}</span></Badge>}
                          {t.due_date && <span className={cx('hidden text-xs tabular sm:inline', !done && due?.tone === 'danger' ? 'text-danger' : 'text-muted')}>{fmtDateShort(t.due_date)}</span>}
                          {t.comment_count > 0 && <span className="hidden items-center gap-1 text-xs text-muted sm:flex"><MessageSquare className="size-3" />{t.comment_count}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={collision} onDragStart={(e: DragStartEvent) => setDragging((e.active.data.current?.task as Task) ?? null)} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
          <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 scrollbar-thin sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
            {TASK_STATUSES.map((s) => (
              <Column
                key={s}
                status={s}
                tasks={filtered.filter((t) => t.status === s)}
                onOpen={setOpen}
                canDrag={canDrag}
                canDropHere={canDropOn(s)}
                onAdd={caps.editTasks ? () => setNewTask({ open: true, status: s }) : undefined}
              />
            ))}
          </div>
          <DragOverlay dropAnimation={null}>{dragging && <div className="w-[260px]"><TaskCard task={dragging} onOpen={() => {}} draggable={false} overlay /></div>}</DragOverlay>
        </DndContext>
      )}

      <TaskDrawer taskId={openTask} onClose={() => setOpen(null)} />
      <NewTaskModal open={newTask.open} defaultStatus={newTask.status} onClose={() => setNewTask({ open: false })} onCreated={(t) => setOpen(t.id)} />
    </div>
  );
}
