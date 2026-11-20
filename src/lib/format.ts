import { differenceInCalendarDays, format, formatDistanceToNowStrict, isToday, isTomorrow, isYesterday, parseISO } from 'date-fns';

const toDate = (d: string) => (d.length === 10 ? parseISO(`${d}T00:00:00`) : new Date(d));

export const fmtDate = (d?: string | null, withYear = true) => (d ? format(toDate(d), withYear ? 'd MMM yyyy' : 'd MMM') : '—');
export const fmtDateShort = (d?: string | null) => (d ? format(toDate(d), 'd MMM') : '—');
export const fmtTime = (d: string) => format(new Date(d), 'HH:mm');
export const fmtDateTime = (d?: string | null) => (d ? format(new Date(d), "d MMM yyyy 'at' HH:mm") : '—');

export function fmtRelative(iso: string) {
  const d = new Date(iso);
  const mins = (Date.now() - d.getTime()) / 60000;
  if (mins < 1) return 'just now';
  if (mins < 60) return `${Math.floor(mins)}m ago`;
  if (isToday(d)) return `${Math.floor(mins / 60)}h ago`;
  if (isYesterday(d)) return `Yesterday, ${format(d, 'HH:mm')}`;
  if (mins < 60 * 24 * 7) return formatDistanceToNowStrict(d, { addSuffix: true });
  return format(d, 'd MMM yyyy');
}

export function dueInfo(d?: string | null): { label: string; tone: 'neutral' | 'warning' | 'danger' } | null {
  if (!d) return null;
  const date = toDate(d);
  const diff = differenceInCalendarDays(date, new Date());
  if (diff < 0) return { label: `Overdue by ${-diff} day${diff === -1 ? '' : 's'}`, tone: 'danger' };
  if (diff === 0) return { label: 'Due today', tone: 'warning' };
  if (isTomorrow(date)) return { label: 'Due tomorrow', tone: 'warning' };
  if (diff <= 7) return { label: `Due in ${diff} days`, tone: 'neutral' };
  return { label: `Due ${format(date, 'd MMM')}`, tone: 'neutral' };
}

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const initials = (name?: string | null) =>
  (name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

export function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export const firstName = (name?: string | null) => (name ?? '').split(' ')[0];

export const plural = (n: number, word: string, pluralWord = `${word}s`) => `${n} ${n === 1 ? word : pluralWord}`;
