import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Mail } from 'lucide-react';
import { api } from '../../lib/api';
import { fmtDateTime, fmtRelative } from '../../lib/format';
import { EmptyState, ErrorState, PageHeader, Panel, Skeleton, cx } from '../../components/ui';

interface Email { id: string; to_email: string; subject: string; body: string; created_at: string }

/** Linkify only URLs that point back at this portal. */
function Body({ text }: { text: string }) {
  return (
    <>
      {text.split(/(https?:\/\/\S+)/g).map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part.replace(/^https?:\/\/[^/]+/, '')} className="break-all text-brand underline">{part}</a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export function OutboxPage() {
  const q = useQuery({ queryKey: ['admin', 'outbox'], queryFn: () => api.get<Email[]>('/admin/outbox'), refetchInterval: 10_000 });
  const [sel, setSel] = useState<string | null>(null);
  const current = q.data?.find((e) => e.id === sel) ?? q.data?.[0];
  return (
    <div>
      <PageHeader title="Email outbox" description="Every email the portal sends — invitations, password resets and notifications. Connect an email provider in server/lib/notify.ts to deliver them." />
      {q.isLoading ? <Skeleton className="h-96" /> : q.error ? <ErrorState error={q.error} /> : !q.data?.length ? (
        <Panel><EmptyState icon={<Mail />} title="No emails yet" /></Panel>
      ) : (
        <div className="grid overflow-hidden rounded-lg border border-line bg-surface lg:grid-cols-[360px_minmax(0,1fr)]">
          <ul className="max-h-[640px] overflow-y-auto border-line scrollbar-thin lg:border-r">
            {q.data.map((e) => (
              <li key={e.id}>
                <button onClick={() => setSel(e.id)} className={cx('block w-full border-b border-line px-4 py-3 text-left hover:bg-hover', current?.id === e.id && 'bg-brand-50/60')}>
                  <span className="flex justify-between gap-2"><span className="truncate text-xs text-muted">{e.to_email}</span><span className="shrink-0 text-2xs text-subtle">{fmtRelative(e.created_at)}</span></span>
                  <span className="mt-0.5 block truncate text-13 font-medium">{e.subject}</span>
                </button>
              </li>
            ))}
          </ul>
          {current && (
            <article className="p-6">
              <h2 className="text-sm font-semibold">{current.subject}</h2>
              <p className="mt-1 text-xs text-muted">To {current.to_email} · {fmtDateTime(current.created_at)}</p>
              <div className="prose-comment mt-5 rounded-lg border border-line bg-canvas p-5 text-13 leading-6 text-ink-2"><Body text={current.body} /></div>
            </article>
          )}
        </div>
      )}
    </div>
  );
}
