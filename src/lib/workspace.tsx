import { createContext, useContext, type ReactNode } from 'react';
import type { Notification, ProjectDetail } from '../../shared/domain';
import { useMe } from './queries';

interface Workspace {
  pid: string;
  /** "/p/:pid" for clients, "/admin/p/:pid" for RIXZA staff */
  base: string;
  detail: ProjectDetail;
}

const Ctx = createContext<Workspace | null>(null);
export const WorkspaceProvider = ({ value, children }: { value: Workspace; children: ReactNode }) => <Ctx.Provider value={value}>{children}</Ctx.Provider>;

export function useWorkspace() {
  const ws = useContext(Ctx);
  if (!ws) throw new Error('useWorkspace must be used inside a project workspace');
  return { ...ws, caps: ws.detail.caps, project: ws.detail.project, to: (path: string) => `${ws.base}/${path}` };
}
export const useOptionalWorkspace = () => useContext(Ctx);

/** Notification links are stored project-relative; resolve them for the current workspace. */
export function useNotificationHref() {
  const me = useMe().data;
  const prefix = me?.user?.client_id ? '' : '/admin';
  return (n: Pick<Notification, 'project_id' | 'link'>) =>
    n.project_id ? `${prefix}/p/${n.project_id}/${n.link ?? 'overview'}` : `${prefix || ''}/notifications`;
}
