import {
  defaultAdvancedIntelligenceConfig,
  getAdvancedIntelligenceWarnings,
  getEnabledAdvancedIntelligenceFeatures,
  type BotStrategyTuningMode,
  type BugDeduplicationMode,
  type VisionModelMode
} from '@core/config/advancedIntelligenceConfig';
import { FieldLabel, SelectInput, ToggleInput } from '../components/FormFields';
import { useConfigStore } from '../store/configStore';

const visionModelModeOptions: Array<{ value: VisionModelMode; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'local', label: 'Local model' },
  { value: 'external', label: 'External service' }
];

const strategyModeOptions: Array<{ value: BotStrategyTuningMode; label: string }> = [
  { value: 'profile-defaults', label: 'Profile defaults' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'exploration-heavy', label: 'Exploration heavy' },
  { value: 'bug-hunting-heavy', label: 'Bug hunting heavy' }
];

const deduplicationModeOptions: Array<{ value: BugDeduplicationMode; label: string }> = [
  { value: 'basic', label: 'Basic' },
  { value: 'fingerprint', label: 'Fingerprint matching' },
  { value: 'state-aware', label: 'State-aware matching' }
];

export function SettingsPage() {
  const { advancedIntelligence, updateAdvancedIntelligence } = useConfigStore();
  const enabledFeatures = getEnabledAdvancedIntelligenceFeatures(advancedIntelligence);
  const warnings = getAdvancedIntelligenceWarnings(advancedIntelligence);
  const advancedLocked = !advancedIntelligence.realRuntimePrerequisiteAcknowledged;

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>Settings</h1>
        </div>
      </div>

      <section className="form-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Foundation</p>
            <h2>Real Runtime Readiness</h2>
          </div>
          <span className="status-pill">Adapter-first</span>
        </div>

        <div className="metric-grid metric-grid--session">
          <div className="metric-card">
            <FieldLabel label="Real Adapter Runtime" />
            <strong>Required</strong>
          </div>
          <div className="metric-card">
            <FieldLabel label="Adapter Evidence" />
            <strong>Required</strong>
          </div>
          <div className="metric-card">
            <FieldLabel label="Persistent Reports" />
            <strong>Required</strong>
          </div>
          <div className="metric-card">
            <FieldLabel label="Save/Profile Isolation" />
            <strong>Recommended</strong>
          </div>
        </div>
      </section>

      <section className="form-section form-section--narrow">
        <h2>Defaults</h2>
        <div className="toggle-grid">
          <ToggleInput label="Auto Scaling" checked readOnly />
          <ToggleInput label="Screenshots" checked readOnly />
          <ToggleInput label="Action Timeline" checked readOnly />
        </div>
      </section>

      <section className="form-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Phase 40</p>
            <h2>Advanced Intelligence</h2>
          </div>
          <span className="status-pill">{enabledFeatures.length} enabled</span>
        </div>

        <div className={advancedLocked ? 'notice-list notice-list--warning' : 'notice-list'}>
          <strong>
            <FieldLabel label="Advanced Intelligence Status" />
          </strong>
          <span>
            {advancedLocked
              ? 'Advanced settings are locked until a real adapter session can launch, control, capture evidence, and save reports.'
              : 'Advanced settings are unlocked for future real-runtime improvements.'}
          </span>
          {warnings.map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </div>

        <div className="toggle-grid">
          <ToggleInput
            label="Real Runtime Prerequisite"
            checked={advancedIntelligence.realRuntimePrerequisiteAcknowledged}
            onChange={(event) =>
              updateAdvancedIntelligence(
                event.currentTarget.checked
                  ? { realRuntimePrerequisiteAcknowledged: true }
                  : defaultAdvancedIntelligenceConfig
              )
            }
          />
          <ToggleInput
            label="Vision Model"
            checked={advancedIntelligence.visionModelEnabled}
            disabled={advancedLocked}
            onChange={(event) =>
              updateAdvancedIntelligence({
                visionModelEnabled: event.currentTarget.checked,
                visionModelMode: event.currentTarget.checked ? 'local' : 'off'
              })
            }
          />
          <ToggleInput
            label="Map Memory"
            checked={advancedIntelligence.mapMemoryEnabled}
            disabled={advancedLocked}
            onChange={(event) =>
              updateAdvancedIntelligence({
                mapMemoryEnabled: event.currentTarget.checked
              })
            }
          />
          <ToggleInput
            label="Quest Inference"
            checked={advancedIntelligence.questInferenceEnabled}
            disabled={advancedLocked}
            onChange={(event) =>
              updateAdvancedIntelligence({
                questInferenceEnabled: event.currentTarget.checked
              })
            }
          />
          <ToggleInput
            label="Bot Strategy Tuning"
            checked={advancedIntelligence.botStrategyTuningEnabled}
            disabled={advancedLocked}
            onChange={(event) =>
              updateAdvancedIntelligence({
                botStrategyTuningEnabled: event.currentTarget.checked,
                botStrategyTuningMode: event.currentTarget.checked ? 'balanced' : 'profile-defaults'
              })
            }
          />
          <ToggleInput
            label="Long Overnight Test Mode"
            checked={advancedIntelligence.longOvernightTestMode}
            disabled={advancedLocked}
            onChange={(event) =>
              updateAdvancedIntelligence({
                longOvernightTestMode: event.currentTarget.checked
              })
            }
          />
          <ToggleInput
            label="Performance Graphs"
            checked={advancedIntelligence.performanceGraphsEnabled}
            disabled={advancedLocked}
            onChange={(event) =>
              updateAdvancedIntelligence({
                performanceGraphsEnabled: event.currentTarget.checked
              })
            }
          />
          <ToggleInput
            label="Heatmaps"
            checked={advancedIntelligence.heatmapsEnabled}
            disabled={advancedLocked}
            onChange={(event) =>
              updateAdvancedIntelligence({
                heatmapsEnabled: event.currentTarget.checked
              })
            }
          />
          <ToggleInput
            label="Action Replay Scripts"
            checked={advancedIntelligence.actionReplayScriptsEnabled}
            disabled={advancedLocked}
            onChange={(event) =>
              updateAdvancedIntelligence({
                actionReplayScriptsEnabled: event.currentTarget.checked
              })
            }
          />
          <ToggleInput
            label="Engine-Specific Plugins"
            checked={advancedIntelligence.engineSpecificPluginsEnabled}
            disabled={advancedLocked}
            onChange={(event) =>
              updateAdvancedIntelligence({
                engineSpecificPluginsEnabled: event.currentTarget.checked
              })
            }
          />
        </div>

        <div className="field-grid">
          <SelectInput
            label="Vision Model Mode"
            value={advancedIntelligence.visionModelMode}
            disabled={advancedLocked || !advancedIntelligence.visionModelEnabled}
            onChange={(event) =>
              updateAdvancedIntelligence({
                visionModelMode: event.currentTarget.value as VisionModelMode
              })
            }
          >
            {visionModelModeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectInput>

          <SelectInput
            label="Bot Strategy Tuning Mode"
            value={advancedIntelligence.botStrategyTuningMode}
            disabled={advancedLocked || !advancedIntelligence.botStrategyTuningEnabled}
            onChange={(event) =>
              updateAdvancedIntelligence({
                botStrategyTuningMode: event.currentTarget.value as BotStrategyTuningMode
              })
            }
          >
            {strategyModeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectInput>

          <SelectInput
            label="Bug Deduplication"
            value={advancedIntelligence.bugDeduplicationMode}
            disabled={advancedLocked}
            onChange={(event) =>
              updateAdvancedIntelligence({
                bugDeduplicationMode: event.currentTarget.value as BugDeduplicationMode
              })
            }
          >
            {deduplicationModeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectInput>
        </div>
      </section>
    </section>
  );
}
