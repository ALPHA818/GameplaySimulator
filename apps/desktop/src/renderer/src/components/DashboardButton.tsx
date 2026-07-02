import type { ReactNode } from 'react';

interface DashboardButtonProps {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}

export function DashboardButton({ icon, label, onClick }: DashboardButtonProps) {
  return (
    <button className="dashboard-button" type="button" onClick={onClick}>
      <span className="dashboard-button__icon" aria-hidden="true">
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}
