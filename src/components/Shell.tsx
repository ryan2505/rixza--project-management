import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  Building2,
  CalendarDays,
  ChevronsUpDown,
  FolderClosed,
  LayoutDashboard,
  LayoutTemplate,
  LifeBuoy,
  LogOut,
  Mail,
  Menu as MenuIcon,
  MessagesSquare,
  PackageCheck,
  Route,
  Settings,
  SquareKanban,
  Users,
  Briefcase,
  ChevronLeft,
  X,
  ScrollText,
} from 'lucide-react';
import { api } from '../lib/api';
import { useMe, useNotifications, useRealtime, useUnreadCount, useAction } from '../lib/queries';
import { useNotificationHref, useOptionalWorkspace } from '../lib/workspace';
import { fmtRelative } from '../lib/format';
import { Avatar, IconButton, Menu, MenuItem, cx } from './ui';
import { ROLE_LABEL, can, type SessionUser } from '../../shared/domain';

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 select-none">
      <svg viewBox="0 0 32 32" className="size-[22px]" aria-hidden>
        <rect width="32" height="32" rx="6" fill="#0000FF" />
        <path d="M10 23V9h7a4.5 4.5 0 0 1 1 8.9L22 23h-3.4l-3.5-5H13v5z M13 15h3.8a1.8 1.8 0 0 0 0-3.6H13z" fill="#fff" fillRule="evenodd" />
      </svg>
      {!compact && (
        <span className="flex flex-col leading-none">
          <span className="text-[13px] font-bold tracking-[0.14em] text-ink">RIXZA</span>
        </span>
      )}
    </span>
  );
}

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  badge?: number;
  end?: boolean;
}

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  return (
    <ul className="flex flex-col gap-px">
      {items.map((it) => (
        <li key={it.to}>
          <NavLink
            to={it.to}
            end={it.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cx(
                'group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-13 transition-colors [&>svg]:size-4 [&>svg]:shrink-0',
                isActive ? 'bg-brand-50 font-medium text-brand' : 'text-ink-2 hover:bg-hover hover:text-ink [&>svg]:text-muted',
              )
            }
          >
            {it.icon}
            <span className="flex-1 truncate">{it.label}</span>
            {!!it.badge && <span className="rounded-sm bg-brand px-1.5 text-2xs font-semibold leading-4 text-white tabular">{it.badge > 99 ? '99+' : it.badge}</span>}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="mb-1 mt-5 px-2.5 text-2xs font-medium uppercase tracking-[0.08em] text-subtle first:mt-0">{children}</div>;
}

function useLogout() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    await api.post('/auth/logout').catch(() => {});
    qc.clear();
    navigate('/login');
  };
}

function ProjectSwitcher({ base, current }: { base: (pid: string) => string; current?: string }) {
  const me = useMe().data;
  const navigate = useNavigate();
  const projects = me?.projects ?? [];
  const cur = projects.find((p) => p.id === current);
  if (!cur) return null;
  if (projects.length < 2)
    return (
      <div className="rounded-md border border-line px-2.5 py-2">
        <div className="truncate text-13 font-medium text-ink">{cur.name}</div>
        <div className="truncate text-xs text-muted">{cur.company}</div>
      </div>
    );
  return (
    <Menu
      align="left"
      className="w-[216px]"
      trigger={({ toggle }) => (
        <button onClick={toggle} className="flex w-[216px] items-center gap-2 rounded-md border border-line px-2.5 py-2 text-left hover:border-line-strong">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-13 font-medium text-ink">{cur.name}</span>
            <span className="block truncate text-xs text-muted">{cur.company}</span>
          </span>
          <ChevronsUpDown className="size-3.5 text-muted" />
        </button>
      )}
    >
      {(close) =>
        projects.map((p) => (
          <MenuItem key={p.id} onClick={() => (close(), navigate(base(p.id)))}>
            <span className="min-w-0">
              <span className={cx('block truncate', p.id === current && 'font-medium text-brand')}>{p.name}</span>
              <span className="block truncate text-xs text-muted">{p.company}</span>
            </span>
          </MenuItem>
        ))
      }
    </Menu>
  );
}

function UserCard({ user, settingsTo, onNavigate }: { user: SessionUser; settingsTo: string; onNavigate?: () => void }) {
  const logout = useLogout();
  const me = useMe().data;
  const company = user.client_id ? me?.projects[0]?.company : 'RIXZA';
  return (
    <div className="border-t border-line p-3">
      <div className="flex items-center gap-2.5 px-1 pb-2">
        <Avatar name={user.name} role={user.role} size={28} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-13 font-medium text-ink">{user.name}</div>
          <div className="truncate text-xs text-muted">{user.client_id ? company : ROLE_LABEL[user.role]}</div>
        </div>
      </div>
      <NavList items={[{ to: settingsTo, label: 'Account settings', icon: <Settings /> }]} onNavigate={onNavigate} />
      <button onClick={logout} className="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-13 text-ink-2 hover:bg-hover hover:text-ink">
        <LogOut className="size-4 text-muted" /> Log out
      </button>
    </div>
  );
}

function NotificationBell({ allTo }: { allTo: string }) {
  const count = useUnreadCount().data?.unread ?? 0;
  const list = useNotifications(false);
  const href = useNotificationHref();
  const navigate = useNavigate();
  const markRead = useAction((id: string) => api.post(`/notifications/${id}/read`));
  const markAll = useAction(() => api.post('/notifications/read-all'));
  return (
    <Menu
      className="w-[min(360px,calc(100vw-24px))] p-0"
      trigger={({ toggle }) => (
        <IconButton label={`Notifications${count ? ` (${count} unread)` : ''}`} onClick={toggle} className="relative">
          <Bell className="size-4" />
          {count > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-brand ring-2 ring-surface" />}
        </IconButton>
      )}
    >
      {(close) => (
        <div>
          <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
            <span className="text-13 font-semibold">Notifications</span>
            {count > 0 && (
              <button className="text-xs font-medium text-brand hover:underline" onClick={() => markAll.mutate()}>
                Mark all as read
              </button>
            )}
          </div>
          <div className="max-h-[360px] overflow-y-auto scrollbar-thin">
            {(list.data ?? []).slice(0, 8).map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  if (!n.read_at) markRead.mutate(n.id);
                  close();
                  navigate(href(n));
                }}
                className="flex w-full gap-2.5 border-b border-line px-3 py-2.5 text-left last:border-0 hover:bg-hover"
              >
                <span className={cx('mt-1.5 size-1.5 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-brand')} />
                <span className="min-w-0 flex-1">
                  <span className={cx('block text-13', n.read_at ? 'text-ink-2' : 'font-medium text-ink')}>{n.title}</span>
                  <span className="block text-xs text-muted">
                    {n.project_name ? `${n.project_name} · ` : ''}
                    {fmtRelative(n.created_at)}
                  </span>
                </span>
              </button>
            ))}
            {list.data?.length === 0 && <p className="px-3 py-8 text-center text-13 text-muted">You’re all caught up.</p>}
          </div>
          <Link to={allTo} onClick={close} className="block border-t border-line px-3 py-2 text-center text-xs font-medium text-ink-2 hover:bg-hover">
            View all notifications
          </Link>
        </div>
      )}
    </Menu>
  );
}

const TITLES: Record<string, string> = {
  overview: 'Overview',
  project: 'My Project',
  board: 'Board',
  calendar: 'Calendar',
  deliverables: 'Deliverables',
  files: 'Files',
  discussions: 'Discussions',
  notifications: 'Notifications',
  help: 'Help & Support',
  settings: 'Settings',
  clients: 'Clients',
  projects: 'Projects',
  templates: 'Templates',
  team: 'Team',
  outbox: 'Email outbox',
  audit: 'Audit log',
};

function useBreadcrumb(staff: boolean) {
  const loc = useLocation();
  const ws = useOptionalWorkspace();
  const parts = loc.pathname.split('/').filter(Boolean);
  const pIdx = parts.indexOf('p');
  const seg = pIdx >= 0 ? parts[pIdx + 2] : staff ? parts[1] : parts[0];
  const title = TITLES[seg ?? ''] ?? (staff ? 'Overview' : 'Overview');
  return { project: ws?.detail.project.name, client: ws?.detail.client.company, title: seg === 'project' && staff ? 'Roadmap' : title };
}

export function AppShell({ children, staff }: { children: ReactNode; staff: boolean }) {
  const me = useMe().data!;
  const user = me.user!;
  const ws = useOptionalWorkspace();
  const [mobileOpen, setMobileOpen] = useState(false);
  const loc = useLocation();
  const unread = useUnreadCount().data?.unread ?? 0;
  const crumb = useBreadcrumb(staff);
  useRealtime(true);
  useEffect(() => setMobileOpen(false), [loc.pathname]);

  const base = ws?.base ?? (me.projects[0] ? `/p/${me.projects[0].id}` : '');
  const clientNav: NavItem[] = [
    { to: `${base}/overview`, label: 'Overview', icon: <LayoutDashboard /> },
    { to: `${base}/project`, label: 'My Project', icon: <Route /> },
    { to: `${base}/board`, label: 'Board', icon: <SquareKanban /> },
    { to: `${base}/calendar`, label: 'Calendar', icon: <CalendarDays /> },
    { to: `${base}/deliverables`, label: 'Deliverables', icon: <PackageCheck /> },
    { to: `${base}/files`, label: 'Files', icon: <FolderClosed /> },
    { to: `${base}/discussions`, label: 'Discussions', icon: <MessagesSquare /> },
    { to: `${base}/notifications`, label: 'Notifications', icon: <Bell />, badge: unread },
    { to: `${base}/help`, label: 'Help & Support', icon: <LifeBuoy /> },
  ];
  const adminNav: NavItem[] = [
    { to: '/admin', label: 'Overview', icon: <LayoutDashboard />, end: true },
    { to: '/admin/projects', label: 'Projects', icon: <Briefcase /> },
    ...(can(user.role, 'clients.view') ? [{ to: '/admin/clients', label: 'Clients', icon: <Building2 /> }] : []),
    { to: '/admin/templates', label: 'Templates', icon: <LayoutTemplate /> },
    { to: '/admin/team', label: 'Team', icon: <Users /> },
    { to: '/admin/notifications', label: 'Notifications', icon: <Bell />, badge: unread },
    ...(can(user.role, 'outbox.view') ? [{ to: '/admin/outbox', label: 'Email outbox', icon: <Mail /> }] : []),
    ...(can(user.role, 'clients.manage') ? [{ to: '/admin/audit', label: 'Audit log', icon: <ScrollText /> }] : []),
  ];
  const projectNav: NavItem[] = ws
    ? [
        { to: `${ws.base}/overview`, label: 'Overview', icon: <LayoutDashboard /> },
        { to: `${ws.base}/project`, label: 'Roadmap', icon: <Route /> },
        { to: `${ws.base}/board`, label: 'Board', icon: <SquareKanban /> },
        { to: `${ws.base}/calendar`, label: 'Calendar', icon: <CalendarDays /> },
        { to: `${ws.base}/deliverables`, label: 'Deliverables', icon: <PackageCheck /> },
        { to: `${ws.base}/files`, label: 'Files', icon: <FolderClosed /> },
        { to: `${ws.base}/discussions`, label: 'Discussions', icon: <MessagesSquare /> },
        ...(ws.detail.caps.manage ? [{ to: `${ws.base}/settings`, label: 'Project settings', icon: <Settings /> }] : []),
      ]
    : [];

  const sidebar = (onNavigate?: () => void) => (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center justify-between px-4">
        <Link to={staff ? '/admin' : `${base}/overview`} className="flex items-center gap-2">
          <Logo />
          <span className="rounded-sm border border-line px-1.5 text-2xs font-medium text-muted">{staff ? 'Workspace' : 'Client Portal'}</span>
        </Link>
        {onNavigate && (
          <IconButton label="Close menu" onClick={onNavigate}>
            <X className="size-4" />
          </IconButton>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-4 scrollbar-thin">
        {staff ? (
          ws ? (
            <>
              <Link to="/admin/projects" className="mb-3 flex items-center gap-1 px-2.5 text-xs font-medium text-muted hover:text-ink" onClick={onNavigate}>
                <ChevronLeft className="size-3.5" /> All projects
              </Link>
              <div className="mb-3 rounded-md border border-line px-2.5 py-2">
                <div className="truncate text-13 font-medium">{ws.detail.project.name}</div>
                <div className="truncate text-xs text-muted">{ws.detail.client.company}</div>
              </div>
              <NavList items={projectNav} onNavigate={onNavigate} />
              <SectionLabel>Workspace</SectionLabel>
              <NavList items={adminNav} onNavigate={onNavigate} />
            </>
          ) : (
            <NavList items={adminNav} onNavigate={onNavigate} />
          )
        ) : (
          <>
            <div className="mb-3">
              <ProjectSwitcher base={(pid) => `/p/${pid}/overview`} current={ws?.pid} />
            </div>
            <NavList items={clientNav} onNavigate={onNavigate} />
          </>
        )}
      </nav>
      <UserCard user={user} settingsTo={staff ? '/admin/settings' : `${base}/settings`} onNavigate={onNavigate} />
    </div>
  );

  const mobileTabs: NavItem[] = staff
    ? ws
      ? [projectNav[0], projectNav[2], projectNav[3], projectNav[4], { to: '/admin/notifications', label: 'Inbox', icon: <Bell />, badge: unread }]
      : [adminNav[0], adminNav[1], { to: '/admin/notifications', label: 'Inbox', icon: <Bell />, badge: unread }]
    : [clientNav[0], clientNav[2], clientNav[3], clientNav[4], { ...clientNav[7], label: 'Inbox' }];

  return (
    <div className="min-h-dvh bg-canvas">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] border-r border-line bg-surface lg:block">{sidebar()}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink/25 animate-fade-in" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[280px] max-w-[85vw] bg-surface shadow-pop animate-pop-in">{sidebar(() => setMobileOpen(false))}</aside>
        </div>
      )}
      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur-md sm:px-6 lg:px-10">
          <IconButton label="Open menu" className="-ml-1.5 lg:hidden" onClick={() => setMobileOpen(true)}>
            <MenuIcon className="size-4" />
          </IconButton>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-13">
            {crumb.project && (
              <>
                <span className="hidden truncate text-muted sm:inline">{staff ? `${crumb.client} · ${crumb.project}` : crumb.project}</span>
                <span className="hidden text-line-strong sm:inline">/</span>
              </>
            )}
            <span className="truncate font-medium text-ink">{crumb.title}</span>
          </div>
          <div className="flex items-center gap-1">
            <NotificationBell allTo={staff ? '/admin/notifications' : `${base}/notifications`} />
            <Link to={staff ? '/admin/settings' : `${base}/settings`} className="ml-1 rounded-full" aria-label="Your profile">
              <Avatar name={user.name} role={user.role} size={28} />
            </Link>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1280px] px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-16 lg:pt-8">{children}</main>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
        <ul className="grid" style={{ gridTemplateColumns: `repeat(${mobileTabs.length}, minmax(0, 1fr))` }}>
          {mobileTabs.map((t) => (
            <li key={t.to}>
              <NavLink
                to={t.to}
                end={t.end}
                className={({ isActive }) => cx('relative flex h-14 flex-col items-center justify-center gap-1 text-2xs font-medium [&>svg]:size-[18px]', isActive ? 'text-brand' : 'text-muted')}
              >
                {t.icon}
                {t.label}
                {!!t.badge && <span className="absolute top-2 left-1/2 ml-2 size-2 rounded-full bg-brand" />}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
