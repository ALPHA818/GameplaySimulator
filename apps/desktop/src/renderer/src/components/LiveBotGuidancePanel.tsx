import type { AvailableGameActionLike } from '@core/bot/ActionPlanner';
import type { BotDirectiveProgress, BotTestDirective, BotTestDirectivePriority } from '@core/types';
import { BotTestDirectiveSchema } from '@core/types';
import {
  ArrowDown,
  ArrowUp,
  Check,
  CornerDownRight,
  ListPlus,
  RotateCcw,
  Sparkles,
  X
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  LiveDirectiveBehavior,
  LiveDirectiveMutationResult,
  SimulationBotStatus
} from '../../../main/services/simulationService';
import { FieldLabel, SelectInput, TextareaInput, TextInput } from './FormFields';

type LiveDirectionMode = 'influence' | 'focus' | 'force-next-valid-action' | 'repeat-until-condition';
type LiveDirectionTargetKind = 'feature' | 'area' | 'issue' | 'action' | 'freeform';

interface DirectionDraft {
  direction: string;
  mode: LiveDirectionMode;
  priority: BotTestDirectivePriority;
  exactAction: string;
  featureOrArea: string;
  successCondition: string;
  attemptLimit: string;
  actionKeywords: string[];
  targetKind: LiveDirectionTargetKind;
  targetIssueId?: string;
}

export interface LiveBotGuidancePanelProps {
  sessionId: string | null;
  selectedBot: SimulationBotStatus | null;
  currentGoal: string;
  currentDirective?: BotTestDirective;
  currentProgress?: BotDirectiveProgress;
  queuedDirectives: Array<{ directive: BotTestDirective; progress: BotDirectiveProgress }>;
  availableActions: AvailableGameActionLike[];
  currentArea?: string;
  selectedIssue?: { issueId: string; title: string };
  onMutation: (result: LiveDirectiveMutationResult) => void;
}

const initialDraft: DirectionDraft = {
  direction: '',
  mode: 'focus',
  priority: 'normal',
  exactAction: '',
  featureOrArea: '',
  successCondition: '',
  attemptLimit: '3',
  actionKeywords: [],
  targetKind: 'freeform'
};

let nextLiveDirectiveSequence = 0;

function wordsForDirection(value: string): string[] {
  return [...new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9-]+/)
      .map((word) => word.trim())
      .filter((word) => word.length > 2)
      .slice(0, 10)
  )];
}

function nameForDirection(value: string): string {
  const compact = value.trim().replace(/\s+/g, ' ');
  return compact.length > 80 ? `${compact.slice(0, 77)}...` : compact;
}

function progressPercent(progress: BotDirectiveProgress, directive: BotTestDirective): number {
  if (!directive.maxActions || directive.maxActions <= 0) {
    return progress.status === 'succeeded' ? 100 : 0;
  }
  return Math.min(100, Math.round((progress.actionsAttempted / directive.maxActions) * 100));
}

export function LiveBotGuidancePanel({
  sessionId,
  selectedBot,
  currentGoal,
  currentDirective,
  currentProgress,
  queuedDirectives,
  availableActions,
  currentArea,
  selectedIssue,
  onMutation
}: LiveBotGuidancePanelProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DirectionDraft>(initialDraft);
  const [message, setMessage] = useState('Choose a quick action or describe one small test.');
  const [busy, setBusy] = useState(false);
  const sortedActions = useMemo(
    () => [...availableActions].sort((left, right) => left.actionType.localeCompare(right.actionType)),
    [availableActions]
  );
  const canGuide = Boolean(
    sessionId && selectedBot && ['running', 'waiting', 'blocked'].includes(selectedBot.status)
  );

  function applyQuickDirection(patch: Partial<DirectionDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setOpen(true);
    setMessage('Quick direction loaded. Review it, then apply or queue it.');
  }

  function quickDirection(kind: string) {
    const lastAction = selectedBot?.currentAction ?? selectedBot?.lastActionId;
    const differentAction = sortedActions.find((action) => action.actionType !== lastAction)?.actionType;

    switch (kind) {
      case 'menu':
        applyQuickDirection({
          direction: 'Test the current menu. Open its controls, confirm and cancel choices, then close it.',
          featureOrArea: 'Current menu',
          successCondition: 'The current menu accepts input and can be closed normally.',
          actionKeywords: ['menu', 'confirm', 'cancel', 'close'],
          targetKind: 'feature'
        });
        break;
      case 'inventory':
        applyQuickDirection({
          direction: 'Test inventory actions and check that items do not disappear or change unexpectedly.',
          featureOrArea: 'Inventory',
          successCondition: 'At least three available inventory actions succeed.',
          actionKeywords: ['inventory', 'item', 'equip', 'sort'],
          targetKind: 'feature'
        });
        break;
      case 'movement':
        applyQuickDirection({
          direction: 'Test movement controls in several directions and check that the player can keep moving.',
          featureOrArea: currentArea ?? 'Current area',
          successCondition: 'Several movement actions succeed without trapping the player.',
          actionKeywords: ['move', 'jump', 'direction'],
          targetKind: 'feature'
        });
        break;
      case 'saving':
        applyQuickDirection({
          direction: 'Test saving and loading, then check that progress and items stay correct.',
          featureOrArea: 'Save and load',
          successCondition: 'A save action and a load action both succeed.',
          actionKeywords: ['save', 'load', 'checkpoint'],
          targetKind: 'feature'
        });
        break;
      case 'combat':
        applyQuickDirection({
          direction: 'Test available combat actions, defense, healing, and recovery after taking damage.',
          featureOrArea: 'Combat',
          successCondition: 'At least three combat-related actions succeed.',
          actionKeywords: ['attack', 'combat', 'block', 'dodge', 'heal'],
          targetKind: 'feature'
        });
        break;
      case 'area':
        applyQuickDirection({
          direction: `Explore and test ${currentArea ?? 'the current area'}, including nearby paths and interactions.`,
          featureOrArea: currentArea ?? 'Current area',
          successCondition: 'The bot performs movement and interaction actions in this area.',
          actionKeywords: ['move', 'explore', 'inspect', 'interact'],
          targetKind: 'area'
        });
        break;
      case 'repeat-last':
        if (!lastAction || !sortedActions.some((action) => action.actionType === lastAction)) {
          setMessage('The last action is not currently available, so it cannot be repeated safely.');
          setOpen(true);
          return;
        }
        applyQuickDirection({
          direction: `Repeat ${lastAction} and check that it stays consistent.`,
          mode: 'repeat-until-condition',
          exactAction: lastAction,
          successCondition: `${lastAction} succeeds repeatedly without an unexpected result.`,
          actionKeywords: [lastAction],
          targetKind: 'action'
        });
        break;
      case 'different':
        if (!differentAction) {
          setMessage('No different action is currently available. Wait for the game state to change.');
          setOpen(true);
          return;
        }
        applyQuickDirection({
          direction: `Try the currently available ${differentAction} action next.`,
          mode: 'force-next-valid-action',
          exactAction: differentAction,
          successCondition: `${differentAction} is attempted and returns a result.`,
          actionKeywords: [differentAction],
          targetKind: 'action'
        });
        break;
      case 'issue':
        if (!selectedIssue) {
          setMessage('Select an issue on the Issues page before requesting reproduction.');
          setOpen(true);
          return;
        }
        applyQuickDirection({
          direction: `Try to reproduce ${selectedIssue.title}.`,
          featureOrArea: currentArea ?? '',
          successCondition: 'The same issue signal appears again or the reproduction attempt reaches its limit.',
          actionKeywords: wordsForDirection(selectedIssue.title),
          targetKind: 'issue',
          targetIssueId: selectedIssue.issueId
        });
        break;
    }
  }

  function buildDirective(): BotTestDirective {
    if (!sessionId || !selectedBot) {
      throw new Error('Choose a running bot before creating a direction.');
    }
    if (!draft.direction.trim()) {
      throw new Error('Describe what you want the bot to test.');
    }
    if (!draft.successCondition.trim()) {
      throw new Error('Add a clear success condition.');
    }
    if (draft.mode === 'force-next-valid-action' && !draft.exactAction) {
      throw new Error('Choose one currently available action for force mode.');
    }

    const attemptLimit = Number(draft.attemptLimit);
    const keywords = draft.mode === 'force-next-valid-action'
      ? [draft.exactAction]
      : draft.actionKeywords.length > 0
        ? draft.actionKeywords
        : wordsForDirection(`${draft.direction} ${draft.featureOrArea}`);
    const directiveType = draft.mode === 'force-next-valid-action' || draft.targetKind === 'action'
      ? 'action'
      : draft.targetKind === 'area'
        ? 'area'
        : draft.targetKind === 'issue'
          ? 'issue-reproduction'
          : draft.featureOrArea.trim()
            ? 'feature'
            : 'freeform';
    const directive = BotTestDirectiveSchema.parse({
      directiveId: `live-direction-${Date.now()}-${++nextLiveDirectiveSequence}`,
      sessionId,
      name: nameForDirection(draft.direction),
      description: draft.direction.trim(),
      directiveType,
      directiveMode: draft.mode,
      priority: draft.priority,
      status: 'queued',
      target: {
        allBots: false,
        botIds: [selectedBot.botId],
        profileIds: [],
        gameInstanceIds: []
      },
      actionKeywords: keywords,
      avoidedActionKeywords: [],
      targetFeature: directiveType === 'feature' ? draft.featureOrArea.trim() : undefined,
      targetArea: directiveType === 'area' ? draft.featureOrArea.trim() : undefined,
      targetIssueId: directiveType === 'issue-reproduction' ? draft.targetIssueId : undefined,
      successConditions: [draft.successCondition.trim()],
      failureConditions: [],
      steps: [],
      maxActions: Math.max(10, attemptLimit * 10),
      maxAttempts: attemptLimit,
      timeoutMs: 120_000,
      repeatUntilSuccess: draft.mode === 'repeat-until-condition',
      createdAt: new Date().toISOString(),
      createdBy: 'user-live-session'
    });
    return directive;
  }

  async function submit(behavior: LiveDirectiveBehavior) {
    try {
      setBusy(true);
      const directive = buildDirective();
      const result = await window.gameplaySimulator.simulation.guideBot({
        sessionId: directive.sessionId,
        botId: selectedBot!.botId,
        behavior,
        directive
      });
      onMutation(result);
      setMessage(result.message);
      setDraft(initialDraft);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The direction could not be applied.');
    } finally {
      setBusy(false);
    }
  }

  async function cancelDirective(directiveId: string) {
    if (!sessionId || !selectedBot) {
      return;
    }
    try {
      setBusy(true);
      const result = await window.gameplaySimulator.simulation.cancelBotDirective(
        sessionId,
        selectedBot.botId,
        directiveId
      );
      onMutation(result);
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The direction could not be cancelled.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDirectiveSuccess(directiveId: string) {
    if (!sessionId || !selectedBot) {
      return;
    }
    try {
      setBusy(true);
      const result = await window.gameplaySimulator.simulation.confirmBotDirectiveSuccess(
        sessionId,
        selectedBot.botId,
        directiveId
      );
      onMutation(result);
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The direction result could not be confirmed.');
    } finally {
      setBusy(false);
    }
  }

  async function moveQueuedDirective(index: number, offset: -1 | 1) {
    if (!sessionId || !selectedBot) {
      return;
    }
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= queuedDirectives.length) {
      return;
    }
    const directiveIds = queuedDirectives.map((item) => item.directive.directiveId);
    [directiveIds[index], directiveIds[nextIndex]] = [directiveIds[nextIndex], directiveIds[index]];
    try {
      setBusy(true);
      const result = await window.gameplaySimulator.simulation.reorderBotDirectives({
        sessionId,
        botId: selectedBot.botId,
        directiveIds
      });
      onMutation(result);
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The queue could not be reordered.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="viability-panel live-guidance-panel" aria-label="Guide this bot">
      <div className="viability-panel__header">
        <div>
          <p className="eyebrow">User Direction</p>
          <h2>Guide a running bot</h2>
        </div>
        <button
          className="primary-button"
          type="button"
          disabled={!canGuide}
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <Sparkles size={18} aria-hidden="true" />
          <span>Guide This Bot</span>
        </button>
      </div>

      {open ? (
        <div className="live-guidance-content">
          <div className="guidance-context-grid">
            <div>
              <FieldLabel
                label="Selected Bot"
                helpText="This is the running bot that will receive the direction. The direction changes this bot's choices without restarting it. For example, explorer-001. It adds almost no CPU or RAM use and opens no new game window. Beginners should confirm the bot is still running."
              />
              <strong>{selectedBot?.botId ?? 'No running bot selected'}</strong>
            </div>
            <div>
              <FieldLabel
                label="Current Bot Goal"
                helpText="This is the normal goal from the bot profile. A live direction temporarily guides choices around this goal. For example, an Explorer may normally look for new areas. Wrong goals do not stop the direction, but they can compete when Influence mode is used. Beginners can use Focus mode for a clearer change."
              />
              <strong>{currentGoal}</strong>
            </div>
            <div>
              <FieldLabel
                label="Current Action"
                helpText="This is the action the bot is performing now. A new direction is considered on the next safe planning step, so the current action is not interrupted halfway through. Reading it adds no windows and almost no CPU or RAM use. Beginners should wait for the next action after applying a direction."
              />
              <strong>{selectedBot?.currentAction ?? selectedBot?.lastActionId ?? 'Waiting'}</strong>
            </div>
            <div>
              <FieldLabel
                label="Current Directive"
                helpText="This is the user direction currently guiding the bot. Safety recovery and startup setup still have higher priority. Cancelling it returns the bot to its normal profile or the next queued direction. Directives do not open extra windows. Beginners should replace it only when they want an immediate change."
              />
              <strong>{currentDirective?.name ?? 'Normal profile behavior'}</strong>
            </div>
          </div>

          <div className="guidance-quick-actions" aria-label="Quick directions">
            {[
              ['menu', 'Test current menu'],
              ['inventory', 'Test inventory'],
              ['movement', 'Test movement'],
              ['saving', 'Test saving'],
              ['combat', 'Test combat'],
              ['area', 'Test this area'],
              ['repeat-last', 'Repeat last action'],
              ['different', 'Try a different action'],
              ['issue', 'Reproduce selected issue']
            ].map(([kind, label]) => (
              <button className="secondary-button" type="button" key={kind} onClick={() => quickDirection(kind)}>
                <CornerDownRight size={16} aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
            <button
              className="secondary-button"
              type="button"
              disabled={!currentDirective || busy}
              onClick={() => currentDirective && void cancelDirective(currentDirective.directiveId)}
            >
              <RotateCcw size={16} aria-hidden="true" />
              <span>Return to normal behavior</span>
            </button>
          </div>

          <div className="guidance-field-grid">
            <TextareaInput
              name="liveTestDirection"
              label="New Test Direction"
              helpText="Tell the bot what you want tested in simple words. The planner uses these words only to choose from actions the adapter reports. For example, open the inventory and sort three items. If the game cannot perform it, the direction may be unavailable. Beginners should ask for one small test."
              rows={3}
              value={draft.direction}
              onChange={(event) => setDraft((current) => ({ ...current, direction: event.target.value }))}
            />
            <SelectInput
              name="liveDirectionMode"
              label="Direction Mode"
              helpText="This controls how strongly the bot follows your request. Influence gently prefers matching actions. Focus strongly prefers them. Force requests one exact currently available action. Repeat keeps trying within limits. Safety recovery still comes first. Beginners should use Focus."
              value={draft.mode}
              onChange={(event) => setDraft((current) => ({
                ...current,
                mode: event.target.value as LiveDirectionMode
              }))}
            >
              <option value="influence">Influence</option>
              <option value="focus">Focus</option>
              <option value="force-next-valid-action">Force next valid action</option>
              <option value="repeat-until-condition">Repeat until condition</option>
            </SelectInput>
            <SelectInput
              name="liveDirectionPriority"
              label="Priority"
              helpText="This orders directions waiting for the same bot. Urgent comes before High, Normal, and Low. It does not override safety recovery. For example, use High for the main feature you are watching. Too many urgent directions make the queue harder to understand. Beginners should use Normal."
              value={draft.priority}
              onChange={(event) => setDraft((current) => ({
                ...current,
                priority: event.target.value as BotTestDirectivePriority
              }))}
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </SelectInput>
            <SelectInput
              name="liveExactAction"
              label="Exact Available Action"
              helpText="This list comes directly from the selected bot's current game adapter. Force mode can choose only one item from this list and checks it again before applying. For example, open-menu. If the game state changes, the action may become unavailable. Beginners should use this only for one exact next action."
              value={draft.exactAction}
              disabled={draft.mode !== 'force-next-valid-action' || sortedActions.length === 0}
              onChange={(event) => setDraft((current) => ({
                ...current,
                exactAction: event.target.value,
                actionKeywords: event.target.value ? [event.target.value] : [],
                targetKind: 'action'
              }))}
            >
              <option value="">Choose a currently available action</option>
              {sortedActions.map((action) => (
                <option key={action.actionType} value={action.actionType}>
                  {action.label ? `${action.label} (${action.actionType})` : action.actionType}
                </option>
              ))}
            </SelectInput>
            <TextInput
              name="liveFeatureArea"
              label="Feature Or Area"
              helpText="Name the game feature or place this direction is about. It helps the planner match related actions and makes reports clearer. For example, Inventory or Forest. If the name does not match game state, automatic progress may be weaker. Beginners should use the same words shown in Live Session."
              value={draft.featureOrArea}
              onChange={(event) => setDraft((current) => ({
                ...current,
                featureOrArea: event.target.value,
                targetKind: current.targetKind === 'area' ? 'area' : 'feature'
              }))}
            />
            <TextareaInput
              name="liveSuccessCondition"
              label="Success Condition"
              helpText="Describe the result that means the direction worked. For example, inventory opens and three item actions succeed. Instrumented adapters can measure more than desktop fallback. If the result cannot be measured, inspect the screen and logs yourself. Beginners should write one clear result."
              rows={2}
              value={draft.successCondition}
              onChange={(event) => setDraft((current) => ({ ...current, successCondition: event.target.value }))}
            />
            <TextInput
              name="liveAttemptLimit"
              label="Attempt Limit"
              helpText="This is how many failed tries the direction may use before it stops. For example, 3 gives the bot three chances. Larger limits can extend the run and create more logs or screenshots, but they add no windows. Beginners should use 3."
              type="number"
              min={1}
              max={100}
              value={draft.attemptLimit}
              onChange={(event) => setDraft((current) => ({ ...current, attemptLimit: event.target.value }))}
            />
          </div>

          <div className="guidance-runtime-note">
            <FieldLabel
              label="Live Direction Runtime Cost"
              helpText="A live direction changes decisions for an existing bot. It does not create another bot or game window. Checking available actions uses a small amount of CPU and adapter communication, while the queue uses very little RAM. Support depends on the selected adapter's reported actions and state. Beginners can safely guide one watched bot."
            />
            <span>Uses the existing bot and game instance. No extra window opens. Available actions refresh as game state changes.</span>
          </div>

          <div className="guidance-actions">
            <button className="primary-button" type="button" disabled={busy || !canGuide} onClick={() => void submit('apply')}>
              <Sparkles size={17} aria-hidden="true" />
              <span>Apply Direction</span>
            </button>
            <button className="secondary-button" type="button" disabled={busy || !canGuide} onClick={() => void submit('queue')}>
              <ListPlus size={17} aria-hidden="true" />
              <span>Queue For Later</span>
            </button>
            <button className="secondary-button" type="button" disabled={busy || !currentDirective} onClick={() => void submit('replace')}>
              <RotateCcw size={17} aria-hidden="true" />
              <span>Replace Current Direction</span>
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={busy || !currentDirective}
              onClick={() => currentDirective && void cancelDirective(currentDirective.directiveId)}
            >
              <X size={17} aria-hidden="true" />
              <span>Cancel Current Direction</span>
            </button>
            {currentDirective?.manualSuccessConfirmation ? (
              <button
                className="secondary-button"
                type="button"
                disabled={busy || !currentProgress || currentProgress.status !== 'active'}
                onClick={() => void confirmDirectiveSuccess(currentDirective.directiveId)}
              >
                <Check size={17} aria-hidden="true" />
                <span>Confirm Direction Succeeded</span>
              </button>
            ) : null}
          </div>

          <div className="inline-notice guidance-message" aria-live="polite">{message}</div>

          <div className="directive-queue">
            <FieldLabel
              label="Directive Queue"
              helpText="This shows the selected bot's active and waiting directions. Priority decides which waiting direction runs first, then the order shown here. Progress and action counts update while the bot runs. Reordering uses almost no resources and opens no windows. Beginners should keep only a few directions queued."
            />
            {currentDirective && currentProgress ? (
              <div className="directive-queue-row directive-queue-row--active">
                <div>
                  <strong>{currentDirective.name}</strong>
                  <span>Active · {currentDirective.priority} priority · {progressPercent(currentProgress, currentDirective)}% progress</span>
                  <small>
                    {currentProgress.actionsAttempted} actions used ·{' '}
                    {currentDirective.maxActions === undefined
                      ? 'no action limit'
                      : `${Math.max(0, currentDirective.maxActions - currentProgress.actionsAttempted)} remaining`}
                  </small>
                </div>
                <button className="icon-button" type="button" title="Cancel active direction" onClick={() => void cancelDirective(currentDirective.directiveId)}>
                  <X size={17} aria-hidden="true" />
                </button>
              </div>
            ) : (
              <div className="empty-row">Normal profile behavior is active.</div>
            )}
            {queuedDirectives.map(({ directive, progress }, index) => (
              <div className="directive-queue-row" key={directive.directiveId}>
                <div>
                  <strong>{directive.name}</strong>
                  <span>Queued · {directive.priority} priority · assigned to {progress.botId}</span>
                  <small>
                    {progress.actionsAttempted} actions used ·{' '}
                    {directive.maxActions === undefined
                      ? 'no action limit'
                      : `${Math.max(0, directive.maxActions - progress.actionsAttempted)} remaining`}
                  </small>
                </div>
                <div className="directive-queue-actions">
                  <button
                    className="icon-button"
                    type="button"
                    title="Move direction earlier"
                    disabled={
                      index === 0 ||
                      busy ||
                      queuedDirectives[index - 1]?.directive.priority !== directive.priority
                    }
                    onClick={() => void moveQueuedDirective(index, -1)}
                  >
                    <ArrowUp size={17} aria-hidden="true" />
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    title="Move direction later"
                    disabled={
                      index === queuedDirectives.length - 1 ||
                      busy ||
                      queuedDirectives[index + 1]?.directive.priority !== directive.priority
                    }
                    onClick={() => void moveQueuedDirective(index, 1)}
                  >
                    <ArrowDown size={17} aria-hidden="true" />
                  </button>
                  <button className="icon-button" type="button" title="Cancel queued direction" disabled={busy} onClick={() => void cancelDirective(directive.directiveId)}>
                    <X size={17} aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
