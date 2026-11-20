import { useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { FolderOpen } from 'lucide-react';
import { useMe, useProject } from './lib/queries';
import { WorkspaceProvider } from './lib/workspace';
import { ApiError } from './lib/api';
import { AppShell, Logo } from './components/Shell';
import { Button, EmptyState, ErrorState, Skeleton } from './components/ui';
import { AcceptInvitePage, ForgotPasswordPage, LoginPage, ResetPasswordPage } from './pages/Auth';
import { OverviewPage } from './pages/Overview';
import { RoadmapPage } from './pages/Roadmap';
import { BoardPage } from './pages/Board';
import { CalendarPage } from './pages/Calendar';
import { DeliverableDetailPage, DeliverablesPage } from './pages/Deliverables';
import { FilesPage } from './pages/Files';
import { DiscussionsPage } from './pages/Discussions';
import { NotificationsPage } from './pages/Notifications';
import { HelpPage } from './pages/Help';
import { AccountSettingsPage } from './pages/AccountSettings';
import { ProjectSettingsPage } from './pages/ProjectSettings';
import { AdminOverviewPage } from './pages/admin/AdminOverview';
import { ClientDetailPage, ClientsPage } from './pages/admin/Clients';
import { NewProjectPage, ProjectsPage } from './pages/admin/Projects';
import { TemplatesPage } from './pages/admin/Templates';
import { TeamPage } from './pages/admin/Team';
import { OutboxPage } from './pages/admin/Outbox';
import { AuditPage } from './pages/admin/Audit';
import { isStaffRole } from '../shared/domain';

function FullScreenLoader() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Logo />
        <Skeleton className="h-1 w-24" />
      </div>
    </div>
  );
}

function RequireUser({ staff, children }: { staff: boolean; children: ReactNode }) {
  const me = useMe();
  const loc = useLocation();
  const qc = useQueryClient();
  useEffect(() => {
    const h = () => qc.setQueryData(['me'], { user: null, projects: [] });
    window.addEventListener('rixza:unauthorized', h);
    return () => window.removeEventListener('rixza:unauthorized', h);
  }, [qc]);
  if (me.isLoading) return <FullScreenLoader />;
  if (!me.data?.user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  const isStaff = isStaffRole(me.data.user.role);
  if (staff && !isStaff) return <Navigate to="/" replace />;
  if (!staff && isStaff) {
    // RIXZA staff following a client link land on the same item in the admin workspace.
    return <Navigate to={`/admin${loc.pathname}${loc.search}${loc.hash}`} replace />;
  }
  return <>{children}</>;
}

function Home() {
  const me = useMe();
  if (me.isLoading) return <FullScreenLoader />;
  const user = me.data?.user;
  if (!user) return <Navigate to="/login" replace />;
  if (isStaffRole(user.role)) return <Navigate to="/admin" replace />;
  const first = me.data!.projects[0];
  if (first) return <Navigate to={`/p/${first.id}/overview`} replace />;
  return <NoProjectYet />;
}

function NoProjectYet() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6">
      <Logo />
      <EmptyState
        icon={<FolderOpen />}
        title="Your workspace is being prepared"
        description="Your RIXZA project manager is setting up your project. You’ll receive an email as soon as it’s ready."
        action={
          <Button onClick={() => fetch('/api/auth/logout', { method: 'POST', headers: { 'x-requested-with': 'rixza' } }).then(() => (window.location.href = '/login'))}>
            Log out
          </Button>
        }
      />
    </div>
  );
}

/** Redirects /notifications (client, no project in URL) to the first project's inbox. */
function ClientRedirect({ to }: { to: string }) {
  const me = useMe();
  if (me.isLoading) return <FullScreenLoader />;
  const first = me.data?.projects[0];
  return <Navigate to={first ? `/p/${first.id}/${to}` : '/'} replace />;
}

function ProjectWorkspace({ staff }: { staff: boolean }) {
  const { pid } = useParams();
  const project = useProject(pid);
  if (project.isLoading)
    return (
      <AppShell staff={staff}>
        <Skeleton className="mb-3 h-6 w-64" />
        <Skeleton className="mb-8 h-4 w-96 max-w-full" />
        <div className="grid gap-4 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </AppShell>
    );
  if (project.error || !project.data)
    return (
      <AppShell staff={staff}>
        {project.error instanceof ApiError && project.error.status === 404 ? (
          <EmptyState icon={<FolderOpen />} title="Project not found" description="This project doesn’t exist or you don’t have access to it." action={<Button onClick={() => (window.location.href = '/')}>Go to my workspace</Button>} />
        ) : (
          <ErrorState error={project.error} onRetry={() => project.refetch()} />
        )}
      </AppShell>
    );
  const base = staff ? `/admin/p/${pid}` : `/p/${pid}`;
  return (
    <WorkspaceProvider value={{ pid: pid!, base, detail: project.data }}>
      <AppShell staff={staff}>
        <Routes>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<OverviewPage />} />
          <Route path="project" element={<RoadmapPage />} />
          <Route path="board" element={<BoardPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="deliverables" element={<DeliverablesPage />} />
          <Route path="deliverables/:did" element={<DeliverableDetailPage />} />
          <Route path="files" element={<FilesPage />} />
          <Route path="discussions" element={<DiscussionsPage />} />
          <Route path="discussions/:tid" element={<DiscussionsPage />} />
          {staff ? (
            <>
              <Route path="settings" element={<ProjectSettingsPage />} />
              <Route path="notifications" element={<Navigate to="/admin/notifications" replace />} />
            </>
          ) : (
            <>
              <Route path="notifications" element={<NotificationsPage />} />
              <Route path="help" element={<HelpPage />} />
              <Route path="settings" element={<AccountSettingsPage />} />
            </>
          )}
          <Route path="*" element={<Navigate to="overview" replace />} />
        </Routes>
      </AppShell>
    </WorkspaceProvider>
  );
}

function AdminArea() {
  return (
    <Routes>
      <Route path="p/:pid/*" element={<ProjectWorkspace staff />} />
      <Route
        path="*"
        element={
          <AppShell staff>
            <Routes>
              <Route index element={<AdminOverviewPage />} />
              <Route path="projects" element={<ProjectsPage />} />
              <Route path="projects/new" element={<NewProjectPage />} />
              <Route path="clients" element={<ClientsPage />} />
              <Route path="clients/:id" element={<ClientDetailPage />} />
              <Route path="templates" element={<TemplatesPage />} />
              <Route path="team" element={<TeamPage />} />
              <Route path="outbox" element={<OutboxPage />} />
              <Route path="audit" element={<AuditPage />} />
              <Route path="notifications" element={<NotificationsPage />} />
              <Route path="settings" element={<AccountSettingsPage />} />
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Routes>
          </AppShell>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot" element={<ForgotPasswordPage />} />
      <Route path="/reset/:token" element={<ResetPasswordPage />} />
      <Route path="/invite/:token" element={<AcceptInvitePage />} />
      <Route path="/" element={<Home />} />
      <Route
        path="/admin/*"
        element={
          <RequireUser staff>
            <AdminArea />
          </RequireUser>
        }
      />
      <Route
        path="/p/:pid/*"
        element={
          <RequireUser staff={false}>
            <ProjectWorkspace staff={false} />
          </RequireUser>
        }
      />
      <Route path="/notifications" element={<RequireUser staff={false}><ClientRedirect to="notifications" /></RequireUser>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
