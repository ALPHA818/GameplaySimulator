import { Activity, Bot, FileText, Gamepad2, LayoutDashboard, ListFilter, Play, Settings, Siren } from 'lucide-react';
import type { ReactNode } from 'react';
import type { PageId } from '../routes';
import { useConfigStore } from '../store/configStore';

interface AppShellProps {
  children: ReactNode;
}

const navigation: Array<{ page: PageId; label: string; icon: typeof LayoutDashboard }> = [
  { page: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { page: 'gameProfiles', label: 'Game Profiles', icon: Gamepad2 },
  { page: 'botProfiles', label: 'Bot Profiles', icon: Bot },
  { page: 'newSession', label: 'New Session', icon: Play },
  { page: 'liveSession', label: 'Live Session', icon: Activity },
  { page: 'issues', label: 'Issues', icon: Siren },
  { page: 'logs', label: 'Logs', icon: ListFilter },
  { page: 'reports', label: 'Reports', icon: FileText },
  { page: 'settings', label: 'Settings', icon: Settings }
];

export function AppShell({ children }: AppShellProps) {
  const currentPage = useConfigStore((state) => state.currentPage);
  const navigate = useConfigStore((state) => state.navigate);

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar__brand">GameplaySimulator</div>
        <nav className="sidebar__nav" aria-label="Main">
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive = currentPage === item.page;

            return (
              <button
                key={item.page}
                className="nav-button"
                data-active={isActive}
                type="button"
                onClick={() => navigate(item.page)}
              >
                <Icon size={18} strokeWidth={1.9} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>
      <main className="content-shell">{children}</main>
    </div>
  );
}
