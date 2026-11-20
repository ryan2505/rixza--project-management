import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Lock, MessagesSquare, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { useAction, useThread, useThreads } from '../lib/queries';
import { useWorkspace } from '../lib/workspace';
import { fmtRelative } from '../lib/format';
import { CommentList, Composer } from '../components/Comments';
import { Badge, Button, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Segmented, Skeleton, Tabs, Textarea, cx } from '../components/ui';
import type { Visibility } from '../../shared/domain';

function NewThreadModal({ open, onClose, defaultVisibility }: { open: boolean; onClose: () => void; defaultVisibility: Visibility }) {
  const { pid, base, caps } = useWorkspace();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<Visibility>(defaultVisibility);
  useEffect(() => {
    if (open) (setTitle(''), setBody(''), setVisibility(defaultVisibility));
  }, [open, defaultVisibility]);
  const create = useAction(() => api.post<{ id: string }>(`/projects/${pid}/threads`, { title, body, visibility }), {
    success: 'Discussion started',
    onSuccess: (r) => (onClose(), navigate(`${base}/discussions/${r.id}`)),
  });
  return (
    <Modal open={open} onClose={onClose} title="New discussion" description={caps.staff ? undefined : 'Your RIXZA project team will be notified.'}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant={visibility === 'internal' ? 'dark' : 'primary'} disabled={!title.trim() || !body.trim()} loading={create.isPending} onClick={() => create.mutate()}>Start discussion</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Subject"><Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="e.g. Photography for the rooms pages" /></Field>
        <Field label="Message"><Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} /></Field>
        {caps.staff && (
          <Field label="Audience" hint={visibility === 'internal' ? 'Only the RIXZA team can see this discussion.' : 'The client can read and reply to this discussion.'}>
            <Segmented value={visibility} onChange={setVisibility} options={[{ value: 'internal', label: 'Internal only', icon: <Lock className="size-3" /> }, { value: 'client', label: 'With the client' }]} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

function ThreadView({ id }: { id: string }) {
  const { base, caps } = useWorkspace();
  const q = useThread(id);
  if (q.isLoading) return <div className="p-6"><Skeleton className="mb-4 h-6 w-1/2" /><Skeleton className="h-40" /></div>;
  if (q.error) return <ErrorState error={q.error} />;
  const { thread, comments } = q.data!;
  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-line px-5 py-4">
        <Link to={`${base}/discussions`} className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-ink lg:hidden"><ArrowLeft className="size-3.5" />All discussions</Link>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">{thread.title}</h2>
          {thread.visibility === 'internal' && <Badge tone="warning"><Lock className="size-2.5" />Internal</Badge>}
        </div>
        <p className="mt-0.5 text-xs text-muted">Started by {thread.creator_name} · {fmtRelative(thread.created_at)}</p>
      </header>
      <div className="flex-1 px-5 py-5">
        <CommentList comments={comments} target="thread" targetId={thread.id} />
      </div>
      <div className="sticky bottom-16 border-t border-line bg-surface p-4 lg:bottom-0">
        <Composer target="thread" targetId={thread.id} visibility={thread.visibility} placeholder={caps.staff ? 'Reply to the client…' : 'Reply to your team…'} />
      </div>
    </div>
  );
}

export function DiscussionsPage() {
  const { tid } = useParams();
  const { pid, base, caps } = useWorkspace();
  const q = useThreads(pid);
  const [tab, setTab] = useState<Visibility>('client');
  const [creating, setCreating] = useState(false);
  const threads = (q.data ?? []).filter((t) => (caps.staff ? t.visibility === tab : true));

  useEffect(() => {
    const cur = q.data?.find((t) => t.id === tid);
    if (cur && caps.staff) setTab(cur.visibility);
  }, [tid, q.data, caps.staff]);

  return (
    <div>
      <PageHeader
        title="Discussions"
        description={caps.staff ? 'Project-wide conversations. Internal discussions are never visible to the client.' : 'Talk with your RIXZA project team about anything not tied to a specific task.'}
        actions={<Button variant="primary" size="sm" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>New discussion</Button>}
      />
      <div className="grid min-h-[560px] overflow-hidden rounded-lg border border-line bg-surface lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className={cx('border-line lg:border-r', tid && 'hidden lg:block')}>
          {caps.staff && (
            <div className="px-4 pt-2">
              <Tabs value={tab} onChange={setTab} tabs={[{ value: 'client', label: 'With client', count: q.data?.filter((t) => t.visibility === 'client').length }, { value: 'internal', label: <span className="flex items-center gap-1"><Lock className="size-3" />Internal</span>, count: q.data?.filter((t) => t.visibility === 'internal').length }]} />
            </div>
          )}
          {q.isLoading ? (
            <div className="p-4"><Skeleton className="h-16" /></div>
          ) : threads.length === 0 ? (
            <EmptyState compact icon={<MessagesSquare />} title={caps.staff && tab === 'internal' ? 'No internal discussions' : 'No discussions yet'} description={caps.staff ? undefined : 'Start a conversation with your RIXZA project team.'} action={<Button size="sm" onClick={() => setCreating(true)}>Start a discussion</Button>} />
          ) : (
            <ul>
              {threads.map((t) => (
                <li key={t.id}>
                  <Link to={`${base}/discussions/${t.id}`} className={cx('block border-b border-line px-4 py-3 hover:bg-hover', t.id === tid && 'bg-brand-50/60 hover:bg-brand-50')}>
                    <div className="flex items-center gap-2">
                      <span className={cx('min-w-0 flex-1 truncate text-13', t.id === tid ? 'font-semibold text-ink' : 'font-medium')}>{t.title}</span>
                      <span className="shrink-0 text-2xs text-muted">{fmtRelative(t.last_activity_at)}</span>
                    </div>
                    {t.last_comment && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{t.last_comment}</p>}
                    <p className="mt-1 text-2xs text-subtle">{t.comment_count} message{t.comment_count === 1 ? '' : 's'} · {t.creator_name}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <section className={cx('min-w-0', !tid && 'hidden lg:block')}>
          {tid ? <ThreadView id={tid} /> : (
            <EmptyState icon={<MessagesSquare />} title="Select a discussion" description={caps.staff ? 'Or start a new one with the client or internally.' : 'Or start a new conversation with your RIXZA project team.'} className="h-full justify-center" />
          )}
        </section>
      </div>
      <NewThreadModal open={creating} onClose={() => setCreating(false)} defaultVisibility={caps.staff ? tab : 'client'} />
    </div>
  );
}
