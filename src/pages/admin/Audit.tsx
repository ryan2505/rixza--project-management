import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, qs } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { VisibilityBadge } from '../../components/status';
import { activityLink } from '../../components/Activity';
import { Button, ErrorState, PageHeader, Skeleton } from '../../components/ui';
import type { Activity } from '../../../shared/domain';

type Row = Activity & { project_name: string | null };

export function AuditPage() {
  const q = useInfiniteQuery({
    queryKey: ['admin', 'audit'],
    queryFn: ({ pageParam }) => api.get<Row[]>(`/admin/audit${qs({ before: pageParam })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.length === 50 ? last[last.length - 1].created_at : undefined),
  });
  const rows = q.data?.pages.flat() ?? [];
  return (
    <div>
      <PageHeader title="Audit log" description="A traceable record of every important change across the platform." />
      {q.isLoading ? <Skeleton className="h-96" /> : q.error ? <ErrorState error={q.error} /> : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[760px] text-13">
            <thead>
              <tr className="border-b border-line bg-canvas text-left text-2xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2 font-medium">When</th><th className="px-4 py-2 font-medium">Who</th><th className="px-4 py-2 font-medium">Event</th><th className="px-4 py-2 font-medium">Project</th><th className="px-4 py-2 font-medium">Audience</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const link = a.project_id ? activityLink(a) : null;
                return (
                  <tr key={a.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5 text-xs whitespace-nowrap text-muted tabular">{fmtDateTime(a.created_at)}</td>
                    <td className="px-4 py-2.5 text-xs">{a.actor_name ?? 'System'}</td>
                    <td className="px-4 py-2.5">{link ? <Link to={`/admin/p/${a.project_id}/${link}`} className="hover:underline">{a.summary}</Link> : a.summary}<div className="font-mono text-2xs text-subtle">{a.action}</div></td>
                    <td className="px-4 py-2.5 text-xs text-muted">{a.project_name ?? '—'}</td>
                    <td className="px-4 py-2.5"><VisibilityBadge visibility={a.visibility} compact /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {q.hasNextPage && <div className="border-t border-line p-3 text-center"><Button size="sm" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>Load more</Button></div>}
        </div>
      )}
    </div>
  );
}
