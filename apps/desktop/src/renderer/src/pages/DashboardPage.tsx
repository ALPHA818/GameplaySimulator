import { Bot, FileText, Gamepad2, PlusCircle, Settings } from 'lucide-react';
import { DashboardButton } from '../components/DashboardButton';
import { useConfigStore } from '../store/configStore';
import { useSessionStore } from '../store/sessionStore';

const actions = [
  { label: 'New Session', icon: PlusCircle, page: 'newSession' },
  { label: 'Game Profiles', icon: Gamepad2, page: 'gameProfiles' },
  { label: 'Bot Profiles', icon: Bot, page: 'botProfiles' },
  { label: 'Reports', icon: FileText, page: 'reports' },
  { label: 'Settings', icon: Settings, page: 'settings' }
] as const;

export function DashboardPage() {
  const statusLabel = useSessionStore((state) => state.statusLabel);
  const navigate = useConfigStore((state) => state.navigate);

  return (
    <section className="dashboard" aria-labelledby="dashboard-title">
      <div className="dashboard__header">
        <div>
          <p className="eyebrow">Desktop QA Simulator</p>
          <h1 id="dashboard-title">GameplaySimulator</h1>
        </div>
        <div className="status-pill" aria-live="polite">
          {statusLabel}
        </div>
      </div>

      <div className="dashboard__actions" aria-label="Primary actions">
        {actions.map((action) => {
          const Icon = action.icon;

          return (
            <DashboardButton
              key={action.label}
              icon={<Icon size={20} strokeWidth={1.8} />}
              label={action.label}
              onClick={() => navigate(action.page)}
            />
          );
        })}
      </div>
    </section>
  );
}
