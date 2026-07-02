import { ToggleInput } from '../components/FormFields';

export function SettingsPage() {
  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>Settings</h1>
        </div>
      </div>

      <section className="form-section form-section--narrow">
        <h2>Defaults</h2>
        <div className="toggle-grid">
          <ToggleInput label="Auto Scaling" checked readOnly />
          <ToggleInput label="Screenshots" checked readOnly />
          <ToggleInput label="Action Timeline" checked readOnly />
        </div>
      </section>
    </section>
  );
}
