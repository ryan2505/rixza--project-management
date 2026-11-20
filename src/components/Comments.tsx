import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { AtSign, CornerDownRight, Lock, Paperclip, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAction, useMe, usePeople } from '../lib/queries';
import { useWorkspace } from '../lib/workspace';
import { fmtDateTime, fmtRelative } from '../lib/format';
import { FileChip } from './files';
import { Avatar, Badge, Button, Menu, MenuItem, Textarea, cx, useConfirm, useToast } from './ui';
import { isClientRole, type Comment, type FileItem, type Visibility } from '../../shared/domain';

function renderBody(body: string, names: string[]): ReactNode {
  if (!names.length || !body.includes('@')) return body;
  const pattern = new RegExp(`(@(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))`, 'g');
  return body.split(pattern).map((part, i) =>
    part.startsWith('@') && names.includes(part.slice(1)) ? (
      <span key={i} className="rounded-sm bg-brand-50 px-0.5 font-medium text-brand">{part}</span>
    ) : (
      part
    ),
  );
}

export function Composer({
  target,
  targetId,
  visibility,
  parentId,
  onDone,
  placeholder = 'Write a comment…',
  autoFocus,
  compact,
}: {
  target: 'task' | 'thread' | 'deliverable';
  targetId: string;
  visibility: Visibility;
  parentId?: string;
  onDone?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  compact?: boolean;
}) {
  const { pid, caps } = useWorkspace();
  const people = usePeople(pid).data;
  const toast = useToast();
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mentionable = [...(people?.team ?? []), ...(visibility === 'client' ? (people?.client ?? []) : [])];

  const send = useAction(
    () => api.post(`/projects/${pid}/comments`, { target, target_id: targetId, body, visibility, parent_id: parentId, file_ids: files.map((f) => f.id) }),
    {
      onSuccess: () => {
        setBody('');
        setFiles([]);
        onDone?.();
      },
    },
  );

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    const fd = new FormData();
    Array.from(list).forEach((f) => fd.append('files', f));
    setUploading(true);
    try {
      const stored = await api.post<FileItem[]>(`/projects/${pid}/attachments`, fd);
      setFiles((f) => [...f, ...stored]);
    } catch (e) {
      toast.error(e as Error);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const insertMention = (name: string) => {
    const el = ref.current;
    const pos = el?.selectionStart ?? body.length;
    const next = `${body.slice(0, pos)}${body.slice(0, pos).endsWith(' ') || pos === 0 ? '' : ' '}@${name} ${body.slice(pos)}`;
    setBody(next);
    requestAnimationFrame(() => el?.focus());
  };

  const onKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && body.trim()) send.mutate();
  };

  const internal = visibility === 'internal';
  return (
    <div className={cx('rounded-lg border bg-surface transition-colors focus-within:border-brand/50', internal ? 'border-warning/30 bg-warning-bg/30' : 'border-line')}>
      <Textarea
        ref={ref}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={onKey}
        placeholder={internal ? 'Add an internal note — never visible to the client…' : placeholder}
        rows={compact ? 2 : 3}
        autoFocus={autoFocus}
        className="min-h-0 border-0 bg-transparent shadow-none hover:border-0 focus:ring-0"
        aria-label="Comment"
      />
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-2.5 pb-2">
          {files.map((f) => (
            <span key={f.id} className="inline-flex items-center gap-1 rounded-sm bg-hover py-0.5 pr-0.5 pl-1.5 text-xs">
              {f.name}
              <button aria-label={`Remove ${f.name}`} className="rounded-sm p-0.5 hover:bg-line" onClick={() => setFiles(files.filter((x) => x.id !== f.id))}><X className="size-3" /></button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1 border-t border-line/70 px-1.5 py-1.5">
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => upload(e.target.files)} />
        <Button size="xs" variant="ghost" loading={uploading} icon={<Paperclip className="size-3.5" />} onClick={() => fileRef.current?.click()}>
          <span className="hidden sm:inline">Attach</span>
        </Button>
        {mentionable.length > 0 && (
          <Menu align="left" trigger={({ toggle }) => <Button size="xs" variant="ghost" icon={<AtSign className="size-3.5" />} onClick={toggle}><span className="hidden sm:inline">Mention</span></Button>}>
            {(close) =>
              mentionable.map((p) => (
                <MenuItem key={p.id} onClick={() => (close(), insertMention(p.name))}>
                  <Avatar name={p.name} role={p.role} size={18} />
                  <span className="truncate">{p.name}</span>
                  <span className="ml-auto text-2xs text-muted">{isClientRole(p.role) ? 'Client' : 'RIXZA'}</span>
                </MenuItem>
              ))
            }
          </Menu>
        )}
        <span className="ml-auto flex items-center gap-2">
          {caps.staff && (internal ? <Badge tone="warning"><Lock className="size-2.5" /> Internal note</Badge> : <Badge tone="brand">Visible to client</Badge>)}
          {onDone && parentId && <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>}
          <Button size="sm" variant={internal ? 'dark' : 'primary'} disabled={!body.trim() || uploading} loading={send.isPending} onClick={() => send.mutate()} title="Send (Ctrl+Enter)">
            {parentId ? 'Reply' : internal ? 'Add note' : 'Send'}
          </Button>
        </span>
      </div>
    </div>
  );
}

function CommentItem({ c, replies, target, targetId, names }: { c: Comment; replies: Comment[]; target: 'task' | 'thread' | 'deliverable'; targetId: string; names: string[] }) {
  const me = useMe().data!.user!;
  const confirm = useConfirm();
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.body);
  const edit = useAction(() => api.patch(`/comments/${c.id}`, { body: draft }), { onSuccess: () => setEditing(false) });
  const del = useAction(() => api.del(`/comments/${c.id}`), { success: 'Comment deleted' });
  const own = c.author_id === me.id;
  const client = isClientRole(c.author_role);
  return (
    <li className="flex gap-3">
      <Avatar name={c.author_name} role={c.author_role} size={28} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-13 font-medium">{c.author_name}</span>
          <span className={cx('text-2xs font-medium', client ? 'text-brand' : 'text-muted')}>{client ? 'Client' : 'RIXZA'}</span>
          <time className="text-xs text-muted" title={fmtDateTime(c.created_at)}>{fmtRelative(c.created_at)}</time>
          {c.edited_at && !c.deleted_at && <span className="text-xs text-subtle">· edited</span>}
          {c.visibility === 'internal' && <Badge tone="warning"><Lock className="size-2.5" /> Internal</Badge>}
        </div>
        {c.deleted_at ? (
          <p className="mt-1 text-13 italic text-subtle">This comment was deleted.</p>
        ) : editing ? (
          <div className="mt-1.5 flex flex-col gap-2">
            <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} autoFocus />
            <div className="flex gap-2">
              <Button size="sm" variant="primary" loading={edit.isPending} disabled={!draft.trim()} onClick={() => edit.mutate()}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => (setEditing(false), setDraft(c.body))}>Cancel</Button>
            </div>
          </div>
        ) : (
          <p className="prose-comment mt-1 text-13 leading-5 text-ink-2">{renderBody(c.body, names)}</p>
        )}
        {c.files.length > 0 && (
          <div className="mt-2 grid max-w-md gap-1.5">{c.files.map((f) => <FileChip key={f.id} file={f} />)}</div>
        )}
        {!c.deleted_at && !editing && (
          <div className="mt-1 flex gap-3 text-xs font-medium text-muted">
            {!c.parent_id && <button className="hover:text-ink" onClick={() => setReplying((r) => !r)}>Reply</button>}
            {own && <button className="hover:text-ink" onClick={() => setEditing(true)}>Edit</button>}
            {(own || ['super_admin', 'admin'].includes(me.role)) && (
              <button className="hover:text-danger" onClick={async () => (await confirm({ title: 'Delete this comment?', description: 'This cannot be undone. The deletion is recorded in the project audit log.', confirmLabel: 'Delete', danger: true })) && del.mutate()}>Delete</button>
            )}
          </div>
        )}
        {(replies.length > 0 || replying) && (
          <ul className="mt-3 flex flex-col gap-3 border-l border-line pl-4">
            {replies.map((r) => <CommentItem key={r.id} c={r} replies={[]} target={target} targetId={targetId} names={names} />)}
            {replying && (
              <li className="flex gap-2">
                <CornerDownRight className="mt-2 size-3.5 shrink-0 text-subtle" />
                <div className="flex-1">
                  <Composer target={target} targetId={targetId} visibility={c.visibility} parentId={c.id} onDone={() => setReplying(false)} placeholder="Write a reply…" autoFocus compact />
                </div>
              </li>
            )}
          </ul>
        )}
      </div>
    </li>
  );
}

export function CommentList({ comments, target, targetId, empty }: { comments: Comment[]; target: 'task' | 'thread' | 'deliverable'; targetId: string; empty?: ReactNode }) {
  const { pid } = useWorkspace();
  const people = usePeople(pid).data;
  const names = [...(people?.team ?? []), ...(people?.client ?? [])].map((p) => p.name);
  const top = comments.filter((c) => !c.parent_id || !comments.some((p) => p.id === c.parent_id));
  if (!top.length) return <>{empty ?? null}</>;
  return (
    <ul className="flex flex-col gap-5">
      {top.map((c) => (
        <CommentItem key={c.id} c={c} replies={comments.filter((r) => r.parent_id === c.id)} target={target} targetId={targetId} names={names} />
      ))}
    </ul>
  );
}
