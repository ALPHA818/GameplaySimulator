import {
  defaultAdvancedIntelligenceConfig,
  getAdvancedIntelligenceWarnings,
  getEnabledAdvancedIntelligenceFeatures,
  type BotStrategyTuningMode,
  type BugDeduplicationMode,
  type VisionModelMode
} from '@core/config/advancedIntelligenceConfig';
import type { ObservationMode } from '@core/config/runtimeObservationConfig';
import { FieldLabel, SelectInput, TextInput, ToggleInput } from '../components/FormFields';
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

const observationModeOptions: Array<{ value: ObservationMode; label: string }> = [
  { value: 'background', label: 'Background' },
  { value: 'follow-first-bot', label: 'Follow first bot' },
  { value: 'follow-selected-bot', label: 'Follow selected bot' },
  { value: 'show-all-instances', label: 'Show all instances' }
];

export function SettingsPage() {
  const {
    advancedIntelligence,
    runtimeObservation,
    updateAdvancedIntelligence,
    updateRuntimeObservation
  } = useConfigStore();
  const enabledFeatures = getEnabledAdvancedIntelligenceFeatures(advancedIntelligence);
  const warnings = getAdvancedIntelligenceWarnings(advancedIntelligence);
  const advancedLocked = !advancedIntelligence.realRuntimePrerequisiteAcknowledged;

  return (
    <section className="page-stack settings-page">
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

      <section className="form-section observation-settings-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Runtime</p>
            <h2>Live Bot Observation</h2>
          </div>
          <span className="status-pill">
            {runtimeObservation.showBotGameplay ? 'Visible gameplay' : 'Background mode'}
          </span>
        </div>

        <div className="notice-list notice-list--warning observation-warning-list">
          <strong>
            <FieldLabel
              label="Observation Resource Impact"
              helpText="Visible game windows need extra computer work. They can increase CPU use, RAM use, and screen space. Showing several windows uses more than showing one. Background mode is faster for large tests. Beginners should watch only one bot at first."
            />
          </strong>
          <span>Visible browser or game windows can use more CPU and RAM than background testing.</span>
          <span>Many visible windows can cover your desktop and make other work harder to see.</span>
          <span>Bringing a game to the front after every action may interrupt normal computer use.</span>
        </div>

        <div className="notice-list observation-adapter-support">
          <strong>
            <FieldLabel
              label="Visible Adapter Support"
              helpText="This explains which adapters can show a game window. Browser and desktop adapters normally can. Unity, Godot, and Unreal can show their desktop fallback window. An instrumented or custom adapter may have no window unless its game is already visible. If the adapter cannot show a window, testing continues safely in the background."
            />
          </strong>
          <span>
            Browser and desktop-window adapters can expose visible gameplay. Unity, Godot, and Unreal
            can use their desktop fallback window. Instrumented and custom adapters may stay in the
            background when they do not own a visible game window.
          </span>
        </div>

        <div className="toggle-grid observation-toggle-grid">
          <ToggleInput
            id="show-bot-gameplay"
            label="Show Bot Gameplay"
            helpText="This opens the game where you can see it while the bot plays. You will be able to watch the bot press controls and move through the game. Turning this on can use more RAM, CPU, and screen space. For a first test with one bot, turning it on is recommended. For large tests with many bots, leaving it off is usually faster. Browser and desktop-window adapters can usually show a window; adapters without a visible window keep testing in the background."
            checked={runtimeObservation.showBotGameplay}
            onChange={(event) => {
              const showBotGameplay = event.currentTarget.checked;
              updateRuntimeObservation({
                showBotGameplay,
                observationMode: showBotGameplay
                  ? runtimeObservation.observationMode === 'background'
                    ? 'follow-first-bot'
                    : runtimeObservation.observationMode
                  : 'background',
                bringGameToFrontOnAction: showBotGameplay
                  ? runtimeObservation.bringGameToFrontOnAction
                  : false
              });
            }}
          />
          <ToggleInput
            id="bring-game-to-front-on-action"
            label="Bring Game To Front On Action"
            helpText="This asks the adapter to focus the visible game when a bot acts. It helps keyboard and mouse actions reach the right window. It does not normally add another window or much RAM, but frequent focus changes can interrupt your work. If focus is wrong, controls may go to another app. Beginners should leave this off unless the selected desktop adapter needs focus."
            checked={runtimeObservation.bringGameToFrontOnAction}
            disabled={!runtimeObservation.showBotGameplay}
            onChange={(event) =>
              updateRuntimeObservation({ bringGameToFrontOnAction: event.currentTarget.checked })
            }
          />
          <ToggleInput
            id="show-action-information"
            label="Show Action Information"
            helpText="This shows what the visible bot is doing and why. A watched browser game gets a short test-only label and click or key clue. Desktop games show the same details in the Live Session page and are never changed. It uses a small amount of CPU and RAM and opens no extra window. If it is off, testing works normally without the extra text. Beginners should leave it on for one-bot tests."
            checked={runtimeObservation.showActionInformation}
            disabled={!runtimeObservation.showBotGameplay}
            onChange={(event) =>
              updateRuntimeObservation({ showActionInformation: event.currentTarget.checked })
            }
          />
        </div>

        <div className="field-grid observation-field-grid">
          <SelectInput
            id="observation-mode"
            label="Observation Mode"
            helpText="This chooses which game window you watch. Follow first bot shows one bot, Follow selected bot uses the bot ID below, and Show all instances opens every allowed window. More visible windows use more CPU, RAM, and desktop space. A wrong choice may show the wrong bot or too many windows. Beginners should choose Follow first bot on a browser or desktop adapter."
            value={runtimeObservation.observationMode}
            disabled={!runtimeObservation.showBotGameplay}
            onChange={(event) => {
              const observationMode = event.currentTarget.value as ObservationMode;
              updateRuntimeObservation({
                observationMode,
                showBotGameplay: observationMode !== 'background',
                bringGameToFrontOnAction:
                  observationMode === 'background' ? false : runtimeObservation.bringGameToFrontOnAction
              });
            }}
          >
            {observationModeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectInput>

          <TextInput
            id="observation-selected-bot"
            label="Follow Bot"
            helpText="This is the bot ID to keep visible in Follow selected bot mode. For example, explorer-001 follows the first Explorer bot. It does not add CPU or RAM by itself and opens only that bot's game window when the adapter supports one. If the ID is missing or wrong, the simulator may fall back to the first bot. Beginners can leave this blank and use Follow first bot."
            placeholder="explorer-001"
            value={runtimeObservation.selectedBotId ?? ''}
            disabled={
              !runtimeObservation.showBotGameplay ||
              runtimeObservation.observationMode !== 'follow-selected-bot'
            }
            onChange={(event) =>
              updateRuntimeObservation({ selectedBotId: event.currentTarget.value.trim() || undefined })
            }
          />

          <TextInput
            id="visible-action-delay"
            label="Visible Action Delay"
            helpText="This is the minimum wait between visible bot actions, measured in milliseconds. For example, 250 is one quarter of a second. A longer delay makes play easier to watch and may lower CPU use, but the test takes longer. A value that is too low can look too fast or cause missed input. Beginners should use 250 to 500 with any adapter that shows gameplay."
            type="number"
            min={0}
            max={60_000}
            step={50}
            value={runtimeObservation.visibleActionDelayMs}
            disabled={!runtimeObservation.showBotGameplay}
            onChange={(event) => {
              const visibleActionDelayMs = event.currentTarget.valueAsNumber;

              if (Number.isFinite(visibleActionDelayMs)) {
                updateRuntimeObservation({
                  visibleActionDelayMs: Math.min(60_000, Math.max(0, Math.round(visibleActionDelayMs)))
                });
              }
            }}
          />

          <TextInput
            id="maximum-visible-game-windows"
            label="Maximum Visible Game Windows"
            helpText="This limits how many game windows may be visible at once. For example, 1 shows one game while other bots continue in the background. Higher numbers use more CPU, RAM, and screen space. A value that is too high can cover the desktop or slow the computer. Beginners should use 1, and the selected adapter must support visible windows."
            type="number"
            min={1}
            max={32}
            step={1}
            value={runtimeObservation.maxVisibleGameWindows}
            disabled={!runtimeObservation.showBotGameplay}
            onChange={(event) => {
              const maxVisibleGameWindows = event.currentTarget.valueAsNumber;

              if (Number.isFinite(maxVisibleGameWindows)) {
                updateRuntimeObservation({
                  maxVisibleGameWindows: Math.min(32, Math.max(1, Math.round(maxVisibleGameWindows)))
                });
              }
            }}
          />
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
