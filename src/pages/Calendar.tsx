import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { addDays, addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, isToday, parseISO, startOfMonth, startOfWeek } from 'date-fns';
import { ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, Clock, HandHelping, Pencil, Plus, Trash2, User } from 'lucide-react';
import { api } from '../lib/api';
import { useAction, useCalendar, usePeople } from '../lib/queries';
import { useWorkspace } from '../lib/workspace';
import { fmtDate } from '../lib/format';
import { VisibilityBadge } from '../components/status';
import { Badge, Button, Checkbox, EmptyState, ErrorState, Field, IconButton, Input, KeyValue, Modal, PageHeader, Segmented, Select, Skeleton, Textarea, cx, useConfirm } from '../components/ui';
import { EVENT_TYPES, EVENT_TYPE_LABEL, type CalendarEvent, type CalendarItem, type EventType, type Visibility } from '../../shared/domain';

type View = 'month' | 'week' | 'agenda';
const dayKey = (d: Date) => format(d, 'yyyy-MM-dd');
const itemDay = (i: CalendarItem) => (i.all_day || i.starts_at.length === 10 ? i.starts_at.slice(0, 10) : dayKey(new Date(i.starts_at)));
const itemEndDay = (i: CalendarItem) => (i.ends_at ? (i.all_day ? i.ends_at.slice(0, 10) : dayKey(new Date(i.ends_at))) : itemDay(i));
const timeLabel = (i: CalendarItem) => (i.all_day || i.starts_at.length === 10 ? 'All day' : `${format(new Date(i.starts_at), 'HH:mm')}${i.ends_at ? `–${format(new Date(i.ends_at), 'HH:mm')}` : ''}`);

function chipClass(i: CalendarItem) {
  if (i.status === 'completed' || i.status === 'cancelled') return 'bg-transparent text-subtle line-through decoration-line-strong';
  if (i.status === 'overdue') return 'bg-danger-bg text-danger';
  if (i.important) return 'bg-brand text-white';
  if (i.type === 'meeting') return 'bg-ink/[0.06] text-ink';
  return 'bg-hover text-ink-2';
}

function EventChip({ item, onOpen, showTime = true }: { item: CalendarItem; onOpen: () => void; showTime?: boolean }) {
  return (
    <button
      onClick={(e) => (e.stopPropagation(), onOpen())}
      className={cx('flex w-full items-center gap-1 truncate rounded-sm px-1.5 py-0.5 text-left text-2xs font-medium transition-opacity hover:opacity-80', chipClass(item), item.visibility === 'internal' && 'outline outline-1 outline-dashed outline-line-strong')}
      title={item.title}
    >
      {showTime && !item.all_day && item.starts_at.length > 10 && <span className="tabular opacity-70">{format(new Date(item.starts_at), 'HH:mm')}</span>}
      <span className="truncate">{item.title}</span>
    </button>
  );
}

function EventFormModal({ open, onClose, event, defaultDate }: { open: boolean; onClose: () => void; event?: CalendarEvent | null; defaultDate?: string }) {
  const { pid } = useWorkspace();
  const people = usePeople(pid).data;
  const toLocal = (iso: string) => format(new Date(iso), "yyyy-MM-dd'T'HH:mm");
  const init = () => ({
    title: event?.title ?? '',
    description: event?.description ?? '',
    type: (event?.type ?? 'meeting') as EventType,
    all_day: event ? !!event.all_day : false,
    date: event ? event.starts_at.slice(0, 10) : (defaultDate ?? dayKey(new Date())),
    start: event && !event.all_day ? toLocal(event.starts_at) : `${defaultDate ?? dayKey(new Date())}T10:00`,
    end: event?.ends_at && !event.all_day ? toLocal(event.ends_at) : `${defaultDate ?? dayKey(new Date())}T11:00`,
    status: event?.status ?? 'scheduled',
    visibility: (event?.visibility ?? 'client') as Visibility,
    client_expectation: event?.client_expectation ?? '',
    participant_ids: event?.participant_ids ?? [],
  });
  const [f, setF] = useState(init);
  useEffect(() => {
    if (open) setF(init());
  }, [open, event?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useAction(
    () => {
      const body = {
        title: f.title,
        description: f.description || null,
        type: f.type,
        all_day: f.all_day,
        starts_at: f.all_day ? f.date : new Date(f.start).toISOString(),
        ends_at: f.all_day ? null : new Date(f.end).toISOString(),
        status: f.status,
        visibility: f.visibility,
        client_expectation: f.client_expectation || null,
        participant_ids: f.participant_ids,
      };
      return event ? api.patch(`/events/${event.id}`, body) : api.post(`/projects/${pid}/events`, body);
    },
    { success: event ? 'Event updated — the client has been notified of any date change.' : 'Event scheduled', onSuccess: onClose },
  );
  const everyone = [...(people?.team ?? []), ...(people?.client ?? [])];
  return (
    <Modal open={open} onClose={onClose} title={event ? 'Edit event' : 'New event'} size="lg"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.title.trim()} onClick={() => save.mutate()}>{event ? 'Save changes' : 'Create event'}</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type">
            <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as EventType })}>
              {EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_TYPE_LABEL[t]}</option>)}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as any })}>
              <option value="scheduled">Scheduled</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          </Field>
        </div>
        <Checkbox checked={f.all_day} onChange={(v) => setF({ ...f, all_day: v })} label="All-day event" />
        {f.all_day ? (
          <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Starts"><Input type="datetime-local" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
            <Field label="Ends"><Input type="datetime-local" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
          </div>
        )}
        <Field label="Description" optional><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={2} /></Field>
        <Field label="What’s expected from the client" optional hint="Shown prominently to the client on this event.">
          <Input value={f.client_expectation} onChange={(e) => setF({ ...f, client_expectation: e.target.value })} placeholder="e.g. Join the call and bring your feedback" />
        </Field>
        {everyone.length > 0 && (
          <Field label="Participants" optional>
            <div className="flex flex-wrap gap-1.5">
              {everyone.map((p) => {
                const on = f.participant_ids.includes(p.id);
                return (
                  <button key={p.id} type="button" onClick={() => setF({ ...f, participant_ids: on ? f.participant_ids.filter((x) => x !== p.id) : [...f.participant_ids, p.id] })}
                    className={cx('rounded-full border px-2.5 py-1 text-xs', on ? 'border-brand bg-brand-50 text-brand' : 'border-line text-ink-2 hover:border-line-strong')}>
                    {p.name}
                  </button>
                );
              })}
            </div>
          </Field>
        )}
        <Field label="Visibility">
          <Segmented value={f.visibility} onChange={(v) => setF({ ...f, visibility: v })} options={[{ value: 'internal', label: 'Internal only' }, { value: 'client', label: 'Client visible' }]} />
        </Field>
      </div>
    </Modal>
  );
}

function ItemDetail({ item, onClose, onEdit }: { item: CalendarItem | null; onClose: () => void; onEdit: (id: string) => void }) {
  const { base, caps } = useWorkspace();
  const confirm = useConfirm();
  const del = useAction(() => api.del(`/events/${item!.source_id}`), { success: 'Event removed', onSuccess: onClose });
  if (!item) return null;
  const relatedHref = item.related ? (item.related.kind === 'task' ? `${base}/board?task=${item.related.id}` : item.related.kind === 'deliverable' ? `${base}/deliverables/${item.related.id}` : `${base}/project`) : null;
  const sourceHint = { milestone: 'Milestone dates are managed from the roadmap.', deliverable: 'Review deadlines are managed on the deliverable.', task: 'Task due dates are managed on the board.', event: '' }[item.source];
  return (
    <Modal open={!!item} onClose={onClose} title={item.title} description={EVENT_TYPE_LABEL[item.type]}
      footer={
        <>
          {caps.manage && item.source === 'event' && (
            <>
              <Button variant="danger" icon={<Trash2 className="size-3.5" />} onClick={async () => (await confirm({ title: 'Remove this event?', description: item.visibility === 'client' ? 'The client will be notified.' : undefined, danger: true, confirmLabel: 'Remove' })) && del.mutate()}>Remove</Button>
              <Button icon={<Pencil className="size-3.5" />} onClick={() => onEdit(item.source_id)}>Edit</Button>
            </>
          )}
          {relatedHref && <Link to={relatedHref}><Button variant="primary" icon={<ArrowUpRight className="size-3.5" />}>Open {item.related!.kind}</Button></Link>}
        </>
      }>
      <div className="flex flex-col gap-4">
        {item.client_expectation && (
          <div className="flex gap-2.5 rounded-lg border border-brand/25 bg-brand-50 p-3">
            <HandHelping className="mt-0.5 size-4 shrink-0 text-brand" />
            <div>
              <p className="text-xs font-medium text-brand">{caps.staff ? 'Expected from the client' : 'What’s expected from you'}</p>
              <p className="mt-0.5 text-13 text-ink">{item.client_expectation}</p>
            </div>
          </div>
        )}
        <KeyValue
          items={[
            { label: 'Date', value: <span className="flex items-center gap-1.5"><CalendarDays className="size-3.5 text-muted" />{fmtDate(item.starts_at.slice(0, 10))}</span> },
            { label: 'Time', value: <span className="flex items-center gap-1.5"><Clock className="size-3.5 text-muted" />{timeLabel(item)}</span> },
            { label: 'Status', value: <Badge tone={item.status === 'completed' ? 'dark' : item.status === 'overdue' ? 'danger' : item.status === 'cancelled' ? 'muted' : 'brand'}>{item.status[0].toUpperCase() + item.status.slice(1)}</Badge> },
            ...(item.owner_name ? [{ label: 'Responsible', value: <span className="flex items-center gap-1.5"><User className="size-3.5 text-muted" />{item.owner_name}</span> }] : []),
            ...(item.related ? [{ label: 'Related to', value: relatedHref ? <Link to={relatedHref} className="text-brand hover:underline">{item.related.title}</Link> : item.related.title }] : []),
            ...(caps.staff ? [{ label: 'Visibility', value: <VisibilityBadge visibility={item.visibility} /> }] : []),
          ]}
        />
        {item.description && <p className="prose-comment border-t border-line pt-3 text-13 text-ink-2">{item.description}</p>}
        {caps.manage && sourceHint && <p className="text-xs text-muted">{sourceHint}</p>}
      </div>
    </Modal>
  );
}

export function CalendarPage() {
  const { pid, caps } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>(() => (window.innerWidth < 640 ? 'agenda' : 'month'));
  const [cursor, setCursor] = useState(() => (params.get('date') ? parseISO(params.get('date')!) : new Date()));
  const [open, setOpen] = useState<CalendarItem | null>(null);
  const [form, setForm] = useState<{ open: boolean; event?: CalendarEvent | null; date?: string }>({ open: false });

  const range = useMemo(() => {
    if (view === 'week') return { from: startOfWeek(cursor, { weekStartsOn: 1 }), to: endOfWeek(cursor, { weekStartsOn: 1 }) };
    if (view === 'agenda') return { from: startOfMonth(cursor), to: endOfMonth(addMonths(cursor, 2)) };
    return { from: startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 }), to: endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 }) };
  }, [view, cursor]);
  const q = useCalendar(pid, dayKey(range.from), dayKey(range.to));

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarItem[]>();
    for (const it of q.data ?? []) {
      let d = parseISO(itemDay(it));
      const end = parseISO(itemEndDay(it));
      for (let n = 0; d <= end && n < 60; n++, d = addDays(d, 1)) {
        const k = dayKey(d);
        m.set(k, [...(m.get(k) ?? []), it]);
      }
    }
    return m;
  }, [q.data]);

  // Deep link: ?event=<id> opens that event once loaded.
  useEffect(() => {
    const ev = params.get('event');
    if (ev && q.data) {
      const it = q.data.find((i) => i.source_id === ev);
      if (it) setOpen(it);
      const p = new URLSearchParams(params);
      p.delete('event');
      setParams(p, { replace: true });
    }
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const step = (dir: 1 | -1) => setCursor((c) => (view === 'week' ? addWeeks(c, dir) : addMonths(c, dir)));
  const title = view === 'week' ? `${format(range.from, 'd MMM')} – ${format(range.to, 'd MMM yyyy')}` : view === 'agenda' ? `${format(range.from, 'MMM')} – ${format(range.to, 'MMM yyyy')}` : format(cursor, 'MMMM yyyy');

  const editEvent = async (id: string) => {
    const ev = await api.get<CalendarEvent>(`/events/${id}`);
    setOpen(null);
    setForm({ open: true, event: ev });
  };

  return (
    <div>
      <PageHeader
        title="Calendar"
        description="Your project timeline — milestones, deliveries, review deadlines and meetings."
        actions={caps.manage && <Button variant="primary" size="sm" icon={<Plus className="size-3.5" />} onClick={() => setForm({ open: true, event: null, date: dayKey(cursor) })}>New event</Button>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <IconButton label="Previous" onClick={() => step(-1)}><ChevronLeft className="size-4" /></IconButton>
          <IconButton label="Next" onClick={() => step(1)}><ChevronRight className="size-4" /></IconButton>
          <Button size="sm" onClick={() => setCursor(new Date())}>Today</Button>
        </div>
        <h2 className="ml-2 text-sm font-semibold tabular">{title}</h2>
        <span className="flex-1" />
        <Segmented value={view} onChange={setView} options={[{ value: 'month', label: 'Month' }, { value: 'week', label: 'Week' }, { value: 'agenda', label: 'Agenda' }]} />
      </div>
      <div className="mb-3 flex flex-wrap gap-3 text-2xs text-muted">
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-brand" />Needs attention / key date</span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-ink/10" />Meeting</span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-hover ring-1 ring-line" />Other</span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-danger-bg ring-1 ring-danger/30" />Overdue</span>
        {caps.staff && <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm outline outline-1 outline-dashed outline-line-strong" />Internal</span>}
      </div>

      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <Skeleton className="h-[560px]" />
      ) : view === 'agenda' ? (
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          {(q.data ?? []).length === 0 ? (
            <EmptyState icon={<CalendarDays />} title="No upcoming milestones." description="Your project timeline will be updated as work progresses." />
          ) : (
            [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, items]) => (
              <div key={day} className="grid grid-cols-[72px_1fr] border-b border-line last:border-0 sm:grid-cols-[120px_1fr]">
                <div className={cx('border-r border-line px-3 py-3', isToday(parseISO(day)) && 'bg-brand-50')}>
                  <div className={cx('text-xl font-semibold leading-none tabular', isToday(parseISO(day)) ? 'text-brand' : 'text-ink')}>{format(parseISO(day), 'd')}</div>
                  <div className="mt-1 text-2xs uppercase tracking-wide text-muted">{format(parseISO(day), 'EEE · MMM')}</div>
                </div>
                <ul className="divide-y divide-line">
                  {items.map((it) => (
                    <li key={it.key}>
                      <button onClick={() => setOpen(it)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-hover">
                        <span className={cx('h-8 w-1 shrink-0 rounded-full', it.status === 'completed' ? 'bg-line-strong' : it.status === 'overdue' ? 'bg-danger' : it.important ? 'bg-brand' : 'bg-ink/20')} />
                        <span className="min-w-0 flex-1">
                          <span className={cx('block truncate text-13 font-medium', it.status === 'completed' && 'text-muted line-through decoration-line-strong')}>{it.title}</span>
                          <span className="block truncate text-xs text-muted">{EVENT_TYPE_LABEL[it.type]} · {timeLabel(it)}{it.owner_name ? ` · ${it.owner_name}` : ''}</span>
                        </span>
                        {it.client_expectation && it.status === 'scheduled' && !caps.staff && <Badge tone="brand" className="hidden sm:inline-flex">Action for you</Badge>}
                        {caps.staff && it.visibility === 'internal' && <VisibilityBadge visibility="internal" compact />}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <div className="grid grid-cols-7 border-b border-line bg-canvas">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div key={d} className="px-2 py-2 text-2xs font-medium uppercase tracking-wide text-muted">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {eachDayOfInterval({ start: range.from, end: range.to }).map((d) => {
              const items = byDay.get(dayKey(d)) ?? [];
              const inMonth = view === 'week' || isSameMonth(d, cursor);
              const max = view === 'week' ? 12 : 3;
              return (
                <div
                  key={d.toISOString()}
                  onDoubleClick={() => caps.manage && setForm({ open: true, event: null, date: dayKey(d) })}
                  className={cx('flex flex-col gap-0.5 border-r border-b border-line p-1 [&:nth-child(7n)]:border-r-0', view === 'week' ? 'min-h-[360px]' : 'min-h-[104px]', !inMonth && 'bg-canvas')}
                >
                  <div className="mb-0.5 flex justify-end px-0.5">
                    <span className={cx('flex size-6 items-center justify-center rounded-full text-xs tabular', isToday(d) ? 'bg-brand font-semibold text-white' : inMonth ? 'text-ink-2' : 'text-subtle')}>{format(d, 'd')}</span>
                  </div>
                  {items.slice(0, max).map((it) => <EventChip key={it.key + dayKey(d)} item={it} onOpen={() => setOpen(it)} showTime={view === 'week' || isSameDay(parseISO(itemDay(it)), d)} />)}
                  {items.length > max && (
                    <button className="px-1.5 text-left text-2xs font-medium text-muted hover:text-ink" onClick={() => (setCursor(d), setView('week'))}>+{items.length - max} more</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <ItemDetail item={open} onClose={() => setOpen(null)} onEdit={editEvent} />
      <EventFormModal open={form.open} event={form.event} defaultDate={form.date} onClose={() => setForm({ open: false })} />
    </div>
  );
}
