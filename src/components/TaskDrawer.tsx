import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Lock, Paperclip, Trash2, Upload, X, PackageCheck, HandHelping } from 'lucide-react';
import { api } from '../lib/api';
import { useAction, useRoadmap, useStaffOptions, useTask } from '../lib/queries';
import { useWorkspace } from '../lib/workspace';
import { dueInfo, fmtDate, fmtDateTime, fmtRelative } from '../lib/format';
import { CommentList, Composer } from './Comments';
import { FileChip } from './files';
import { ActivityTimeline } from './Activity';
import { DeliverableStatusBadge, PriorityMark, TaskStatusBadge, VisibilityBadge } from './status';
import { Badge, Button, Checkbox, Drawer, EmptyState, ErrorState, Field, IconButton, Input, Modal, Segmented, Select, Skeleton, Tabs, Textarea, cx, useConfirm, useToast } from './ui';
import { PRIORITIES, PRIORITY_LABEL, TASK_STATUSES, TASK_STATUS_LABEL, type Priority, type Task, type TaskStatus, type Visibility } from '../../shared/domain';

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-center gap-3 min-h-8">
      <span className="text-xs text-muted">{label}</span>
      <div className="min-w-0 text-13">{children}</div>
    </div>
  );
}

export function TaskDrawer({ taskId, onClose }: { taskId: string | null; onClose: () => void }) {
  const { pid, base, caps } = useWorkspace();
  const q = useTask(taskId);
  const roadmap = useRoadmap(pid);
  const staff = useStaffOptions(caps.staff && !!taskId);
  const confirm = useConfirm();
  const toast = useToast();
  const [tab, setTab] = useState<'comments' | 'internal' | 'history'>('comments');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    setTab('comments');
    setDesc(null);
  }, [taskId]);
  useEffect(() => {
    if (q.data) setTitle(q.data.task.title);
  }, [q.data?.task.title]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = useAction((body: Record<string, unknown>) => api.patch(`/tasks/${taskId}`, body), { success: 'Task updated' });
  const approve = useAction(() => api.post(`/tasks/${taskId}/move`, { status: 'approved', position: q.data!.task.position }), { success: 'Thank you — approval recorded.' });
  const del = useAction(() => api.del(`/tasks/${taskId}`), { success: 'Task deleted', onSuccess: onClose });

  const t = q.data?.task;
  const editable = caps.editTasks;
  const clientComments = q.data?.comments.filter((c) => c.visibility === 'client') ?? [];
  const internalComments = q.data?.comments.filter((c) => c.visibility === 'internal') ?? [];

  const uploadFiles = async (list: FileList | null) => {
    if (!list?.length || !t) return;
    const fd = new FormData();
    Array.from(list).forEach((f) => fd.append('files', f));
    fd.append('task_id', t.id);
    fd.append('category', 'Documents');
    if (caps.staff) fd.append('visibility', t.visibility);
    setUploading(true);
    try {
      await api.post(`/projects/${pid}/files`, fd);
      toast.success('File attached');
      q.refetch();
    } catch (e) {
      toast.error(e as Error);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <Drawer open={!!taskId} onClose={onClose} label="Task details" width={640}>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-5">
        {t && <TaskStatusBadge status={t.status} />}
        {t && caps.staff && <VisibilityBadge visibility={t.visibility} />}
        {t && !!t.client_action && <Badge tone="warning"><HandHelping className="size-2.5" /> {caps.staff ? 'Client action' : 'Your action'}</Badge>}
        <span className="flex-1" />
        {t && caps.manage && (
          <IconButton label="Delete task" onClick={async () => (await confirm({ title: 'Delete this task?', description: 'Comments and history for this task will be removed. This is recorded in the audit log.', confirmLabel: 'Delete task', danger: true })) && del.mutate()}>
            <Trash2 className="size-4" />
          </IconButton>
        )}
        <IconButton label="Close" onClick={onClose}><X className="size-4" /></IconButton>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {q.isLoading ? (
          <div className="flex flex-col gap-4 p-5"><Skeleton className="h-7 w-3/4" /><Skeleton className="h-32" /><Skeleton className="h-40" /></div>
        ) : q.error ? (
          <ErrorState error={q.error} />
        ) : t ? (
          <div className="px-5 py-5">
            {editable ? (
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => title.trim() && title !== t.title && patch.mutate({ title })}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                className="-mx-1.5 w-[calc(100%+12px)] rounded-md px-1.5 py-1 text-[18px] leading-7 font-semibold outline-none hover:bg-hover focus:bg-hover"
                aria-label="Task title"
              />
            ) : (
              <h2 className="text-[18px] leading-7 font-semibold">{t.title}</h2>
            )}
            <p className="mt-1 text-xs text-muted">Updated {fmtRelative(t.updated_at)}{t.completed_at ? ` · completed ${fmtDate(t.completed_at)}` : ''}</p>

            {!caps.staff && !!t.client_action && !['approved', 'completed'].includes(t.status) && (
              <div className="mt-4 rounded-lg border border-brand/25 bg-brand-50 p-4">
                <p className="text-13 font-medium text-ink">{t.status === 'in_review' ? 'This is ready for your review' : 'Your input is needed'}</p>
                <p className="mt-1 text-13 text-ink-2">
                  {t.status === 'in_review'
                    ? 'Review the work and approve it, or leave a comment below describing what you’d like changed. Your team is notified either way.'
                    : 'Share the requested information in the comments or attach files below. Your project manager will move the task forward once received.'}
                </p>
                {t.status === 'in_review' && q.data!.deliverables.some((d) => ['submitted', 'awaiting_feedback'].includes(d.status)) ? (
                  <Link to={`${base}/deliverables/${q.data!.deliverables.find((d) => ['submitted', 'awaiting_feedback'].includes(d.status))!.id}`}>
                    <Button className="mt-3" variant="primary" icon={<PackageCheck className="size-3.5" />}>Review the deliverable</Button>
                  </Link>
                ) : t.status === 'in_review' && caps.moveClientReview && (
                  <Button className="mt-3" variant="primary" icon={<CheckCircle2 className="size-3.5" />} loading={approve.isPending}
                    onClick={async () => (await confirm({ title: `Approve “${t.title}”?`, description: 'Your approval is recorded with your name and the date. Your RIXZA team will proceed with the next steps.', confirmLabel: 'Approve' })) && approve.mutate()}>
                    Approve
                  </Button>
                )}
              </div>
            )}

            <div className="mt-5 flex flex-col gap-1">
              <PropRow label="Status">
                {editable ? (
                  <Select value={t.status} onChange={(e) => patch.mutate({ status: e.target.value as TaskStatus })} className="max-w-[200px]">
                    {TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}
                  </Select>
                ) : <TaskStatusBadge status={t.status} />}
              </PropRow>
              <PropRow label="Priority">
                {editable ? (
                  <Select value={t.priority} onChange={(e) => patch.mutate({ priority: e.target.value as Priority })} className="max-w-[200px]">
                    {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
                  </Select>
                ) : <PriorityMark priority={t.priority} withLabel />}
              </PropRow>
              <PropRow label="Assigned to">
                {editable ? (
                  <Select value={t.assignee_id ?? ''} onChange={(e) => patch.mutate({ assignee_id: e.target.value || null })} className="max-w-[200px]">
                    <option value="">Unassigned</option>
                    {staff.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </Select>
                ) : (t.assignee_name ?? <span className="text-muted">RIXZA team</span>)}
              </PropRow>
              <PropRow label="Due date">
                {editable ? (
                  <Input type="date" value={t.due_date ?? ''} onChange={(e) => patch.mutate({ due_date: e.target.value || null })} className="max-w-[200px]" />
                ) : t.due_date ? (
                  <span className="flex items-center gap-2">{fmtDate(t.due_date)} {(() => { const d = dueInfo(t.due_date); return d && d.tone !== 'neutral' && !['approved', 'completed'].includes(t.status) ? <Badge tone={d.tone}>{d.label}</Badge> : null; })()}</span>
                ) : <span className="text-muted">Not set</span>}
              </PropRow>
              <PropRow label="Phase">
                {editable ? (
                  <Select value={t.phase_id ?? ''} onChange={(e) => patch.mutate({ phase_id: e.target.value || null })} className="max-w-[200px]">
                    <option value="">No phase</option>
                    {roadmap.data?.phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                ) : (t.phase_name ? <Link to={`${base}/project#${t.phase_id}`} className="hover:underline">{t.phase_name}</Link> : <span className="text-muted">—</span>)}
              </PropRow>
              {caps.manage && (
                <>
                  <PropRow label="Visibility">
                    <Segmented size="sm" value={t.visibility} onChange={(v: Visibility) => patch.mutate(v === 'internal' ? { visibility: v, client_action: false } : { visibility: v })}
                      options={[{ value: 'internal', label: 'Internal only', icon: <Lock className="size-3" /> }, { value: 'client', label: 'Client visible' }]} />
                  </PropRow>
                  <PropRow label="Client action">
                    <Checkbox checked={!!t.client_action} disabled={t.visibility !== 'client'} onChange={(v) => patch.mutate({ client_action: v })} label="Requires input or approval from the client" />
                  </PropRow>
                </>
              )}
            </div>

            <div className="mt-6">
              <div className="mb-2 text-xs font-medium text-muted">Description</div>
              {editable ? (
                desc !== null ? (
                  <div className="flex flex-col gap-2">
                    <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={5} autoFocus />
                    <div className="flex gap-2">
                      <Button size="sm" variant="primary" loading={patch.isPending} onClick={() => patch.mutate({ description: desc || null }, { onSuccess: () => setDesc(null) })}>Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => setDesc(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setDesc(t.description ?? '')} className="prose-comment -mx-2 block w-[calc(100%+16px)] rounded-md px-2 py-1.5 text-left text-13 leading-5 text-ink-2 hover:bg-hover">
                    {t.description || <span className="text-subtle">Add a description…</span>}
                  </button>
                )
              ) : (
                <p className="prose-comment text-13 leading-5 text-ink-2">{t.description || <span className="text-muted">No description.</span>}</p>
              )}
            </div>

            {q.data!.deliverables.length > 0 && (
              <div className="mt-6">
                <div className="mb-2 text-xs font-medium text-muted">Related deliverables</div>
                <div className="flex flex-col gap-1.5">
                  {q.data!.deliverables.map((d) => (
                    <Link key={d.id} to={`${base}/deliverables/${d.id}`} className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-13 hover:border-line-strong">
                      <PackageCheck className="size-3.5 text-muted" />
                      <span className="flex-1 truncate">{d.title}</span>
                      <span className="text-xs text-muted">v{d.current_version}</span>
                      <DeliverableStatusBadge status={d.status as any} clientView={!caps.staff} />
                    </Link>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-muted">Attachments{q.data!.files.length ? ` · ${q.data!.files.length}` : ''}</span>
                <input ref={fileRef} type="file" multiple hidden onChange={(e) => uploadFiles(e.target.files)} />
                <Button size="xs" variant="ghost" icon={<Upload className="size-3" />} loading={uploading} onClick={() => fileRef.current?.click()}>Upload</Button>
              </div>
              {q.data!.files.length ? (
                <div className="grid gap-1.5 sm:grid-cols-2">{q.data!.files.map((f) => <FileChip key={f.id} file={f} />)}</div>
              ) : (
                <p className="flex items-center gap-1.5 text-13 text-subtle"><Paperclip className="size-3.5" /> No attachments</p>
              )}
            </div>

            <div className="mt-8">
              <Tabs
                value={tab}
                onChange={setTab}
                tabs={[
                  { value: 'comments', label: caps.staff ? 'Client conversation' : 'Comments', count: clientComments.length },
                  ...(caps.staff ? [{ value: 'internal' as const, label: <span className="flex items-center gap-1"><Lock className="size-3" />Internal notes</span>, count: internalComments.length }] : []),
                  { value: 'history', label: 'History' },
                ]}
              />
              <div className="pt-5">
                {tab === 'history' ? (
                  q.data!.history.length ? <ActivityTimeline items={q.data!.history} base={base} showVisibility={caps.staff} /> : <EmptyState compact title="No history yet" />
                ) : tab === 'internal' ? (
                  <div className="flex flex-col gap-5">
                    <CommentList comments={internalComments} target="task" targetId={t.id} empty={<p className="text-13 text-muted">Internal notes are only visible to the RIXZA team.</p>} />
                    <Composer target="task" targetId={t.id} visibility="internal" />
                  </div>
                ) : t.visibility === 'internal' ? (
                  <p className="rounded-md border border-line bg-canvas p-3 text-13 text-muted">This task is internal. Share it with the client to start a client conversation, or use internal notes.</p>
                ) : (
                  <div className="flex flex-col gap-5">
                    <CommentList comments={clientComments} target="task" targetId={t.id} empty={<p className="text-13 text-muted">{caps.staff ? 'No messages with the client yet.' : 'Questions or feedback on this task? Your RIXZA team will reply here.'}</p>} />
                    <Composer target="task" targetId={t.id} visibility="client" />
                  </div>
                )}
              </div>
            </div>
            <p className="mt-8 text-2xs text-subtle">Created {fmtDateTime(t.created_at)}</p>
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}

export function NewTaskModal({ open, onClose, defaultStatus = 'todo', onCreated }: { open: boolean; onClose: () => void; defaultStatus?: TaskStatus; onCreated?: (t: Task) => void }) {
  const { pid, caps } = useWorkspace();
  const roadmap = useRoadmap(pid);
  const staff = useStaffOptions(open);
  const empty = { title: '', description: '', status: defaultStatus, priority: 'medium' as Priority, assignee_id: '', due_date: '', phase_id: '', visibility: 'internal' as Visibility, client_action: false };
  const [f, setF] = useState(empty);
  useEffect(() => {
    if (open) setF({ ...empty, status: defaultStatus, phase_id: roadmap.data?.phases.find((p) => p.status === 'in_progress')?.id ?? '' });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const create = useAction(
    () => api.post<Task>(`/projects/${pid}/tasks`, { ...f, description: f.description || null, assignee_id: f.assignee_id || null, due_date: f.due_date || null, phase_id: f.phase_id || null }),
    { success: 'Task created', onSuccess: (t) => (onClose(), onCreated?.(t)) },
  );
  return (
    <Modal open={open} onClose={onClose} title="New task" size="lg"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.title.trim()} loading={create.isPending} onClick={() => create.mutate()}>Create task</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus placeholder="e.g. Homepage hero animation" /></Field>
        <Field label="Description" optional><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={3} /></Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Status">
            <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as TaskStatus })}>
              {TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Priority })}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </Select>
          </Field>
          <Field label="Due date"><Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Assignee">
            <Select value={f.assignee_id} onChange={(e) => setF({ ...f, assignee_id: e.target.value })}>
              <option value="">Unassigned</option>
              {staff.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </Field>
          <Field label="Phase">
            <Select value={f.phase_id} onChange={(e) => setF({ ...f, phase_id: e.target.value })}>
              <option value="">No phase</option>
              {roadmap.data?.phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        </div>
        {caps.manage && (
          <div className={cx('flex flex-col gap-3 rounded-lg border p-3', f.visibility === 'client' ? 'border-brand/25 bg-brand-50/50' : 'border-line bg-canvas')}>
            <Field label="Visibility" hint={f.visibility === 'internal' ? 'Only the RIXZA team can see this task.' : 'The client can see this task, its client conversation and attachments.'}>
              <Segmented value={f.visibility} onChange={(v) => setF({ ...f, visibility: v, client_action: v === 'internal' ? false : f.client_action })}
                options={[{ value: 'internal', label: 'Internal only', icon: <Lock className="size-3" /> }, { value: 'client', label: 'Client visible' }]} />
            </Field>
            <Checkbox checked={f.client_action} disabled={f.visibility !== 'client'} onChange={(v) => setF({ ...f, client_action: v })} label="Requires client action" description="Appears in the client’s “Your attention is needed” list and notifies them." />
          </div>
        )}
      </div>
    </Modal>
  );
}
