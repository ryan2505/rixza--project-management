import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, ExternalLink, FilePlus2, Flag, History, Lock, PackageCheck, PackageOpen, Pencil, Plus, RotateCcw, Send, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { api, fileUrl } from '../lib/api';
import { useAction, useDeliverable, useDeliverables, useMe, useRoadmap, useTasks } from '../lib/queries';
import { useWorkspace } from '../lib/workspace';
import { dueInfo, fmtDate, fmtDateTime, fmtRelative } from '../lib/format';
import { CommentList, Composer } from '../components/Comments';
import { FileChip, FilePreviewModal } from '../components/files';
import { DeliverableStatusBadge } from '../components/status';
import { Badge, Button, Checkbox, EmptyState, ErrorState, Field, Input, KeyValue, Modal, PageHeader, Panel, Select, Skeleton, Tabs, Textarea, cx, useConfirm } from '../components/ui';
import { FILE_CATEGORIES, REVIEWABLE_STATUSES, type Deliverable, type DeliverableVersion, type FileItem } from '../../shared/domain';

function DeliverableModal({ open, onClose, deliverable }: { open: boolean; onClose: () => void; deliverable?: Deliverable }) {
  const { pid } = useWorkspace();
  const roadmap = useRoadmap(pid);
  const tasks = useTasks(pid);
  const [f, setF] = useState({ title: '', description: '', phase_id: '', task_id: '', review_due: '' });
  useEffect(() => {
    if (open) setF({ title: deliverable?.title ?? '', description: deliverable?.description ?? '', phase_id: deliverable?.phase_id ?? '', task_id: deliverable?.task_id ?? '', review_due: deliverable?.review_due ?? '' });
  }, [open, deliverable]);
  const save = useAction(
    () => {
      const body = { title: f.title, description: f.description || null, phase_id: f.phase_id || null, task_id: f.task_id || null, review_due: f.review_due || null };
      return deliverable ? api.patch(`/deliverables/${deliverable.id}`, body) : api.post<{ id: string }>(`/projects/${pid}/deliverables`, body);
    },
    { success: deliverable ? 'Deliverable updated' : 'Draft created — upload a version to share it.', onSuccess: onClose },
  );
  return (
    <Modal open={open} onClose={onClose} title={deliverable ? 'Edit deliverable' : 'New deliverable'} description={deliverable ? undefined : 'Deliverables start as internal drafts. The client sees them once you submit a version for review.'} size="lg"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.title.trim()} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Name"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus placeholder="e.g. Homepage design" /></Field>
        <Field label="Description" optional><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={3} /></Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Phase">
            <Select value={f.phase_id} onChange={(e) => setF({ ...f, phase_id: e.target.value })}>
              <option value="">None</option>
              {roadmap.data?.phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Linked task" hint="Moves with approvals.">
            <Select value={f.task_id} onChange={(e) => setF({ ...f, task_id: e.target.value })}>
              <option value="">None</option>
              {tasks.data?.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </Select>
          </Field>
          <Field label="Review deadline"><Input type="date" value={f.review_due} onChange={(e) => setF({ ...f, review_due: e.target.value })} /></Field>
        </div>
      </div>
    </Modal>
  );
}

function VersionUploadModal({ open, onClose, deliverable }: { open: boolean; onClose: () => void; deliverable: Deliverable }) {
  const [files, setFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState('');
  const [link, setLink] = useState('');
  const [category, setCategory] = useState('Design Files');
  const [submit, setSubmit] = useState(true);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) (setFiles([]), setNotes(''), setLink(''), setSubmit(true));
  }, [open]);
  const save = useAction(
    () => {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      fd.append('notes', notes);
      fd.append('link_url', link);
      fd.append('category', category);
      fd.append('submit', String(submit));
      return api.post<{ version: number }>(`/deliverables/${deliverable.id}/versions`, fd);
    },
    { success: (r) => (submit ? `Version ${r.version} submitted — the client has been notified.` : `Version ${r.version} saved as draft.`), onSuccess: onClose },
  );
  const next = deliverable.current_version + 1;
  return (
    <Modal open={open} onClose={onClose} title={`Upload version ${next}`} description={deliverable.status === 'changes_requested' ? 'This version will answer the open revision request.' : undefined} size="lg"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!files.length && !link.trim()} icon={submit ? <Send className="size-3.5" /> : undefined} onClick={() => save.mutate()}>{submit ? 'Upload & submit for review' : 'Save draft version'}</Button></>}>
      <div className="flex flex-col gap-4">
        <button type="button" onClick={() => ref.current?.click()} className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-line-strong px-4 py-6 text-center hover:border-brand hover:bg-brand-50/40">
          <Upload className="size-4 text-muted" />
          <span className="text-13 font-medium">{files.length ? `${files.length} file${files.length > 1 ? 's' : ''} selected` : 'Choose files'}</span>
          <span className="text-xs text-muted">{files.length ? files.map((f) => f.name).join(', ') : 'Up to 10 files, 50 MB each'}</span>
        </button>
        <input ref={ref} type="file" multiple hidden onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Preview link" optional hint="Staging site, Figma, video…"><Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" /></Field>
          <Field label="File category">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>{FILE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select>
          </Field>
        </div>
        <Field label="Notes for the client" optional><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="What changed, what to look at, what you need from them…" /></Field>
        <Checkbox checked={submit} onChange={setSubmit} label="Submit to the client for review now" description="The client is notified and can approve or request changes. Unsubmitted versions stay internal." />
      </div>
    </Modal>
  );
}

function DecisionModal({ open, onClose, deliverable, version, decision }: { open: boolean; onClose: () => void; deliverable: Deliverable; version: number; decision: 'approved' | 'changes_requested' }) {
  const me = useMe().data!.user!;
  const [feedback, setFeedback] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    if (open) (setFeedback(''), setConfirmed(false));
  }, [open]);
  const approve = decision === 'approved';
  const send = useAction(() => api.post(`/deliverables/${deliverable.id}/decision`, { decision, version, feedback: feedback || undefined, confirm: true }), {
    success: approve ? 'Approval recorded. Thank you!' : 'Your change request has been sent to the team.',
    onSuccess: onClose,
  });
  return (
    <Modal open={open} onClose={onClose} title={approve ? `Approve ${deliverable.title}` : `Request changes to ${deliverable.title}`} description={`Version ${version}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant={approve ? 'primary' : 'dark'} disabled={approve ? !confirmed : feedback.trim().length < 3} loading={send.isPending} onClick={() => send.mutate()}>{approve ? 'Confirm approval' : 'Send change request'}</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label={approve ? 'Comment' : 'What would you like changed?'} optional={approve} hint={approve ? undefined : 'Be as specific as possible — this becomes a formal revision request for the team.'}>
          <Textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={4} autoFocus placeholder={approve ? 'Anything you’d like to add?' : 'e.g. Please make the booking button more prominent on mobile…'} />
        </Field>
        {approve ? (
          <div className="rounded-lg border border-line bg-canvas p-3">
            <Checkbox checked={confirmed} onChange={setConfirmed} label={`I, ${me.name}, approve version ${version} of “${deliverable.title}”.`} description="Your approval is recorded with your name, the version and a timestamp. RIXZA will proceed on this basis." />
          </div>
        ) : (
          <p className="text-xs text-muted">What happens next: the team is notified immediately, prepares a revised version and submits it to you for review.</p>
        )}
      </div>
    </Modal>
  );
}

function VersionBlock({ v, latest, onPreview }: { v: DeliverableVersion; latest: boolean; onPreview: (f: FileItem) => void }) {
  const { caps } = useWorkspace();
  const image = v.files.find((f) => f.mime.startsWith('image/'));
  return (
    <div className={cx(latest ? '' : 'rounded-lg border border-line p-4')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-13 font-semibold">Version {v.version}</span>
        {latest && <Badge tone="brand">Latest</Badge>}
        {!v.submitted_at && <Badge tone="outline"><Lock className="size-2.5" /> Not yet submitted</Badge>}
        <span className="text-xs text-muted">{v.submitted_at ? `Submitted ${fmtDateTime(v.submitted_at)}` : `Prepared ${fmtRelative(v.created_at)}`} by {v.submitter_name}</span>
      </div>
      {v.notes && <p className="prose-comment mt-2 text-13 text-ink-2">{v.notes}</p>}
      {latest && image && (
        <button onClick={() => onPreview(image)} className="mt-4 block w-full overflow-hidden rounded-lg border border-line bg-canvas">
          <img src={fileUrl(image.id, true)} alt={image.name} className="mx-auto max-h-[420px] w-auto" />
        </button>
      )}
      {(v.files.length > 0 || v.link_url) && (
        <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {v.link_url && (
            <a href={v.link_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-md border border-line px-2.5 py-2 text-xs font-medium hover:border-line-strong">
              <ExternalLink className="size-3.5 text-brand" /><span className="truncate">{v.link_url.replace(/^https?:\/\//, '')}</span>
            </a>
          )}
          {v.files.map((f) => <FileChip key={f.id} file={f} onPreview={onPreview} />)}
        </div>
      )}
      {caps.staff && !v.files.length && !v.link_url && <p className="mt-2 text-xs text-muted">No files.</p>}
    </div>
  );
}

export function DeliverableDetailPage() {
  const { did } = useParams();
  const { base, caps, detail } = useWorkspace();
  const q = useDeliverable(did);
  const confirm = useConfirm();
  const [preview, setPreview] = useState<FileItem | null>(null);
  const [decision, setDecision] = useState<'approved' | 'changes_requested' | null>(null);
  const [upload, setUpload] = useState(false);
  const [edit, setEdit] = useState(false);
  const [tab, setTab] = useState<'client' | 'internal'>('client');
  const viewed = useRef(false);

  const submit = useAction(() => api.post(`/deliverables/${did}/submit`), { success: 'Submitted — the client has been notified.' });
  const finalize = useAction(() => api.post(`/deliverables/${did}/finalize`), { success: 'Finalized and added to Final Deliverables.' });
  const remove = useAction(() => api.del(`/deliverables/${did}`), { success: 'Draft deleted', onSuccess: () => history.back() });

  useEffect(() => {
    if (!viewed.current && q.data && !caps.staff && q.data.deliverable.status === 'submitted') {
      viewed.current = true;
      api.post(`/deliverables/${did}/view`).catch(() => {});
    }
  }, [q.data, caps.staff, did]);

  if (q.isLoading) return <div className="flex flex-col gap-4"><Skeleton className="h-8 w-80" /><Skeleton className="h-96" /></div>;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { deliverable: d, versions, approvals, revisions, comments } = q.data!;
  const latestSubmitted = versions.find((v) => v.submitted_at);
  const pendingDraft = versions.find((v) => !v.submitted_at);
  const reviewable = REVIEWABLE_STATUSES.includes(d.status);
  const due = dueInfo(d.review_due);
  const primaryContact = detail.clientUsers.find((u) => u.role === 'client');

  return (
    <div>
      <Link to={`${base}/deliverables`} className="mb-4 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-ink"><ArrowLeft className="size-3.5" /> All deliverables</Link>
      <PageHeader
        eyebrow={[d.phase_name, d.current_version ? `Version ${d.current_version}` : null].filter(Boolean).join(' · ') || undefined}
        title={<span className="flex flex-wrap items-center gap-2">{d.title} <DeliverableStatusBadge status={d.status} clientView={!caps.staff} /></span>}
        description={d.description ?? undefined}
        actions={caps.manage && (
          <>
            <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => setEdit(true)}>Edit</Button>
            {d.status === 'draft' && <Button size="sm" variant="danger" icon={<Trash2 className="size-3.5" />} onClick={async () => (await confirm({ title: 'Delete this draft?', danger: true, confirmLabel: 'Delete' })) && remove.mutate()}>Delete</Button>}
          </>
        )}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="Current version" bodyClassName="p-5">
            {versions.length === 0 ? (
              <EmptyState compact icon={<PackageOpen />} title="No version yet" description={caps.manage ? 'Upload the first version to share it with the client.' : 'Your team is preparing this deliverable.'} action={caps.manage && <Button variant="primary" icon={<Upload className="size-3.5" />} onClick={() => setUpload(true)}>Upload version 1</Button>} />
            ) : (
              <VersionBlock v={versions[0]} latest onPreview={setPreview} />
            )}
          </Panel>

          {versions.length > 1 && (
            <Panel title={<span className="flex items-center gap-1.5"><History className="size-3.5 text-muted" />Version history</span>} bodyClassName="flex flex-col gap-3 p-4">
              {versions.slice(1).map((v) => <VersionBlock key={v.id} v={v} latest={false} onPreview={setPreview} />)}
            </Panel>
          )}

          <Panel title="Discussion" bodyClassName="p-5">
            {caps.staff && <Tabs className="-mt-2 mb-5" value={tab} onChange={setTab} tabs={[{ value: 'client', label: 'Client conversation', count: comments.filter((c) => c.visibility === 'client').length }, { value: 'internal', label: <span className="flex items-center gap-1"><Lock className="size-3" />Internal notes</span>, count: comments.filter((c) => c.visibility === 'internal').length }]} />}
            {d.status === 'draft' && tab === 'client' && caps.staff ? (
              <p className="text-13 text-muted">The client conversation opens once the deliverable is submitted.</p>
            ) : (
              <div className="flex flex-col gap-5">
                <CommentList comments={comments.filter((c) => c.visibility === (caps.staff ? tab : 'client'))} target="deliverable" targetId={d.id} empty={<p className="text-13 text-muted">{tab === 'internal' ? 'Internal notes are only visible to the RIXZA team.' : 'Questions about this deliverable? Ask here — note that comments are not approvals.'}</p>} />
                <Composer target="deliverable" targetId={d.id} visibility={caps.staff ? tab : 'client'} />
              </div>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          {/* Review / actions */}
          {caps.staff ? (
            <Panel title="Actions">
              <div className="flex flex-col gap-2">
                {pendingDraft ? (
                  <Button variant="primary" icon={<Send className="size-3.5" />} loading={submit.isPending} onClick={async () => (await confirm({ title: `Submit version ${pendingDraft.version} for review?`, description: 'The client will be notified and asked to approve or request changes.', confirmLabel: 'Submit' })) && submit.mutate()}>
                    Submit v{pendingDraft.version} for review
                  </Button>
                ) : (
                  caps.manage && !['approved', 'finalized'].includes(d.status) && !reviewable && (
                    <Button variant="primary" icon={<FilePlus2 className="size-3.5" />} onClick={() => setUpload(true)}>{d.current_version ? `Upload version ${d.current_version + 1}` : 'Upload first version'}</Button>
                  )
                )}
                {reviewable && <p className="rounded-md bg-hover px-3 py-2 text-xs text-ink-2">Waiting for {primaryContact?.name ?? 'the client'} to review version {d.current_version}{d.status === 'awaiting_feedback' ? ' — they have opened it.' : '.'}</p>}
                {d.status === 'approved' && caps.manage && (
                  <Button variant="dark" icon={<PackageCheck className="size-3.5" />} loading={finalize.isPending} onClick={async () => (await confirm({ title: 'Finalize this deliverable?', description: 'Files of the approved version move to Final Deliverables and the client is notified.', confirmLabel: 'Finalize' })) && finalize.mutate()}>
                    Finalize & hand over
                  </Button>
                )}
                {d.status === 'finalized' && <p className="flex items-center gap-1.5 text-13 text-ink-2"><CheckCircle2 className="size-4 text-brand" /> Finalized and delivered.</p>}
              </div>
            </Panel>
          ) : (
            <Panel title="Your review" className={cx(reviewable && caps.approve && 'border-brand/40')}>
              {reviewable && latestSubmitted ? (
                caps.approve ? (
                  <div className="flex flex-col gap-3">
                    <p className="text-13 text-ink-2">Please review <strong className="font-medium text-ink">version {latestSubmitted.version}</strong>{d.review_due ? <> by <strong className="font-medium text-ink">{fmtDate(d.review_due)}</strong></> : null}.</p>
                    {due && due.tone !== 'neutral' && <Badge tone={due.tone}>{due.label}</Badge>}
                    <Button variant="primary" size="lg" icon={<CheckCircle2 className="size-4" />} onClick={() => setDecision('approved')}>Approve</Button>
                    <Button size="lg" icon={<RotateCcw className="size-4" />} onClick={() => setDecision('changes_requested')}>Request changes</Button>
                    <p className="text-xs leading-5 text-muted">Comments don’t count as approval. Use these buttons to record your decision formally.</p>
                  </div>
                ) : (
                  <p className="text-13 text-ink-2">This deliverable is awaiting approval from {primaryContact?.name ?? 'your primary contact'}. You can still share feedback in the discussion.</p>
                )
              ) : d.status === 'changes_requested' ? (
                <p className="text-13 text-ink-2">Your change request was sent. The team is preparing a revised version — you’ll be notified when it’s ready.</p>
              ) : d.status === 'approved' || d.status === 'finalized' ? (
                <p className="flex items-start gap-2 text-13 text-ink-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand" />{d.status === 'finalized' ? 'Approved and delivered. Final files are available in Files → Final Deliverables.' : 'Approved. Your team will finalize the handover.'}</p>
              ) : (
                <p className="text-13 text-muted">Nothing to review right now.</p>
              )}
            </Panel>
          )}

          <Panel title="Details">
            <KeyValue
              items={[
                { label: 'Status', value: <DeliverableStatusBadge status={d.status} clientView={!caps.staff} /> },
                { label: 'Version', value: d.current_version ? `v${d.current_version}` : '—' },
                { label: 'Submitted by', value: d.last_submitter_name ?? '—' },
                { label: 'Submitted', value: d.last_submitted_at ? fmtDate(d.last_submitted_at) : '—' },
                { label: 'Review deadline', value: d.review_due ? fmtDate(d.review_due) : '—' },
                ...(d.phase_name ? [{ label: 'Phase', value: d.phase_name }] : []),
                ...(d.task_id ? [{ label: 'Task', value: <Link to={`${base}/board?task=${d.task_id}`} className="text-brand hover:underline">Open task</Link> }] : []),
              ]}
            />
          </Panel>

          <Panel title={<span className="flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-muted" />Approval record</span>} bodyClassName="p-0">
            {approvals.length ? (
              <ul>
                {approvals.map((a) => (
                  <li key={a.id} className="border-b border-line px-4 py-3 last:border-0">
                    <div className="flex items-center gap-2">
                      {a.decision === 'approved' ? <Badge tone="success">Approved</Badge> : <Badge tone="danger">Changes requested</Badge>}
                      <span className="text-xs text-muted">v{a.version}</span>
                    </div>
                    <p className="mt-1 text-xs text-ink-2">{a.user_name} · {fmtDateTime(a.created_at)}</p>
                    {a.feedback && <p className="prose-comment mt-1.5 border-l-2 border-line pl-2 text-xs text-muted">{a.feedback}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-4 text-13 text-muted">No decision recorded yet.</p>
            )}
          </Panel>

          {revisions.length > 0 && (
            <Panel title="Revision requests" bodyClassName="p-0">
              <ul>
                {revisions.map((r) => (
                  <li key={r.id} className="border-b border-line px-4 py-3 last:border-0">
                    <div className="flex items-center gap-2">
                      <Badge tone={r.status === 'open' ? 'warning' : 'neutral'}>{r.status === 'open' ? 'Open' : `Resolved in v${r.resolved_version}`}</Badge>
                      <span className="text-xs text-muted">on v{r.version}</span>
                    </div>
                    <p className="prose-comment mt-1.5 text-13 text-ink-2">{r.details}</p>
                    <p className="mt-1 text-xs text-muted">{r.requester_name} · {fmtRelative(r.created_at)}</p>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>

      <FilePreviewModal file={preview} onClose={() => setPreview(null)} />
      {decision && latestSubmitted && <DecisionModal open={!!decision} decision={decision} version={latestSubmitted.version} deliverable={d} onClose={() => setDecision(null)} />}
      <VersionUploadModal open={upload} onClose={() => setUpload(false)} deliverable={d} />
      <DeliverableModal open={edit} onClose={() => setEdit(false)} deliverable={d} />
    </div>
  );
}

function DeliverableRow({ d }: { d: Deliverable }) {
  const { base, caps } = useWorkspace();
  const due = dueInfo(d.review_due);
  const reviewable = REVIEWABLE_STATUSES.includes(d.status);
  return (
    <li>
      <Link to={`${base}/deliverables/${d.id}`} className="flex items-center gap-3 border-b border-line px-4 py-3.5 last:border-0 hover:bg-hover">
        <span className={cx('flex size-8 shrink-0 items-center justify-center rounded-md', reviewable && !caps.staff ? 'bg-brand text-white' : 'bg-hover text-muted')}><PackageCheck className="size-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-13 font-medium">{d.title}</span>
          <span className="block truncate text-xs text-muted">
            {[d.phase_name, d.current_version ? `v${d.current_version}` : 'No version yet', d.last_submitted_at ? `submitted ${fmtRelative(d.last_submitted_at)}${d.last_submitter_name ? ` by ${d.last_submitter_name}` : ''}` : null].filter(Boolean).join(' · ')}
          </span>
        </span>
        {d.review_due && !['approved', 'finalized'].includes(d.status) && (
          <span className={cx('hidden text-xs tabular sm:block', due?.tone === 'danger' ? 'text-danger' : due?.tone === 'warning' ? 'text-warning' : 'text-muted')}>Review by {fmtDate(d.review_due, false)}</span>
        )}
        <DeliverableStatusBadge status={d.status} clientView={!caps.staff} />
      </Link>
    </li>
  );
}

function Group({ title, items, empty }: { title: ReactNode; items: Deliverable[]; empty?: ReactNode }) {
  if (!items.length && !empty) return null;
  return (
    <Panel title={title} actions={<span className="text-xs text-muted tabular">{items.length}</span>} bodyClassName="p-0">
      {items.length ? <ul>{items.map((d) => <DeliverableRow key={d.id} d={d} />)}</ul> : empty}
    </Panel>
  );
}

export function DeliverablesPage() {
  const { pid, caps } = useWorkspace();
  const q = useDeliverables(pid);
  const [create, setCreate] = useState(false);
  const list = q.data ?? [];
  const by = (...s: Deliverable['status'][]) => list.filter((d) => s.includes(d.status));
  return (
    <div>
      <PageHeader
        title="Deliverables"
        description={caps.staff ? 'Work shared with the client for review, approval and handover.' : 'Work from your RIXZA team that needs your review, and everything delivered so far.'}
        actions={caps.manage && <Button variant="primary" size="sm" icon={<Plus className="size-3.5" />} onClick={() => setCreate(true)}>New deliverable</Button>}
      />
      {q.isLoading ? (
        <div className="flex flex-col gap-4"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : list.length === 0 ? (
        <Panel><EmptyState icon={<PackageOpen />} title="No deliverables yet" description={caps.staff ? 'Create a deliverable to share work with the client.' : 'When your team shares work for review, it will appear here.'} action={caps.manage && <Button variant="primary" onClick={() => setCreate(true)}>New deliverable</Button>} /></Panel>
      ) : (
        <div className="flex flex-col gap-6">
          <Group
            title={caps.staff ? 'Awaiting client review' : 'Awaiting your review'}
            items={by('submitted', 'awaiting_feedback')}
            empty={<EmptyState compact icon={<CheckCircle2 />} title="You’re all caught up." description={caps.staff ? 'Nothing is waiting on the client.' : 'There are no deliverables waiting for your review.'} />}
          />
          <Group title="Changes requested" items={by('changes_requested')} />
          {caps.staff && <Group title={<span className="flex items-center gap-1.5"><Lock className="size-3 text-muted" />Drafts (internal)</span>} items={by('draft')} />}
          <Group title={<span className="flex items-center gap-1.5"><Flag className="size-3.5 text-muted" />Approved & delivered</span>} items={by('approved', 'finalized')} />
        </div>
      )}
      <DeliverableModal open={create} onClose={() => setCreate(false)} />
    </div>
  );
}
