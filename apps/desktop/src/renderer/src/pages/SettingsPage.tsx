import type { ObservationMode } from '@core/config/runtimeObservationConfig';
import { FieldLabel, SelectInput, TextInput, ToggleInput } from '../components/FormFields';
import { useConfigStore } from '../store/configStore';

const observationModeOptions: Array<{ value: ObservationMode; label: string }> = [
  { value: 'background', label: 'Background' },
  { value: 'follow-first-bot', label: 'Follow first bot' },
  { value: 'follow-selected-bot', label: 'Follow selected bot' },
  { value: 'show-all-instances', label: 'Show all instances' }
];

export function SettingsPage() {
  const { runtimeObservation, updateRuntimeObservation } = useConfigStore();

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
        <div className="metric-grid settings-default-grid">
          <div className="metric-card">
            <FieldLabel label="Auto Scaling" />
            <strong>Enabled for default bot pools</strong>
          </div>
          <div className="metric-card">
            <FieldLabel label="Screenshots" />
            <strong>Enabled when the adapter supports them</strong>
          </div>
          <div className="metric-card">
            <FieldLabel label="Action Timeline" />
            <strong>Enabled for new sessions</strong>
          </div>
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

    </section>
  );
}
