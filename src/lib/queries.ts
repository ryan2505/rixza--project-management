import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, qs } from './api';
import { useToast } from '../components/ui';
import type {
  Activity,
  CalendarItem,
  Comment,
  Deliverable,
  DeliverableDetail,
  FileItem,
  Milestone,
  Notification,
  Phase,
  ProjectDetail,
  ProjectOverview,
  ProjectSummary,
  SessionUser,
  Task,
  Thread,
  UserSummary,
} from '../../shared/domain';

export interface Me {
  user: SessionUser | null;
  projects: { id: string; name: string; company: string; status: string }[];
}

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/auth/me'), staleTime: 60_000 });

export const useProject = (pid?: string) =>
  useQuery({ queryKey: ['project', pid, 'detail'], queryFn: () => api.get<ProjectDetail>(`/projects/${pid}`), enabled: !!pid });
export const useProjects = () => useQuery({ queryKey: ['projects'], queryFn: () => api.get<ProjectSummary[]>('/projects') });
export const useOverview = (pid: string) =>
  useQuery({ queryKey: ['project', pid, 'overview'], queryFn: () => api.get<ProjectOverview>(`/projects/${pid}/overview`) });

export interface Roadmap {
  phases: Phase[];
  milestones: Milestone[];
  tasks: Pick<Task, 'id' | 'title' | 'status' | 'phase_id' | 'due_date' | 'visibility' | 'client_action' | 'assignee_name'>[];
  deliverables: Pick<Deliverable, 'id' | 'title' | 'status' | 'phase_id' | 'review_due' | 'current_version'>[];
}
export const useRoadmap = (pid: string) =>
  useQuery({ queryKey: ['project', pid, 'roadmap'], queryFn: () => api.get<Roadmap>(`/projects/${pid}/roadmap`) });
export const useTasks = (pid: string) => useQuery({ queryKey: ['project', pid, 'tasks'], queryFn: () => api.get<Task[]>(`/projects/${pid}/tasks`) });

export interface TaskDetail {
  task: Task;
  comments: Comment[];
  files: FileItem[];
  history: Activity[];
  deliverables: { id: string; title: string; status: string; current_version: number }[];
}
export const useTask = (id?: string | null) =>
  useQuery({ queryKey: ['task', id], queryFn: () => api.get<TaskDetail>(`/tasks/${id}`), enabled: !!id, retry: false });

export const useCalendar = (pid: string, from: string, to: string) =>
  useQuery({ queryKey: ['project', pid, 'calendar', from, to], queryFn: () => api.get<CalendarItem[]>(`/projects/${pid}/calendar${qs({ from, to })}`), placeholderData: (p) => p });

export const useDeliverables = (pid: string) =>
  useQuery({ queryKey: ['project', pid, 'deliverables'], queryFn: () => api.get<Deliverable[]>(`/projects/${pid}/deliverables`) });
export const useDeliverable = (id?: string) =>
  useQuery({ queryKey: ['deliverable', id], queryFn: () => api.get<DeliverableDetail & { comments: Comment[] }>(`/deliverables/${id}`), enabled: !!id, retry: false });

export const useThreads = (pid: string) => useQuery({ queryKey: ['project', pid, 'threads'], queryFn: () => api.get<Thread[]>(`/projects/${pid}/threads`) });
export const useThread = (id?: string) =>
  useQuery({ queryKey: ['thread', id], queryFn: () => api.get<{ thread: Thread; comments: Comment[] }>(`/threads/${id}`), enabled: !!id, retry: false });

export const useFiles = (pid: string, category: string, q: string) =>
  useQuery({ queryKey: ['project', pid, 'files', category, q], queryFn: () => api.get<FileItem[]>(`/projects/${pid}/files${qs({ category, q })}`), placeholderData: (p) => p });

export const usePeople = (pid: string) =>
  useQuery({ queryKey: ['project', pid, 'people'], queryFn: () => api.get<{ team: UserSummary[]; client: UserSummary[] }>(`/projects/${pid}/people`), staleTime: 60_000 });

export const useActivity = (pid: string) => useQuery({ queryKey: ['project', pid, 'activity'], queryFn: () => api.get<Activity[]>(`/projects/${pid}/activity`) });

export const useNotifications = (unread: boolean) =>
  useQuery({ queryKey: ['notifications', unread ? 'unread' : 'all'], queryFn: () => api.get<Notification[]>(`/notifications${qs({ unread: unread ? 1 : undefined, limit: 50 })}`) });
export const useUnreadCount = () =>
  useQuery({ queryKey: ['notifications', 'count'], queryFn: () => api.get<{ unread: number }>('/notifications/count'), refetchInterval: 60_000 });

export const useStaffOptions = (enabled = true) =>
  useQuery({ queryKey: ['admin', 'staff-options'], queryFn: () => api.get<UserSummary[]>('/admin/staff-options'), enabled, staleTime: 60_000 });

/** After any write, everything derived from project data is refreshed so all views stay consistent. */
export const invalidateData = (qc: QueryClient) => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' });

export function useAction<TVars = void, TRes = unknown>(fn: (v: TVars) => Promise<TRes>, opts: { success?: string | ((r: TRes) => string); onSuccess?: (r: TRes, v: TVars) => void; refreshMe?: boolean } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, v) => {
      invalidateData(qc);
      if (opts.refreshMe) qc.invalidateQueries({ queryKey: ['me'] });
      if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(r) : opts.success);
      opts.onSuccess?.(r, v);
    },
    onError: (e) => toast.error(e as Error),
  });
}

/** Live updates via Server-Sent Events: refetch whatever is on screen when the project changes. */
export function useRealtime(enabled: boolean) {
  const qc = useQueryClient();
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/stream');
    es.onmessage = (e) => {
      let kind = 'change';
      try {
        kind = JSON.parse(e.data).kind;
      } catch {
        /* ignore */
      }
      if (kind === 'notification') {
        qc.invalidateQueries({ queryKey: ['notifications'] });
        return;
      }
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => invalidateData(qc), 250);
    };
    return () => {
      es.close();
      window.clearTimeout(timer.current);
    };
  }, [enabled, qc]);
}
