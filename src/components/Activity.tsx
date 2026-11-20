import { Link } from 'react-router-dom';
import { CheckCircle2, CircleDot, FileUp, Flag, MessageSquare, PackageCheck, Pencil, PlayCircle, RotateCcw, CalendarClock, Plus } from 'lucide-react';
import { fmtRelative, fmtDateTime } from '../lib/format';
import { cx } from './ui';
import { VisibilityBadge } from './status';
import type { Activity } from '../../shared/domain';

function iconFor(action: string) {
  if (action.includes('approved') || action.endsWith('completed') || action === 'deliverable.finalized') return <CheckCircle2 />;
  if (action.includes('changes_requested') || action.includes('reopened')) return <RotateCcw />;
  if (action.startsWith('comment') || action.startsWith('thread')) return <MessageSquare />;
  if (action.startsWith('file')) return <FileUp />;
  if (action.startsWith('deliverable')) return <PackageCheck />;
  if (action.startsWith('milestone')) return <Flag />;
  if (action.includes('started')) return <PlayCircle />;
  if (action.includes('rescheduled') || action.startsWith('event')) return <CalendarClock />;
  if (action.includes('created')) return <Plus />;
  if (action.includes('status')) return <CircleDot />;
  return <Pencil />;
}

export function activityLink(a: Activity): string | null {
  if (!a.entity_id) return null;
  switch (a.entity_type) {
    case 'task':
      return `board?task=${a.entity_id}`;
    case 'deliverable':
      return `deliverables/${a.entity_id}`;
    case 'thread':
      return `discussions/${a.entity_id}`;
    case 'phase':
      return `project#${a.entity_id}`;
    case 'milestone':
      return 'project';
    case 'file':
      return 'files';
    case 'event':
      return 'calendar';
    default:
      return null;
  }
}

export function ActivityTimeline({ items, base, showVisibility }: { items: Activity[]; base: string; showVisibility?: boolean }) {
  return (
    <ol className="relative">
      {items.map((a, i) => {
        const link = activityLink(a);
        const important = /approved|completed|submitted|started|changes_requested/.test(a.action);
        return (
          <li key={a.id} className="relative flex gap-3 pb-4 last:pb-0">
            {i < items.length - 1 && <span className="absolute left-[11px] top-6 bottom-0 w-px bg-line" aria-hidden />}
            <span className={cx('relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border bg-surface [&>svg]:size-3', important ? 'border-brand/30 text-brand' : 'border-line text-muted')}>
              {iconFor(a.action)}
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-13 leading-5 text-ink">
                {link ? (
                  <Link to={`${base}/${link}`} className="hover:underline decoration-line-strong underline-offset-2">{a.summary}</Link>
                ) : (
                  a.summary
                )}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
                {a.actor_name && <span>{a.actor_name}</span>}
                {a.actor_name && <span aria-hidden>·</span>}
                <time dateTime={a.created_at} title={fmtDateTime(a.created_at)}>{fmtRelative(a.created_at)}</time>
                {showVisibility && a.visibility === 'internal' && <VisibilityBadge visibility="internal" />}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
