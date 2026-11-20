import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BellOff, CalendarClock, CheckCheck, CheckCircle2, Flag, MessageSquare, PackageCheck, PlayCircle, RotateCcw, UserPlus } from 'lucide-react';
import { api } from '../lib/api';
import { useAction, useNotifications, useUnreadCount } from '../lib/queries';
import { useNotificationHref } from '../lib/workspace';
import { fmtDateTime, fmtRelative } from '../lib/format';
import { Button, EmptyState, ErrorState, PageHeader, Segmented, Skeleton, cx } from '../components/ui';
import type { Notification } from '../../shared/domain';

function icon(type: string) {
  if (type.startsWith('comment')) return <MessageSquare />;
  if (type.includes('approved') || type.includes('completed') || type === 'deliverable.finalized') return <CheckCircle2 />;
  if (type.startsWith('revision') || type.includes('changes')) return <RotateCcw />;
  if (type.startsWith('deliverable') || type.startsWith('approval')) return <PackageCheck />;
  if (type.startsWith('milestone')) return <Flag />;
  if (type.startsWith('deadline') || type.startsWith('event')) return <CalendarClock />;
  if (type.startsWith('phase')) return <PlayCircle />;
  if (type.includes('assigned')) return <UserPlus />;
  return <Bell />;
}

function groupLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const diff = Math.floor((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 864e5);
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : diff < 7 ? 'This week' : 'Earlier';
}

export function NotificationsPage() {
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const q = useNotifications(filter === 'unread');
  const unread = useUnreadCount().data?.unread ?? 0;
  const href = useNotificationHref();
  const navigate = useNavigate();
  const markRead = useAction((id: string) => api.post(`/notifications/${id}/read`));
  const markAll = useAction(() => api.post('/notifications/read-all'), { success: 'All notifications marked as read' });

  const groups = new Map<string, Notification[]>();
  q.data?.forEach((n) => groups.set(groupLabel(n.created_at), [...(groups.get(groupLabel(n.created_at)) ?? []), n]));

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Notifications"
        description="Meaningful updates about your projects — never noise."
        actions={
          <>
            <Segmented value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'unread', label: `Unread${unread ? ` · ${unread}` : ''}` }]} />
            <Button size="sm" icon={<CheckCheck className="size-3.5" />} disabled={!unread} onClick={() => markAll.mutate()}>Mark all read</Button>
          </>
        }
      />
      {q.isLoading ? (
        <Skeleton className="h-64" />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <div className="rounded-lg border border-line bg-surface">
          <EmptyState icon={<BellOff />} title={filter === 'unread' ? 'You’re all caught up.' : 'No notifications yet'} description="We’ll let you know when something needs your attention or a milestone is reached." />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {[...groups.entries()].map(([label, items]) => (
            <section key={label}>
              <h2 className="mb-2 px-1 text-2xs font-medium uppercase tracking-[0.08em] text-subtle">{label}</h2>
              <ul className="overflow-hidden rounded-lg border border-line bg-surface">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      onClick={() => {
                        if (!n.read_at) markRead.mutate(n.id);
                        navigate(href(n));
                      }}
                      className={cx('flex w-full gap-3 border-b border-line px-4 py-3.5 text-left last:border-0 hover:bg-hover', !n.read_at && 'bg-brand-50/40')}
                    >
                      <span className={cx('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md [&>svg]:size-3.5', n.read_at ? 'bg-hover text-muted' : 'bg-brand text-white')}>{icon(n.type)}</span>
                      <span className="min-w-0 flex-1">
                        <span className={cx('block text-13', n.read_at ? 'text-ink-2' : 'font-medium text-ink')}>{n.title}</span>
                        {n.body && <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{n.body}</span>}
                        <span className="mt-1 block text-2xs text-subtle" title={fmtDateTime(n.created_at)}>
                          {n.project_name ? `${n.project_name} · ` : ''}{fmtRelative(n.created_at)}
                        </span>
                      </span>
                      {!n.read_at && <span className="mt-2 size-2 shrink-0 rounded-full bg-brand" aria-label="Unread" />}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
