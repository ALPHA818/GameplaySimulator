import type { GameAction, GameStateSnapshot, UIFlow, UIFlowStep } from '../types';
import type { ActionPlannerMemory, AvailableGameActionLike } from './ActionPlanner';

export interface UIJourneyPlannerInput {
  sessionId: string;
  gameInstanceId: string;
  botId: string;
  flow: UIFlow;
  state: GameStateSnapshot | null;
  availableActions: AvailableGameActionLike[];
  actionIndex: number;
  now: string;
  seed?: number;
  memory?: ActionPlannerMemory;
}

export interface UIJourneyStepSelection {
  flow: UIFlow;
  step: UIFlowStep;
  stepIndex: number;
  currentScreen?: string;
  matchedAvailableAction?: AvailableGameActionLike;
  matchedVisibleButton?: {
    label: string;
    selector?: string;
  };
  reason: string;
}

function normalize(value: string | undefined): string {
  return value?.trim().toLowerCase().replace(/[\s_]+/g, '-') ?? '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function valueAtPath(record: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = record;

  for (const part of path) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[part];
  }

  return current;
}

export function currentUIScreen(state: GameStateSnapshot | null): string | undefined {
  if (!state) {
    return undefined;
  }

  const candidates = [
    state.uiState?.currentScreen,
    valueAtPath(state.state, ['uiState', 'screenId']),
    valueAtPath(state.state, ['uiState', 'screen']),
    valueAtPath(state.state, ['uiState', 'currentScreen']),
    valueAtPath(state.state, ['ui', 'screenId']),
    valueAtPath(state.state, ['ui', 'screen']),
    valueAtPath(state.state, ['screenId']),
    valueAtPath(state.state, ['screen']),
    valueAtPath(state.state, ['currentScreen']),
    valueAtPath(state.state, ['currentMenu']),
    state.uiState?.isInGameplay ? 'gameplay' : undefined,
    state.uiState?.isLoading ? 'loading' : undefined,
    state.uiState?.isPaused ? 'pause-menu' : undefined,
    state.scene
  ];

  return candidates.map(stringValue).find(Boolean);
}

function visibleButtons(state: GameStateSnapshot | null): Array<{ label: string; selector?: string }> {
  if (!state) {
    return [];
  }

  const value = state.uiState?.visibleButtons ?? valueAtPath(state.state, ['uiState', 'visibleButtons']);

  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (typeof item === 'string' && item.trim()) {
      return [{ label: item.trim() }];
    }

    if (!isRecord(item)) {
      return [];
    }

    const label = stringValue(item.label) ?? stringValue(item.text) ?? stringValue(item.name);
    return label ? [{ label, selector: stringValue(item.selector) }] : [];
  });
}

function buttonMatchesStep(button: { label: string }, step: UIFlowStep): boolean {
  const label = normalize(button.label);
  const target = normalize(step.targetLabel);
  const action = normalize(step.actionType);

  return Boolean(
    (target && (label === target || label.includes(target) || target.includes(label))) ||
      (action && (label === action || action.includes(label) || label.includes(action)))
  );
}

function actionText(action: AvailableGameActionLike): string {
  return normalize([action.actionType, action.label, action.description].filter(Boolean).join(' '));
}

function stepText(step: UIFlowStep): string {
  return normalize([step.actionType, step.targetLabel, step.keyBinding, step.fallbackAction].filter(Boolean).join(' '));
}

function actionMatchesStep(action: AvailableGameActionLike, step: UIFlowStep): boolean {
  const text = actionText(action);
  const wanted = stepText(step);

  return (
    normalize(action.actionType) === normalize(step.actionType) ||
    Boolean(step.targetLabel && text.includes(normalize(step.targetLabel))) ||
    Boolean(step.keyBinding && text.includes(normalize(step.keyBinding))) ||
    Boolean(wanted && text.includes(wanted))
  );
}

function stepWasRecentlyTried(step: UIFlowStep, memory?: ActionPlannerMemory): boolean {
  const actionType = normalize(step.actionType);
  const fallback = normalize(step.fallbackAction);

  return (memory?.recentActionTypes ?? []).some((recent) => {
    const normalized = normalize(recent);
    return normalized === actionType || Boolean(fallback && normalized === fallback);
  });
}

function firstUntriedStep(flow: UIFlow, memory?: ActionPlannerMemory): number {
  const index = flow.steps.findIndex((step) => !stepWasRecentlyTried(step, memory));
  return index === -1 ? Math.max(0, flow.steps.length - 1) : index;
}

function stepId(step: UIFlowStep, index: number): string {
  return step.stepId ?? step.actionType ?? `step-${index + 1}`;
}

function mouseTargetPayload(step: UIFlowStep): Record<string, unknown> {
  if (!step.mouseTarget) {
    return {};
  }

  if (typeof step.mouseTarget === 'string') {
    return { button: step.mouseTarget };
  }

  return {
    mouseSelector: step.mouseTarget.selector,
    mouseLabel: step.mouseTarget.label,
    x: step.mouseTarget.x,
    y: step.mouseTarget.y,
    mouseDescription: step.mouseTarget.description
  };
}

export class UIJourneyPlanner {
  chooseStep(input: UIJourneyPlannerInput): UIJourneyStepSelection | null {
    if (input.flow.steps.length === 0) {
      return null;
    }

    const currentScreen = currentUIScreen(input.state);
    const screenMatchedIndex =
      currentScreen === undefined
        ? -1
        : input.flow.steps.findIndex(
            (step) => step.expectedScreen && normalize(step.expectedScreen) === normalize(currentScreen)
          );
    const stepIndex = screenMatchedIndex >= 0 ? screenMatchedIndex : firstUntriedStep(input.flow, input.memory);
    const step = input.flow.steps[stepIndex];

    if (!step) {
      return null;
    }

    const matchedAvailableAction = input.availableActions.find((action) => actionMatchesStep(action, step));
    const matchedVisibleButton = visibleButtons(input.state).find((button) => buttonMatchesStep(button, step));

    return {
      flow: input.flow,
      step,
      stepIndex,
      currentScreen,
      matchedAvailableAction,
      matchedVisibleButton,
      reason:
        matchedVisibleButton
          ? `found visible UI button ${matchedVisibleButton.label} on ${currentScreen ?? 'the current screen'}`
          : screenMatchedIndex >= 0
          ? `matched current UI screen ${currentScreen}`
          : 'using next configured UI flow step'
    };
  }

  chooseAction(input: UIJourneyPlannerInput): GameAction | null {
    const selection = this.chooseStep(input);

    if (!selection) {
      return null;
    }

    const selectedAction = selection.matchedAvailableAction;
    const adapterPayload = selectedAction?.payloadSchema;
    const domTarget =
      selection.matchedVisibleButton !== undefined ||
      adapterPayload?.domTarget === true;
    const actionType = selectedAction?.actionType ?? selection.step.actionType ?? selection.step.fallbackAction;
    const nextLikelyAction = input.flow.steps[selection.stepIndex + 1]?.actionType;

    if (!actionType) {
      return null;
    }

    return {
      actionId: `${input.botId}-ui-flow-${String(input.actionIndex + 1).padStart(4, '0')}`,
      sessionId: input.sessionId,
      gameInstanceId: input.gameInstanceId,
      botId: input.botId,
      type: actionType,
      payload: {
        planner: 'ui-journey',
        flowId: selection.flow.flowId,
        flowName: selection.flow.name,
        flowStartState: selection.flow.startState,
        flowEndState: selection.flow.endState,
        flowStepCount: selection.flow.steps.length,
        stepIndex: selection.stepIndex,
        stepId: stepId(selection.step, selection.stepIndex),
        expectedScreen: selection.step.expectedScreen,
        currentScreen: selection.currentScreen,
        targetLabel: selection.step.targetLabel,
        keyBinding: selection.step.keyBinding,
        binding: selection.step.keyBinding,
        controlId: selection.step.targetLabel ?? selection.step.actionType,
        mouseTarget: selection.step.mouseTarget,
        ...mouseTargetPayload(selection.step),
        durationMs: selection.step.waitAfterMs,
        waitAfterMs: selection.step.waitAfterMs,
        successCondition: selection.step.successCondition,
        fallbackAction: selection.step.fallbackAction,
        maxRetries: selection.step.maxRetries,
        matchedAvailableAction: selectedAction?.actionType,
        matchedVisibleButton: selection.matchedVisibleButton?.label,
        adapterPayload,
        domTarget,
        domTargetLabel:
          selection.matchedVisibleButton?.label ??
          (typeof adapterPayload?.domTargetLabel === 'string' ? adapterPayload.domTargetLabel : undefined),
        domSelector:
          selection.matchedVisibleButton?.selector ??
          (typeof adapterPayload?.domSelector === 'string' ? adapterPayload.domSelector : undefined),
        label: selectedAction?.label ?? selection.step.targetLabel,
        reason: selection.reason,
        quality: 'startup-flow',
        explanation: `UI Journey Bot chose ${actionType} because it is the next configured step in the ${selection.flow.name} flow.`,
        nextLikelyAction,
        seed: input.seed
      },
      requestedAt: input.now
    };
  }
}
