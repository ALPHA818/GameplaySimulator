import type {
  BotLaunchPlan,
  BotTestDirective,
  BotTestDirectiveMode,
  BotTestDirectivePriority,
  BotTestDirectiveType,
  BotProfile,
  BotPoolConfig,
  GameProfile,
  RunMode,
  RuntimeViabilityReport,
  SessionLabel,
  SimulationRunConfig
} from '@core/types';
import { BotTestDirectiveSchema, SimulationRunConfigSchema } from '@core/types';
import { resolveBotPools } from '@core/bot/BotPoolResolver';
import {
  firstTestTemplates,
  isFirstTestTemplateCompatible,
  recommendedFirstTestTemplate
} from '@core/config/firstTestTemplates';
import type { FirstTestTemplate, FirstTestTemplateId } from '@core/config/firstTestTemplates';
import {
  createFocusedTestDirective,
  focusedTestTemplates,
  type FocusedTestTemplate,
  type FocusedTestTemplateId
} from '@core/config/focusedTestTemplates';
import { botCompatibilityEvaluator } from '@core/bot/BotCompatibilityEvaluator';
import {
  resolveRuntimeObservationConfig,
  type ObservationMode,
  type RuntimeObservationConfig
} from '@core/config/runtimeObservationConfig';
import { planGameInstances } from '@core/sessions/GameInstanceManager';
import { Pause, Pencil, Play, Plus, RotateCw, ShieldCheck, Square, Trash2, X } from 'lucide-react';
import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  FieldLabel,
  SelectInput,
  TextareaInput,
  TextInput,
  ToggleInput
} from '../components/FormFields';
import { createBotPoolFromProfile, createDefaultBotPools, useConfigStore } from '../store/configStore';
import { useSessionStore } from '../store/sessionStore';
import { pollRuntimeDetails } from '../runtimePolling';
import type { FieldErrors } from '../utils/forms';
import { optionalText, zodFieldErrors } from '../utils/forms';

interface RunFormState {
  sessionId: string;
  sessionLabel: SessionLabel;
  gameProfileId: string;
  runMode: RunMode;
  runUntilStopped: boolean;
  maxRuntimeMinutes: string;
  stopOnCriticalIssue: boolean;
  saveScreenshots: boolean;
  saveVideo: boolean;
  screenshotEveryNActions: string;
  startupFlowId: string;
  continueOnStartupFlowFailure: boolean;
  startupFlowTimeoutSeconds: string;
  saveActionTimeline: boolean;
  saveStateSnapshots: boolean;
  botPools: BotPoolConfig[];
  globalBotLimit: number;
  perGameInstanceBotLimit: number;
  actionDelayMs: number;
  maxActionsPerBot: string;
  maxCpuPercent: number;
  maxRamPercent: number;
  maxGpuPercent: string;
  reserveRamMb: number;
  maxGameInstances: number;
  allowAutoScaling: boolean;
  useGlobalObservationSettings: boolean;
  showBotGameplay: boolean;
  observationMode: ObservationMode;
  selectedObservationBotId: string;
  bringGameToFrontOnAction: boolean;
  visibleActionDelayMs: number;
  showActionInformation: boolean;
  maxVisibleGameWindows: number;
  controlledNetworkTestConfirmed: boolean;
  saveMigrationTestPaths: string;
  approvedFileTestDirectories: string;
  directives: BotTestDirective[];
}

type DirectiveAssignmentMode = 'all-bots' | 'bot' | 'profile' | 'instance';

interface DirectiveDraft {
  templateId: DirectiveTemplateId;
  name: string;
  description: string;
  directiveType: BotTestDirectiveType;
  directiveMode: BotTestDirectiveMode;
  priority: BotTestDirectivePriority;
  assignmentMode: DirectiveAssignmentMode;
  targetBotId: string;
  targetProfileId: string;
  targetInstanceId: string;
  actionKeywords: string;
  avoidedActionKeywords: string;
  sceneOrArea: string;
  targetUiFlowId: string;
  targetIssueId: string;
  successCondition: string;
  maxActions: string;
  maxAttempts: string;
  timeoutSeconds: string;
  repeatUntilSuccess: boolean;
  manualSuccessConfirmation: boolean;
}

type DirectiveTemplateId =
  | 'menu'
  | 'button'
  | 'area'
  | 'feature'
  | 'repeat-action'
  | 'reproduce-issue'
  | 'sequence'
  | 'setting'
  | 'save-load'
  | 'controls';

interface DirectiveTemplate {
  id: DirectiveTemplateId;
  name: string;
  description: string;
  draft: Partial<DirectiveDraft>;
}

const directiveTemplates: DirectiveTemplate[] = [
  {
    id: 'menu',
    name: 'Test this menu',
    description: 'Guides a UI bot toward opening, closing, and using one menu.',
    draft: {
      name: 'Test a game menu',
      description: 'Open the menu, use its main controls, close it, and check that it still works.',
      directiveType: 'feature',
      directiveMode: 'focus',
      actionKeywords: 'open-menu, close-menu, confirm, cancel',
      targetProfileId: 'ui-tester-bot',
      successCondition: 'The menu opens, accepts input, and closes normally.'
    }
  },
  {
    id: 'button',
    name: 'Test this button',
    description: 'Requests one exact button or action that the game reports as available.',
    draft: {
      name: 'Test one button',
      description: 'Use this button once and check that the expected result happens.',
      directiveType: 'action',
      directiveMode: 'force-next-valid-action',
      actionKeywords: 'button-action',
      successCondition: 'The button action succeeds.'
    }
  },
  {
    id: 'area',
    name: 'Test this game area',
    description: 'Focuses exploration on one scene, level, room, or map area.',
    draft: {
      name: 'Explore a game area',
      description: 'Move through this area, interact with nearby objects, and look for blocked paths.',
      directiveType: 'area',
      directiveMode: 'focus',
      targetProfileId: 'explorer-bot',
      sceneOrArea: 'Area name',
      actionKeywords: 'move, explore, inspect, interact',
      successCondition: 'The bot visits and tests the named area.'
    }
  },
  {
    id: 'feature',
    name: 'Test this feature',
    description: 'Strongly guides a suitable bot toward one game feature.',
    draft: {
      name: 'Test inventory sorting',
      description: 'Open the inventory, sort items, move items between slots, and check that no items disappear.',
      directiveType: 'feature',
      directiveMode: 'focus',
      targetProfileId: 'inventory-stress-tester-bot',
      actionKeywords: 'inventory, sort, move-item, item-slot',
      avoidedActionKeywords: 'close-game',
      successCondition: 'Inventory opens and at least three inventory actions succeed.',
      maxActions: '30'
    }
  },
  {
    id: 'repeat-action',
    name: 'Repeat this action',
    description: 'Repeats a supported action until a result, limit, or timeout is reached.',
    draft: {
      name: 'Repeat one action',
      description: 'Repeat this action and watch for inconsistent results.',
      directiveType: 'action',
      directiveMode: 'repeat-until-condition',
      actionKeywords: 'action-name',
      repeatUntilSuccess: true,
      successCondition: 'The requested result happens.',
      maxAttempts: '5'
    }
  },
  {
    id: 'reproduce-issue',
    name: 'Try to reproduce an issue',
    description: 'Focuses a bot on repeating the conditions from a known issue.',
    draft: {
      name: 'Reproduce a known issue',
      description: 'Repeat the actions that happened before the issue and check whether it happens again.',
      directiveType: 'issue-reproduction',
      directiveMode: 'focus',
      targetIssueId: 'issue-id',
      successCondition: 'The same issue is detected again.'
    }
  },
  {
    id: 'sequence',
    name: 'Follow this sequence',
    description: 'Runs the listed supported actions in order.',
    draft: {
      name: 'Follow an action sequence',
      description: 'Perform these actions in order and check the final result.',
      directiveType: 'sequence',
      directiveMode: 'guided-sequence',
      actionKeywords: 'open-menu, choose-option, confirm',
      successCondition: 'Every sequence step succeeds.'
    }
  },
  {
    id: 'setting',
    name: 'Test this setting',
    description: 'Guides a UI bot toward changing and checking one setting.',
    draft: {
      name: 'Test one game setting',
      description: 'Open settings, change this value, apply it, and check that it stays changed.',
      directiveType: 'feature',
      directiveMode: 'focus',
      targetProfileId: 'ui-tester-bot',
      actionKeywords: 'settings, change-setting, apply, confirm',
      successCondition: 'The setting changes and keeps its new value.'
    }
  },
  {
    id: 'save-load',
    name: 'Test saving and loading',
    description: 'Guides a save/load bot through supported save and reload actions.',
    draft: {
      name: 'Test saving and loading',
      description: 'Save the game, change progress, load the save, and check that the earlier state returns.',
      directiveType: 'feature',
      directiveMode: 'focus',
      targetProfileId: 'save-load-tester-bot',
      actionKeywords: 'save-game, load-save, load-checkpoint',
      successCondition: 'The saved state loads without losing or changing data.'
    }
  },
  {
    id: 'controls',
    name: 'Test controls',
    description: 'Guides a bot toward the controls configured in the game profile.',
    draft: {
      name: 'Test game controls',
      description: 'Try the main movement, interaction, menu, and action controls.',
      directiveType: 'feature',
      directiveMode: 'focus',
      actionKeywords: 'move, interact, jump, menu',
      successCondition: 'The configured controls produce the expected game actions.'
    }
  }
];

const runModes: Array<{ value: RunMode; label: string }> = [
  { value: 'parallel', label: 'Parallel' },
  { value: 'sequential', label: 'Sequential' },
  { value: 'hybrid', label: 'Hybrid' }
];

const sessionLabels: SessionLabel[] = ['Smoke Test', 'Regression', 'UI Flow', 'Stress Test', 'Custom'];

const observationModes: Array<{ value: ObservationMode; label: string }> = [
  { value: 'background', label: 'Background' },
  { value: 'follow-first-bot', label: 'Follow first bot' },
  { value: 'follow-selected-bot', label: 'Follow selected bot' },
  { value: 'show-all-instances', label: 'Show all instances' }
];

function blankDirectiveDraft(): DirectiveDraft {
  const featureTemplate = directiveTemplates.find((template) => template.id === 'feature')!;

  return {
    templateId: 'feature',
    name: '',
    description: '',
    directiveType: 'feature',
    directiveMode: 'focus',
    priority: 'normal',
    assignmentMode: 'profile',
    targetBotId: '',
    targetProfileId: '',
    targetInstanceId: '',
    actionKeywords: '',
    avoidedActionKeywords: '',
    sceneOrArea: '',
    targetUiFlowId: '',
    targetIssueId: '',
    successCondition: '',
    maxActions: '30',
    maxAttempts: '3',
    timeoutSeconds: '120',
    repeatUntilSuccess: false,
    manualSuccessConfirmation: false,
    ...featureTemplate.draft
  };
}

function applyDirectiveTemplate(draft: DirectiveDraft, templateId: DirectiveTemplateId): DirectiveDraft {
  const template = directiveTemplates.find((item) => item.id === templateId)!;

  return {
    ...blankDirectiveDraft(),
    assignmentMode: draft.assignmentMode,
    targetBotId: draft.targetBotId,
    targetInstanceId: draft.targetInstanceId,
    priority: draft.priority,
    ...template.draft,
    templateId
  };
}

function directiveToDraft(directive: BotTestDirective): DirectiveDraft {
  const assignmentMode: DirectiveAssignmentMode = directive.target.allBots
    ? 'all-bots'
    : directive.target.botIds.length > 0
      ? 'bot'
      : directive.target.gameInstanceIds.length > 0
        ? 'instance'
        : 'profile';

  return {
    ...blankDirectiveDraft(),
    templateId: directive.directiveType === 'issue-reproduction' ? 'reproduce-issue' : 'feature',
    name: directive.name,
    description: directive.description,
    directiveType: directive.directiveType,
    directiveMode: directive.directiveMode,
    priority: directive.priority,
    assignmentMode,
    targetBotId: directive.target.botIds[0] ?? '',
    targetProfileId: directive.target.profileIds[0] ?? '',
    targetInstanceId: directive.target.gameInstanceIds[0] ?? '',
    actionKeywords: directive.actionKeywords.join(', '),
    avoidedActionKeywords: directive.avoidedActionKeywords.join(', '),
    sceneOrArea: directive.targetScene ?? directive.targetArea ?? '',
    targetUiFlowId: directive.targetUiFlowId ?? '',
    targetIssueId: directive.targetIssueId ?? '',
    successCondition: directive.successConditions[0] ?? '',
    maxActions: directive.maxActions ? String(directive.maxActions) : '',
    maxAttempts: directive.maxAttempts ? String(directive.maxAttempts) : '',
    timeoutSeconds: directive.timeoutMs ? String(Math.ceil(directive.timeoutMs / 1_000)) : '',
    repeatUntilSuccess: directive.repeatUntilSuccess,
    manualSuccessConfirmation: directive.manualSuccessConfirmation ?? false
  };
}

function splitDirectiveKeywords(value: string): string[] {
  return [...new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))];
}

function safeDirectiveStepId(actionType: string, index: number): string {
  const slug = actionType.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug || 'step'}-${index + 1}`;
}

function buildDirectiveFromDraft(
  draft: DirectiveDraft,
  sessionId: string,
  directiveId: string,
  createdAt: string
): unknown {
  const actionKeywords = splitDirectiveKeywords(draft.actionKeywords);
  const maxAttempts = optionalText(draft.maxAttempts) ? Number(draft.maxAttempts) : undefined;
  const successCondition = draft.successCondition.trim();
  const target = {
    allBots: draft.assignmentMode === 'all-bots',
    botIds: draft.assignmentMode === 'bot' && draft.targetBotId ? [draft.targetBotId] : [],
    profileIds:
      draft.assignmentMode === 'profile' && draft.targetProfileId ? [draft.targetProfileId] : [],
    gameInstanceIds:
      draft.assignmentMode === 'instance' && draft.targetInstanceId
        ? [draft.targetInstanceId]
        : []
  };

  return {
    directiveId,
    sessionId,
    name: draft.name.trim(),
    description: draft.description.trim(),
    directiveType: draft.directiveType,
    directiveMode: draft.directiveMode,
    priority: draft.priority,
    status: 'queued',
    target,
    actionKeywords,
    avoidedActionKeywords: splitDirectiveKeywords(draft.avoidedActionKeywords),
    targetFeature: draft.directiveType === 'feature' ? draft.name.trim() : undefined,
    targetScene: draft.directiveType === 'scene' ? draft.sceneOrArea.trim() || undefined : undefined,
    targetArea: draft.directiveType === 'area' ? draft.sceneOrArea.trim() || undefined : undefined,
    targetUiFlowId:
      draft.directiveType === 'ui-flow' ? draft.targetUiFlowId.trim() || undefined : undefined,
    targetIssueId:
      draft.directiveType === 'issue-reproduction'
        ? draft.targetIssueId.trim() || undefined
        : undefined,
    expectedState:
      draft.directiveType === 'game-state' && successCondition
        ? { condition: successCondition }
        : undefined,
    successConditions: successCondition ? [successCondition] : [],
    failureConditions: [],
    steps:
      draft.directiveMode === 'guided-sequence'
        ? actionKeywords.map((actionType, index) => ({
            stepId: safeDirectiveStepId(actionType, index),
            name: `Step ${index + 1}: ${actionType}`,
            description: `Perform the reported ${actionType} action.`,
            actionType,
            actionKeywords: [actionType],
            successCondition:
              index === actionKeywords.length - 1 && successCondition
                ? successCondition
                : `${actionType} succeeds.`,
            maxAttempts: maxAttempts ?? 3,
            waitAfterMs: 250
          }))
        : [],
    maxActions: optionalText(draft.maxActions) ? Number(draft.maxActions) : undefined,
    maxAttempts,
    timeoutMs: optionalText(draft.timeoutSeconds)
      ? Number(draft.timeoutSeconds) * 1000
      : undefined,
    repeatUntilSuccess: draft.repeatUntilSuccess,
    manualSuccessConfirmation: draft.manualSuccessConfirmation,
    createdAt,
    createdBy: 'user'
  };
}

function directiveTargetSummary(
  directive: BotTestDirective,
  botProfiles: BotProfile[]
): string {
  if (directive.target.allBots) {
    return 'all enabled bots';
  }
  if (directive.target.botIds.length > 0) {
    return directive.target.botIds.join(', ');
  }
  if (directive.target.profileIds.length > 0) {
    return directive.target.profileIds
      .map(
        (profileId) =>
          botProfiles.find((profile) => profile.profileId === profileId)?.displayName ?? profileId
      )
      .join(', ');
  }
  return directive.target.gameInstanceIds.join(', ') || 'no target';
}

function directivePreviewText(directive: BotTestDirective, botProfiles: BotProfile[]): string {
  const strength =
    directive.directiveMode === 'influence'
      ? 'gently guide'
      : directive.directiveMode === 'focus'
        ? 'strongly guide'
        : directive.directiveMode === 'force-next-valid-action'
          ? 'request one exact available action from'
          : directive.directiveMode === 'guided-sequence'
            ? 'guide'
            : 'repeatedly guide';
  const subject = directiveTargetSummary(directive, botProfiles);
  const actionLimit = directive.maxActions ? ` for up to ${directive.maxActions} actions` : '';
  const firstKeyword = directive.actionKeywords[0]?.replace(/[-_]+/g, ' ');
  const topic =
    directive.directiveType === 'feature' && firstKeyword
      ? `${firstKeyword}-related actions`
      : directive.targetScene ??
        directive.targetArea ??
        directive.targetFeature ??
        firstKeyword ??
        directive.name.toLowerCase();

  return `This direction will ${strength} ${subject} toward ${topic}${actionLimit}.`;
}

function observationSupportMessage(gameProfile: GameProfile | undefined): string {
  if (!gameProfile) {
    return 'Choose a game profile to see whether its adapter can show a game window.';
  }

  const adapterType = gameProfile.adapter.type;
  const isEngine = adapterType === 'unity' || adapterType === 'godot' || adapterType === 'unreal';
  const usesInstrumentation = Boolean(gameProfile.adapter.instrumentationEndpoint?.trim());

  if (adapterType === 'browser') {
    return 'This browser adapter can open a visible game window. Visible windows increase CPU, RAM, and screen use.';
  }

  if (adapterType === 'desktop' || adapterType === 'rpg_maker' || adapterType === 'gamemaker' || (isEngine && !usesInstrumentation)) {
    return 'This game is already running in a visible desktop window. Enable Bring Game To Front On Action only when you want the simulator to focus it.';
  }

  if (adapterType === 'instrumented' || (isEngine && usesInstrumentation)) {
    return gameProfile.launch.executablePath?.trim()
      ? 'This instrumented target uses an external game window that the simulator can try to focus safely through the operating system.'
      : 'This instrumented target has no visible game window. The test runs through state, logs, and screenshots when available.';
  }

  return 'The test is running, but only logs and screenshots can be viewed unless the custom adapter explicitly adds observation support.';
}

function botPoolForTemplate(template: FirstTestTemplate, botProfiles: BotProfile[]): BotPoolConfig | null {
  const profile = botProfiles.find((item) => item.profileId === template.botProfileId);

  if (!profile) {
    return null;
  }

  return {
    profileId: profile.profileId,
    enabled: true,
    minCount: 1,
    desiredCount: 1,
    maxCount: 1,
    scalingMode: 'fixed',
    priority: 100,
    resourceWeight: template.resourceWeight,
    notes: `Applied by ${template.name}.`
  };
}

function applyTemplateToForm(
  current: RunFormState,
  template: FirstTestTemplate,
  gameProfile: GameProfile,
  botProfiles: BotProfile[]
): RunFormState | null {
  const botPool = botPoolForTemplate(template, botProfiles);

  if (!botPool) {
    return null;
  }

  const screenshotsEnabled =
    template.saveScreenshots === 'on' || gameProfile.adapter.supportsScreenshots;
  const startupFlowId = template.recommendStartupFlow ? (gameProfile.uiFlows[0]?.flowId ?? '') : '';

  return {
    ...current,
    sessionLabel: 'Smoke Test',
    gameProfileId: gameProfile.gameId,
    runMode: 'sequential',
    runUntilStopped: false,
    maxRuntimeMinutes: '15',
    stopOnCriticalIssue: true,
    saveScreenshots: screenshotsEnabled,
    saveVideo: false,
    screenshotEveryNActions: screenshotsEnabled ? String(template.actionCount) : '',
    startupFlowId,
    continueOnStartupFlowFailure: false,
    startupFlowTimeoutSeconds: '60',
    saveActionTimeline: true,
    saveStateSnapshots: template.saveStateSnapshots,
    botPools: [botPool],
    globalBotLimit: 1,
    perGameInstanceBotLimit: 1,
    actionDelayMs: template.actionDelayMs,
    maxActionsPerBot: String(template.actionCount),
    maxCpuPercent: 70,
    maxRamPercent: 70,
    maxGpuPercent: '75',
    reserveRamMb: 2048,
    maxGameInstances: 1,
    allowAutoScaling: false,
    useGlobalObservationSettings: false,
    showBotGameplay: template.observationPreference !== 'background',
    observationMode:
      template.observationPreference === 'background'
        ? 'background'
        : 'follow-first-bot',
    selectedObservationBotId: '',
    bringGameToFrontOnAction: false,
    visibleActionDelayMs: template.actionDelayMs,
    showActionInformation: true,
    maxVisibleGameWindows: 1,
    controlledNetworkTestConfirmed: false,
    saveMigrationTestPaths: '',
    approvedFileTestDirectories: '',
    directives: current.directives
  };
}

function applyFocusedTemplateToForm(
  current: RunFormState,
  template: FocusedTestTemplate,
  gameProfile: GameProfile,
  botProfiles: BotProfile[],
  directive: BotTestDirective
): RunFormState | null {
  const profile = botProfiles.find((item) => item.profileId === template.botProfileId);

  if (!profile) {
    return null;
  }

  const screenshotsEnabled = template.saveScreenshots && gameProfile.adapter.supportsScreenshots;
  const pool: BotPoolConfig = {
    profileId: profile.profileId,
    enabled: true,
    minCount: 1,
    desiredCount: 1,
    maxCount: 1,
    scalingMode: 'fixed',
    priority: 100,
    resourceWeight: template.resourceWeight,
    notes: `Applied by ${template.name}.`
  };

  return {
    ...current,
    sessionLabel: template.sessionLabel,
    runMode: 'sequential',
    runUntilStopped: false,
    maxRuntimeMinutes: String(template.runtimeMinutes),
    stopOnCriticalIssue: true,
    saveScreenshots: screenshotsEnabled,
    saveVideo: false,
    screenshotEveryNActions: screenshotsEnabled ? String(template.actionCount) : '',
    saveActionTimeline: true,
    saveStateSnapshots: template.saveStateSnapshots && gameProfile.adapter.supportsStateRead,
    botPools: [pool],
    globalBotLimit: 1,
    perGameInstanceBotLimit: 1,
    actionDelayMs: template.actionDelayMs,
    maxActionsPerBot: String(template.actionCount),
    maxCpuPercent: 70,
    maxRamPercent: 70,
    maxGpuPercent: '75',
    reserveRamMb: 2048,
    maxGameInstances: 1,
    allowAutoScaling: false,
    useGlobalObservationSettings: false,
    showBotGameplay: !template.backgroundPreferred,
    observationMode: template.backgroundPreferred ? 'background' : 'follow-first-bot',
    selectedObservationBotId: '',
    bringGameToFrontOnAction: false,
    visibleActionDelayMs: template.actionDelayMs,
    showActionInformation: true,
    maxVisibleGameWindows: 1,
    directives: [directive]
  };
}

function initialRunFormState(
  gameProfile: GameProfile | undefined,
  botProfiles: BotProfile[],
  runtimeObservation: RuntimeObservationConfig
): RunFormState {
  const base: RunFormState = {
    sessionId: `session-${Date.now()}`,
    sessionLabel: 'Smoke Test',
    gameProfileId: gameProfile?.gameId ?? '',
    runMode: 'sequential',
    runUntilStopped: false,
    maxRuntimeMinutes: '15',
    stopOnCriticalIssue: true,
    saveScreenshots: gameProfile?.adapter.supportsScreenshots ?? true,
    saveVideo: false,
    screenshotEveryNActions: '20',
    startupFlowId: '',
    continueOnStartupFlowFailure: false,
    startupFlowTimeoutSeconds: '60',
    saveActionTimeline: true,
    saveStateSnapshots: false,
    botPools: [],
    globalBotLimit: 1,
    perGameInstanceBotLimit: 1,
    actionDelayMs: 650,
    maxActionsPerBot: '20',
    maxCpuPercent: 70,
    maxRamPercent: 70,
    maxGpuPercent: '75',
    reserveRamMb: 2048,
    maxGameInstances: 1,
    allowAutoScaling: false,
    useGlobalObservationSettings: true,
    showBotGameplay: runtimeObservation.showBotGameplay,
    observationMode: runtimeObservation.observationMode,
    selectedObservationBotId: runtimeObservation.selectedBotId ?? '',
    bringGameToFrontOnAction: runtimeObservation.bringGameToFrontOnAction,
    visibleActionDelayMs: runtimeObservation.visibleActionDelayMs,
    showActionInformation: runtimeObservation.showActionInformation,
    maxVisibleGameWindows: runtimeObservation.maxVisibleGameWindows,
    controlledNetworkTestConfirmed: false,
    saveMigrationTestPaths: '',
    approvedFileTestDirectories: '',
    directives: []
  };
  const template = gameProfile ? recommendedFirstTestTemplate(gameProfile) : undefined;

  if (!gameProfile || !template) {
    return {
      ...base,
      botPools: createDefaultBotPools(botProfiles).slice(0, 1).map((pool) => ({
        ...pool,
        minCount: 1,
        desiredCount: 1,
        maxCount: 1,
        scalingMode: 'fixed'
      }))
    };
  }

  return applyTemplateToForm(base, template, gameProfile, botProfiles) ?? base;
}

function numericInput(value: string): number {
  return value === '' ? 0 : Number(value);
}

function pathList(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((path) => path.trim())
    .filter(Boolean);
}

function buildRunConfig(form: RunFormState, adapterType: SimulationRunConfig['adapterType']): SimulationRunConfig {
  return {
    sessionId: form.sessionId.trim(),
    sessionLabel: form.sessionLabel,
    gameProfilePath: `memory://game-profiles/${form.gameProfileId}`,
    adapterType,
    runMode: form.runMode,
    runUntilStopped: form.runUntilStopped,
    maxRuntimeMinutes: optionalText(form.maxRuntimeMinutes)
      ? Number(form.maxRuntimeMinutes)
      : undefined,
    stopOnCriticalIssue: form.stopOnCriticalIssue,
    saveScreenshots: form.saveScreenshots,
    saveVideo: form.saveVideo,
    screenshotEveryNActions: optionalText(form.screenshotEveryNActions)
      ? Number(form.screenshotEveryNActions)
      : undefined,
    startupFlowId: optionalText(form.startupFlowId),
    continueOnStartupFlowFailure: form.continueOnStartupFlowFailure,
    startupFlowTimeoutMs: optionalText(form.startupFlowTimeoutSeconds)
      ? Math.max(1, Number(form.startupFlowTimeoutSeconds)) * 1000
      : undefined,
    saveActionTimeline: form.saveActionTimeline,
    saveStateSnapshots: form.saveStateSnapshots,
    ...(form.useGlobalObservationSettings
      ? {}
      : {
          showBotGameplay: form.showBotGameplay,
          observationMode: form.showBotGameplay ? form.observationMode : 'background',
          selectedObservationBotId: optionalText(form.selectedObservationBotId),
          bringGameToFrontOnAction:
            form.showBotGameplay && form.bringGameToFrontOnAction,
          visibleActionDelayMs: form.visibleActionDelayMs,
          showActionInformation: form.showActionInformation,
          maxVisibleGameWindows: form.maxVisibleGameWindows
        }),
    botPools: form.botPools,
    globalBotLimit: form.globalBotLimit,
    perGameInstanceBotLimit: form.perGameInstanceBotLimit,
    actionDelayMs: form.actionDelayMs,
    maxActionsPerBot: optionalText(form.maxActionsPerBot) ? Number(form.maxActionsPerBot) : undefined,
    directives: form.directives.map((directive) => ({
      ...directive,
      sessionId: form.sessionId.trim()
    })),
    technicalTesting: {
      controlledNetworkTestConfirmed: form.controlledNetworkTestConfirmed,
      saveMigrationTestPaths: pathList(form.saveMigrationTestPaths),
      approvedFileTestDirectories: pathList(form.approvedFileTestDirectories)
    },
    resourceLimits: {
      maxCpuPercent: form.maxCpuPercent,
      maxRamPercent: form.maxRamPercent,
      maxGpuPercent: optionalText(form.maxGpuPercent) ? Number(form.maxGpuPercent) : undefined,
      reserveRamMb: form.reserveRamMb,
      maxGameInstances: form.maxGameInstances,
      allowAutoScaling: form.allowAutoScaling
    }
  };
}

function countRequestedBots(config: SimulationRunConfig): number {
  return config.botPools.reduce((total, pool) => total + (pool.enabled ? pool.desiredCount : 0), 0);
}

function applyResolvedAutoCounts(
  config: SimulationRunConfig,
  launchPlans: BotLaunchPlan[]
): SimulationRunConfig {
  const resolvedCounts = launchPlans.reduce<Map<string, number>>((counts, plan) => {
    counts.set(plan.profileId, (counts.get(plan.profileId) ?? 0) + 1);
    return counts;
  }, new Map());

  return {
    ...config,
    botPools: config.botPools.map((pool) => {
      if (pool.scalingMode !== 'auto') {
        return pool;
      }

      const resolvedCount = resolvedCounts.get(pool.profileId) ?? 0;

      return {
        ...pool,
        minCount: Math.min(pool.minCount, resolvedCount),
        desiredCount: resolvedCount
      };
    })
  };
}

export function NewSessionPage() {
  const gameProfiles = useConfigStore((state) => state.gameProfiles);
  const botProfiles = useConfigStore((state) => state.botProfiles);
  const runtimeObservation = useConfigStore((state) => state.runtimeObservation);
  const saveRunConfig = useConfigStore((state) => state.saveRunConfig);
  const pendingSessionBotProfileId = useConfigStore((state) => state.pendingSessionBotProfileId);
  const pendingSessionBotProfileIds = useConfigStore((state) => state.pendingSessionBotProfileIds);
  const clearPendingSessionBotProfile = useConfigStore((state) => state.clearPendingSessionBotProfile);
  const clearPendingSessionBotProfiles = useConfigStore((state) => state.clearPendingSessionBotProfiles);
  const openGameProfileEditor = useConfigStore((state) => state.openGameProfileEditor);
  const setSessionPreview = useSessionStore((state) => state.setSessionPreview);
  const sessionStatus = useSessionStore((state) => state.status);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const runtimeBotStatuses = useSessionStore((state) => state.botStatuses);
  const runtimeInstanceStatuses = useSessionStore((state) => state.instanceStatuses);
  const runtimeIssues = useSessionStore((state) => state.issues);
  const runtimeLogs = useSessionStore((state) => state.logs);
  const selectedReviewIssueId = useSessionStore((state) => state.reviewIssueId);
  const applySessionSnapshot = useSessionStore((state) => state.applySessionSnapshot);
  const applyRuntimeDetails = useSessionStore((state) => state.applyRuntimeDetails);
  const setRuntimeWarnings = useSessionStore((state) => state.setRuntimeWarnings);
  const initialGameProfile = gameProfiles[0];
  const initialTemplate = initialGameProfile ? recommendedFirstTestTemplate(initialGameProfile) : undefined;
  const [form, setForm] = useState<RunFormState>(() =>
    initialRunFormState(initialGameProfile, botProfiles, runtimeObservation)
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState<FirstTestTemplateId>(
    initialTemplate?.id ?? 'browser-smoke-test'
  );
  const [selectedFocusedTemplateId, setSelectedFocusedTemplateId] =
    useState<FocusedTestTemplateId>('test-crafting-system');
  const [templateApplyMessage, setTemplateApplyMessage] = useState<string | null>(
    initialTemplate ? `${initialTemplate.name} safe settings are ready.` : null
  );
  const [focusedTemplateApplyMessage, setFocusedTemplateApplyMessage] =
    useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [validatedConfig, setValidatedConfig] = useState<SimulationRunConfig | null>(null);
  const [viabilityReport, setViabilityReport] = useState<RuntimeViabilityReport | null>(null);
  const [viabilityError, setViabilityError] = useState<string | null>(null);
  const [adapterValidationErrors, setAdapterValidationErrors] = useState<string[]>([]);
  const [adapterValidationWarnings, setAdapterValidationWarnings] = useState<string[]>([]);
  const [runAnyway, setRunAnyway] = useState(false);
  const [addPoolProfileId, setAddPoolProfileId] = useState('');
  const [startupFlowTestResult, setStartupFlowTestResult] = useState<string | null>(null);
  const [directiveDraft, setDirectiveDraft] = useState<DirectiveDraft>(() => blankDirectiveDraft());
  const [editingDirectiveId, setEditingDirectiveId] = useState<string | null>(null);
  const [directiveError, setDirectiveError] = useState<string | null>(null);
  const selectedProfile = gameProfiles.find((profile) => profile.gameId === form.gameProfileId);
  const adapterType = selectedProfile?.adapter.type ?? 'custom';
  const observationSupport = observationSupportMessage(selectedProfile);
  const videoSupported = false;
  const canPause = activeSessionId !== null && sessionStatus === 'running';
  const canResume = activeSessionId !== null && sessionStatus === 'paused';
  const canStop =
    activeSessionId !== null && ['created', 'starting', 'running', 'paused'].includes(sessionStatus);
  const availableBotProfiles = botProfiles.filter(
    (profile) => !form.botPools.some((pool) => pool.profileId === profile.profileId)
  );
  const profileIdToAdd = addPoolProfileId || availableBotProfiles[0]?.profileId || '';
  const startupFlowOptions = selectedProfile?.uiFlows ?? [];
  const selectedStartupFlow = startupFlowOptions.find((flow) => flow.flowId === form.startupFlowId);
  const selectedTemplate =
    firstTestTemplates.find((template) => template.id === selectedTemplateId) ?? firstTestTemplates[0];
  const selectedFocusedTemplate =
    focusedTestTemplates.find((template) => template.id === selectedFocusedTemplateId) ??
    focusedTestTemplates[0];
  const selectedFocusedBotProfile = botProfiles.find(
    (profile) => profile.profileId === selectedFocusedTemplate.botProfileId
  );
  const focusedBotCompatibility =
    selectedProfile && selectedFocusedBotProfile
      ? botCompatibilityEvaluator.evaluate(selectedFocusedBotProfile, selectedProfile)
      : null;
  const templateCompatible = selectedProfile
    ? isFirstTestTemplateCompatible(selectedTemplate, selectedProfile)
    : false;

  useEffect(() => {
    if (!pendingSessionBotProfileId) {
      return;
    }

    const profile = botProfiles.find((item) => item.profileId === pendingSessionBotProfileId);
    if (profile) {
      setForm((current) => {
        const existingIndex = current.botPools.findIndex(
          (pool) => pool.profileId === pendingSessionBotProfileId
        );
        if (existingIndex >= 0) {
          return {
            ...current,
            botPools: current.botPools.map((pool, index) =>
              index === existingIndex ? { ...pool, enabled: true } : pool
            )
          };
        }

        return {
          ...current,
          botPools: [
            ...current.botPools,
            createBotPoolFromProfile(profile, current.botPools.length, true)
          ]
        };
      });
      setTemplateApplyMessage(`${profile.displayName} added to this session.`);
    }
    clearPendingSessionBotProfile();
  }, [botProfiles, clearPendingSessionBotProfile, pendingSessionBotProfileId]);

  useEffect(() => {
    if (pendingSessionBotProfileIds.length === 0) {
      return;
    }

    const pendingProfiles = [...new Set(pendingSessionBotProfileIds)]
      .map((profileId) => botProfiles.find((profile) => profile.profileId === profileId))
      .filter((profile): profile is BotProfile => Boolean(profile));

    setForm((current) => {
      const existingIds = new Set(current.botPools.map((pool) => pool.profileId));
      const additions = pendingProfiles
        .filter((profile) => !existingIds.has(profile.profileId))
        .map((profile, index) =>
          createBotPoolFromProfile(profile, current.botPools.length + index, true)
        );

      return {
        ...current,
        botPools: [
          ...current.botPools.map((pool) =>
            pendingSessionBotProfileIds.includes(pool.profileId)
              ? { ...pool, enabled: true }
              : pool
          ),
          ...additions
        ]
      };
    });
    setTemplateApplyMessage(
      `${pendingProfiles.length} recommended bot profile${pendingProfiles.length === 1 ? '' : 's'} added to this session.`
    );
    clearPendingSessionBotProfiles();
  }, [
    botProfiles,
    clearPendingSessionBotProfiles,
    pendingSessionBotProfileIds
  ]);

  const preview = useMemo(
    () =>
      buildRunConfig(
        { ...form, saveVideo: videoSupported ? form.saveVideo : false },
        adapterType
      ),
    [adapterType, form, videoSupported]
  );
  const requestedBots = countRequestedBots(preview);
  const effectiveObservation = resolveRuntimeObservationConfig(preview, runtimeObservation);
  const screenshotEvery = optionalText(form.screenshotEveryNActions)
    ? Math.max(1, Number(form.screenshotEveryNActions))
    : undefined;
  const estimatedScreenshotCount =
    form.saveScreenshots && screenshotEvery
      ? requestedBots * Math.ceil((optionalText(form.maxActionsPerBot) ? Number(form.maxActionsPerBot) : 250) / screenshotEvery)
      : 0;
  const diskUsageWarning =
    form.saveScreenshots && screenshotEvery && (screenshotEvery < 10 || estimatedScreenshotCount > 300)
      ? `This setup may create about ${estimatedScreenshotCount} periodic screenshots before issue/recovery evidence. Use a larger number like 20 or 50 to save disk space.`
      : '';
  const resolvedLaunchPlans = useMemo<BotLaunchPlan[]>(() => {
    const parsed = SimulationRunConfigSchema.safeParse(preview);

    if (!parsed.success || !viabilityReport) {
      return [];
    }

    return resolveBotPools({
      runConfig: parsed.data,
      botProfiles,
      viabilityReport
    });
  }, [botProfiles, preview, viabilityReport]);
  const plannedGameInstances = useMemo(() => {
    const parsed = SimulationRunConfigSchema.safeParse(preview);

    if (!parsed.success || !selectedProfile || resolvedLaunchPlans.length === 0) {
      return null;
    }

    return planGameInstances({
      runConfig: parsed.data,
      gameProfile: selectedProfile,
      launchPlans: resolvedLaunchPlans,
      adapterCapabilities: {
        supportsMultipleInstances: selectedProfile.adapter.supportsMultipleInstances,
        supportsSaveIsolation: selectedProfile.adapter.supportsSaveIsolation
      }
    });
  }, [preview, resolvedLaunchPlans, selectedProfile]);
  const sharedSaveWarning =
    plannedGameInstances &&
    plannedGameInstances.instances.length > 1 &&
    (selectedProfile?.saveIsolation?.mode ?? 'none') === 'none'
      ? 'Multiple game instances are planned without save isolation. Bots may overwrite the same save/profile data.'
      : '';
  const plannedInstanceCount = plannedGameInstances?.instances.length ?? Math.max(
    1,
    Math.min(
      form.maxGameInstances,
      Math.ceil(requestedBots / Math.max(1, form.perGameInstanceBotLimit))
    )
  );
  const observationWarnings = effectiveObservation.showBotGameplay
    ? [
        ...(effectiveObservation.observationMode === 'show-all-instances'
          ? ['Showing all game instances can open several windows and cover your desktop.']
          : []),
        ...(effectiveObservation.observationMode === 'show-all-instances' &&
        plannedInstanceCount > effectiveObservation.maxVisibleGameWindows
          ? [
              `${plannedInstanceCount} game instances are requested, but only ${effectiveObservation.maxVisibleGameWindows} may be visible. The remaining instances will continue in the background when the adapter supports it.`
            ]
          : []),
        ...(requestedBots >= 5
          ? [
              `${requestedBots} bots are requested with visible gameplay. Visible windows can increase CPU and RAM use, so background mode is safer for a large run.`
            ]
          : [])
      ]
    : [];
  const directiveDraftResult = BotTestDirectiveSchema.safeParse(
    buildDirectiveFromDraft(
      directiveDraft,
      form.sessionId.trim() || 'session-preview',
      'direction-preview',
      '2026-01-01T00:00:00.000Z'
    )
  );
  const enabledPoolProfileIds = new Set(
    form.botPools.filter((pool) => pool.enabled && pool.desiredCount > 0).map((pool) => pool.profileId)
  );
  const hasNetworkTechnicalPool = enabledPoolProfileIds.has('network-resilience-tester-bot') ||
    enabledPoolProfileIds.has('multiplayer-session-tester-bot');
  const hasEndurancePool = enabledPoolProfileIds.has('memory-leak-endurance-tester-bot');
  const hasSaveMigrationPool = enabledPoolProfileIds.has('save-migration-tester-bot');
  const hasFilePermissionPool = enabledPoolProfileIds.has('file-permission-tester-bot');
  const hasTechnicalSafeguardPool = hasNetworkTechnicalPool || hasEndurancePool ||
    hasSaveMigrationPool || hasFilePermissionPool;
  const draftKeywords = splitDirectiveKeywords(directiveDraft.actionKeywords);
  const controlText = (selectedProfile?.controls ?? [])
    .map((control) =>
      [control.controlId, control.label, control.action, control.binding].filter(Boolean).join(' ')
    )
    .join(' ')
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  const hasMatchingControl =
    draftKeywords.length === 0 ||
    draftKeywords.some((keyword) => controlText.includes(keyword.toLowerCase().replace(/[\s_]+/g, '-')));
  const hasMatchingBot = (() => {
    switch (directiveDraft.assignmentMode) {
      case 'all-bots':
        return enabledPoolProfileIds.size > 0;
      case 'bot':
        return resolvedLaunchPlans.some((plan) => plan.botId === directiveDraft.targetBotId);
      case 'instance':
        return Boolean(
          plannedGameInstances?.instances.some(
            (instance) => instance.instanceId === directiveDraft.targetInstanceId
          )
        );
      case 'profile':
      default:
        return enabledPoolProfileIds.has(directiveDraft.targetProfileId);
    }
  })();
  const successCanBeMeasured = Boolean(
    selectedProfile?.adapter.supportsStateRead &&
      ['scene', 'area', 'ui-flow', 'game-state'].includes(directiveDraft.directiveType) &&
      directiveDraft.successCondition.trim()
  );
  const directiveWarnings = [
    ...(!hasMatchingBot
      ? ['No enabled bot currently matches this assignment. Add or enable the chosen bot pool before starting.']
      : []),
    ...(draftKeywords.length > 0 && !hasMatchingControl
      ? [
          'The requested action words do not appear in this game profile\'s controls. The adapter may still report them at runtime, but an exact action could be unavailable.'
        ]
      : []),
    ...(!selectedProfile?.adapter.supportsStateRead
      ? [
          'This adapter has weak state awareness. It may perform the actions but may not know whether the result happened.'
        ]
      : []),
    ...(!successCanBeMeasured && !directiveDraft.manualSuccessConfirmation
      ? [
          'This success condition cannot be measured reliably from the selected profile. Turn on Manual Success Confirmation if you will check the result in Live Session.'
        ]
      : [])
  ];

  useEffect(() => {
    let cancelled = false;
    const config = preview;
    const parsed = SimulationRunConfigSchema.safeParse(config);

    if (!parsed.success || !selectedProfile) {
      setViabilityReport(null);
      setViabilityError('Complete the run configuration to estimate viability.');
      setAdapterValidationErrors([]);
      setAdapterValidationWarnings([]);
      return;
    }

    setViabilityError(null);

    window.gameplaySimulator.simulation
      .estimateViability({ runConfig: parsed.data, gameProfile: selectedProfile, botProfiles, runtimeObservation })
      .then((report) => {
        if (!cancelled) {
          setViabilityReport(report);
          setRunAnyway(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setViabilityReport(null);
          setViabilityError('Resource estimate is unavailable.');
        }
      });

    window.gameplaySimulator.simulation
      .validateSessionConfig({ runConfig: parsed.data, gameProfile: selectedProfile, botProfiles, runtimeObservation })
      .then((validation) => {
        if (!cancelled) {
          setAdapterValidationErrors(validation.errors.map((error) => `${error.path}: ${error.message}`));
          setAdapterValidationWarnings(validation.warnings.map((warning) => `${warning.path}: ${warning.message}`));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAdapterValidationErrors(['Adapter profile validation is unavailable.']);
          setAdapterValidationWarnings([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [adapterType, botProfiles, form, runtimeObservation, selectedProfile, videoSupported]);

  function update<K extends keyof RunFormState>(key: K, value: RunFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === 'startupFlowId' || key === 'startupFlowTimeoutSeconds' || key === 'continueOnStartupFlowFailure') {
      setStartupFlowTestResult(null);
    }
  }

  function updatePool(index: number, patch: Partial<BotPoolConfig>) {
    setForm((current) => ({
      ...current,
      botPools: current.botPools.map((pool, poolIndex) =>
        poolIndex === index
          ? {
              ...pool,
              ...patch,
              ...(patch.scalingMode === 'fixed'
                ? {
                    minCount: patch.desiredCount ?? pool.desiredCount
                  }
                : {})
            }
          : pool
      )
    }));
  }

  function updateDirectiveDraft<K extends keyof DirectiveDraft>(key: K, value: DirectiveDraft[K]) {
    setDirectiveDraft((current) => ({ ...current, [key]: value }));
    setDirectiveError(null);
  }

  function selectDirectiveTemplate(templateId: DirectiveTemplateId) {
    setDirectiveDraft((current) => applyDirectiveTemplate(current, templateId));
    setDirectiveError(null);
  }

  function addDirective() {
    const directiveId =
      editingDirectiveId ?? `direction-${Date.now()}-${form.directives.length + 1}`;
    const result = BotTestDirectiveSchema.safeParse(
      buildDirectiveFromDraft(
        directiveDraft,
        form.sessionId.trim() || 'session-draft',
        directiveId,
        new Date().toISOString()
      )
    );

    if (!result.success) {
      const firstIssue = result.error.issues[0];
      setDirectiveError(
        firstIssue
          ? `${firstIssue.path.join('.') || 'Direction'}: ${firstIssue.message}`
          : 'Complete the direction before adding it.'
      );
      return;
    }

    setForm((current) => ({
      ...current,
      directives: editingDirectiveId
        ? current.directives.map((directive) =>
            directive.directiveId === editingDirectiveId ? result.data : directive
          )
        : [...current.directives, result.data]
    }));
    setDirectiveDraft((current) => ({
      ...blankDirectiveDraft(),
      assignmentMode: current.assignmentMode,
      targetBotId: current.targetBotId,
      targetProfileId: current.targetProfileId,
      targetInstanceId: current.targetInstanceId
    }));
    setEditingDirectiveId(null);
    setDirectiveError(null);
  }

  function editDirective(directive: BotTestDirective) {
    setDirectiveDraft(directiveToDraft(directive));
    setEditingDirectiveId(directive.directiveId);
    setDirectiveError(null);
  }

  function cancelDirectiveEdit() {
    setDirectiveDraft(blankDirectiveDraft());
    setEditingDirectiveId(null);
    setDirectiveError(null);
  }

  function removeDirective(directiveId: string) {
    setForm((current) => ({
      ...current,
      directives: current.directives.filter((directive) => directive.directiveId !== directiveId)
    }));
    if (editingDirectiveId === directiveId) {
      cancelDirectiveEdit();
    }
  }

  function addBotPool() {
    const profile = botProfiles.find((item) => item.profileId === profileIdToAdd);

    if (!profile) {
      return;
    }

    setForm((current) => ({
      ...current,
      botPools: [...current.botPools, createBotPoolFromProfile(profile, current.botPools.length, true)]
    }));
    setAddPoolProfileId('');
  }

  function removeBotPool(index: number) {
    setForm((current) => ({
      ...current,
      botPools: current.botPools.filter((_pool, poolIndex) => poolIndex !== index)
    }));
  }

  function applySelectedTemplate() {
    if (!selectedProfile) {
      setTemplateApplyMessage('Choose a game profile before applying a first-test template.');
      return;
    }

    if (!templateCompatible) {
      const recommended = recommendedFirstTestTemplate(selectedProfile);
      setTemplateApplyMessage(
        recommended
          ? `${selectedTemplate.name} does not match this profile. Choose ${recommended.name}.`
          : `${selectedTemplate.name} does not match this game profile.`
      );
      return;
    }

    const nextForm = applyTemplateToForm(
      form,
      selectedTemplate,
      selectedProfile,
      botProfiles
    );

    if (!nextForm) {
      setTemplateApplyMessage(`The ${selectedTemplate.botProfileId} profile is missing, so this template cannot be applied.`);
      return;
    }

    setForm(nextForm);
    setErrors({});
    setValidatedConfig(null);
    setRunAnyway(false);
    setStartupFlowTestResult(null);
    setTemplateApplyMessage(
      `${selectedTemplate.name} applied: one bot, ${selectedTemplate.actionCount} actions, one game instance, and video off.`
    );
  }

  function applySelectedFocusedTemplate() {
    if (!selectedProfile) {
      setFocusedTemplateApplyMessage('Choose a game profile before applying a focused test.');
      return;
    }

    if (!selectedFocusedBotProfile) {
      setFocusedTemplateApplyMessage(
        `The ${selectedFocusedTemplate.botProfileId} profile is missing, so this focused test cannot be applied.`
      );
      return;
    }

    const directive = createFocusedTestDirective({
      template: selectedFocusedTemplate,
      sessionId: form.sessionId.trim() || 'session-draft',
      directiveId: `focused-${selectedFocusedTemplate.id}-${Date.now()}`,
      createdAt: new Date().toISOString(),
      selectedIssueId: selectedReviewIssueId ?? undefined
    });
    const nextForm = applyFocusedTemplateToForm(
      form,
      selectedFocusedTemplate,
      selectedProfile,
      botProfiles,
      directive
    );

    if (!nextForm) {
      setFocusedTemplateApplyMessage('The focused test could not find its specialist bot profile.');
      return;
    }

    setForm(nextForm);
    setDirectiveDraft(blankDirectiveDraft());
    setEditingDirectiveId(null);
    setErrors({});
    setValidatedConfig(null);
    setRunAnyway(false);
    setFocusedTemplateApplyMessage(
      `${selectedFocusedTemplate.name} applied: ${selectedFocusedBotProfile.displayName}, one editable direction, ${selectedFocusedTemplate.actionCount} actions, and ${selectedFocusedTemplate.runtimeMinutes} minutes maximum.`
    );
  }

  function poolError(index: number, field: keyof BotPoolConfig): string | undefined {
    return errors[`botPools.${index}.${field}`];
  }

  function testStartupFlow() {
    if (!selectedProfile) {
      setStartupFlowTestResult('Choose a game profile before testing a startup flow.');
      return;
    }

    if (!form.startupFlowId) {
      setStartupFlowTestResult('No startup flow is selected. Normal bots will start after the game instances launch.');
      return;
    }

    const flow = selectedProfile.uiFlows.find((item) => item.flowId === form.startupFlowId);

    if (!flow) {
      setStartupFlowTestResult('The selected startup flow no longer exists on this game profile.');
      return;
    }

    if (flow.steps.length === 0) {
      setStartupFlowTestResult(`Startup flow "${flow.name}" has no steps. Add steps in the game profile before using it.`);
      return;
    }

    const timeoutSeconds = optionalText(form.startupFlowTimeoutSeconds)
      ? Math.max(1, Number(form.startupFlowTimeoutSeconds))
      : 60;

    setStartupFlowTestResult(
      `Startup flow "${flow.name}" is ready. It will run ${flow.steps.length} step${flow.steps.length === 1 ? '' : 's'} before normal bots start, with a ${timeoutSeconds} second timeout.`
    );
  }

  async function refreshRuntimeDetails(sessionId: string) {
    const status = await window.gameplaySimulator.simulation.getSessionStatus(sessionId);
    const result = await pollRuntimeDetails(window.gameplaySimulator.simulation, sessionId);

    applySessionSnapshot(status);
    applyRuntimeDetails(result.details);
    setRuntimeWarnings(result.warnings);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const config = buildRunConfig(
      { ...form, saveVideo: videoSupported ? form.saveVideo : false },
      adapterType
    );
    const result = SimulationRunConfigSchema.safeParse(config);

    if (!result.success) {
      setErrors(zodFieldErrors(result.error));
      setValidatedConfig(null);
      return;
    }

    if (!selectedProfile) {
      setErrors({ form: 'Choose a game profile before starting a session.' });
      setValidatedConfig(null);
      return;
    }

    if (!viabilityReport) {
      setErrors({ form: 'Wait for the resource estimate before creating the session config.' });
      setValidatedConfig(null);
      return;
    }

    if (viabilityReport.blockers.length > 0 || !viabilityReport.canRun) {
      setErrors({ form: 'Resource blockers must be fixed before creating the session config.' });
      setValidatedConfig(null);
      return;
    }

    if (viabilityReport.warnings.length > 0 && !runAnyway) {
      setErrors({ form: 'Review the resource warnings or enable Run anyway.' });
      setValidatedConfig(null);
      return;
    }

    const adjustedConfig = applyResolvedAutoCounts(result.data, resolvedLaunchPlans);
    const adjustedResult = SimulationRunConfigSchema.safeParse(adjustedConfig);

    if (!adjustedResult.success) {
      setErrors(zodFieldErrors(adjustedResult.error));
      setValidatedConfig(null);
      return;
    }

    if (resolvedLaunchPlans.length === 0) {
      setErrors({ form: 'No bots can be resolved from the current pool and resource settings.' });
      setValidatedConfig(null);
      return;
    }

    const payload = {
      runConfig: adjustedResult.data,
      gameProfile: selectedProfile,
      botProfiles,
      runtimeObservation
    };
    const backendValidation = await window.gameplaySimulator.simulation.validateSessionConfig(payload);

    if (!backendValidation.valid) {
      setErrors({
        form: backendValidation.errors.map((error) => `${error.path}: ${error.message}`).join(' ')
      });
      setAdapterValidationErrors(backendValidation.errors.map((error) => `${error.path}: ${error.message}`));
      setAdapterValidationWarnings(backendValidation.warnings.map((warning) => `${warning.path}: ${warning.message}`));
      setValidatedConfig(null);
      return;
    }

    try {
      setAdapterValidationWarnings(backendValidation.warnings.map((warning) => `${warning.path}: ${warning.message}`));
      const created = await window.gameplaySimulator.simulation.createSession(payload);
      const started = await window.gameplaySimulator.simulation.startSession(created.sessionId);

      setErrors({});
      setValidatedConfig(adjustedResult.data);
      saveRunConfig(adjustedResult.data);
      applySessionSnapshot(started);
      applyRuntimeDetails({
        botStatuses: created.botStatuses,
        instanceStatuses: created.instanceStatuses,
        logs: created.logs
      });
      setSessionPreview(started.label);
      void refreshRuntimeDetails(created.sessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Backend session start failed.';
      setErrors({ form: message });
      setValidatedConfig(null);
    }
  }

  async function stopActiveSession() {
    if (!activeSessionId) {
      return;
    }

    const status = await window.gameplaySimulator.simulation.stopSession(activeSessionId);
    applySessionSnapshot(status);
    await refreshRuntimeDetails(activeSessionId);
  }

  async function pauseActiveSession() {
    if (!activeSessionId) {
      return;
    }

    const status = await window.gameplaySimulator.simulation.pauseSession(activeSessionId);
    applySessionSnapshot(status);
    await refreshRuntimeDetails(activeSessionId);
  }

  async function resumeActiveSession() {
    if (!activeSessionId) {
      return;
    }

    const status = await window.gameplaySimulator.simulation.resumeSession(activeSessionId);
    applySessionSnapshot(status);
    await refreshRuntimeDetails(activeSessionId);
  }

  if (gameProfiles.length === 0) {
    return (
      <section className="empty-state">
        <h1>New Session</h1>
        <button className="primary-button" type="button" onClick={() => openGameProfileEditor()}>
          <span>New Profile</span>
        </button>
      </section>
    );
  }

  return (
    <section className="page-stack new-session-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Simulation</p>
          <h1>New Session</h1>
        </div>
        <div className="page-actions">
          <button
            className="primary-button"
            type="submit"
            form="new-session-form"
            disabled={sessionStatus === 'starting'}
          >
            <Play size={18} aria-hidden="true" />
            <span>Start Session</span>
          </button>
          {canPause ? (
            <button className="secondary-button" type="button" onClick={pauseActiveSession}>
              <Pause size={18} aria-hidden="true" />
              <span>Pause</span>
            </button>
          ) : null}
          {canResume ? (
            <button className="secondary-button" type="button" onClick={resumeActiveSession}>
              <RotateCw size={18} aria-hidden="true" />
              <span>Resume</span>
            </button>
          ) : null}
          {canStop ? (
            <button className="secondary-button" type="button" onClick={stopActiveSession}>
              <Square size={18} aria-hidden="true" />
              <span>Stop</span>
            </button>
          ) : null}
        </div>
      </div>

      <form id="new-session-form" className="form-grid" onSubmit={onSubmit}>
        {errors.form ? <div className="form-error">{errors.form}</div> : null}

        <section className="form-section form-section--template">
          <div className="section-header-row">
            <div>
              <p className="eyebrow">Safe Starting Point</p>
              <h2>First Test Template</h2>
            </div>
            <button
              className="secondary-button"
              type="button"
              disabled={!templateCompatible}
              onClick={applySelectedTemplate}
            >
              <ShieldCheck size={18} aria-hidden="true" />
              <span>Apply Template</span>
            </button>
          </div>

          <div className="field-grid">
            <SelectInput
              id="first-test-template"
              label="First Test Template"
              helpText="This is a ready-made set of safe settings for one short test. The simulator uses it to choose one bot, 20 actions, a slow action delay, and one game instance. For example, choose Browser Smoke Test for a browser game. If it does not match the game profile, it cannot be applied. Beginners should use the template marked as matching their profile."
              value={selectedTemplateId}
              onChange={(event) => {
                setSelectedTemplateId(event.target.value as FirstTestTemplateId);
                setTemplateApplyMessage(null);
              }}
            >
              {firstTestTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </SelectInput>
            <div className="template-compatibility">
              <FieldLabel
                label="Template Compatibility"
                helpText="This tells you whether the template matches the selected game profile. The simulator checks the game engine, adapter, and instrumentation endpoint. For example, a Unity profile with an endpoint matches Unity Instrumented Smoke Test. If it does not match, applying it could use the wrong kind of setup, so the app blocks it. Beginners should choose the matching template."
              />
              <span className={`status-pill ${templateCompatible ? '' : 'status-pill--warning'}`}>
                {templateCompatible ? 'Matches selected profile' : 'Does not match selected profile'}
              </span>
            </div>
          </div>

          <div className="template-guidance">
            <div>
              <FieldLabel
                label="What This Template Does"
                helpText="This explains the small test the template will create. It helps you know which bot and evidence will be used. For example, a browser smoke test checks a few UI actions. If this is not the test you need, choose another template. Beginners should start with the simplest matching smoke test."
              />
              <p>{selectedTemplate.whatItDoes}</p>
            </div>
            <div>
              <FieldLabel
                label="When To Use It"
                helpText="This explains when the template is a good choice. It helps you pick the setup that matches your game profile. For example, an instrumented template needs a working local endpoint. If you use it at the wrong time, the session may not start. Beginners should finish the named profile check first."
              />
              <p>{selectedTemplate.whenToUse}</p>
            </div>
            <div>
              <FieldLabel
                label="What It Cannot Test"
                helpText="This explains the important limits of the short test. It helps you avoid treating one small run as proof that the whole game works. For example, 20 menu actions cannot test every level. If you ignore these limits, you may miss bugs. Beginners should use the result as a setup check."
              />
              <p>{selectedTemplate.limitations}</p>
            </div>
            <div>
              <FieldLabel
                label="Expected First Result"
                helpText="This describes what a normal first result should look like. It helps you tell a working setup from a setup problem. For example, the game opens, one bot acts, and a report is saved. If the result is different, check profile tests and logs before adding bots. Beginners should aim for this result first."
              />
              <p>{selectedTemplate.expectedResult}</p>
            </div>
            <div>
              <FieldLabel
                label="Beginner Recommendation"
                helpText="This is the safest next step for someone new to the simulator. It explains what to check before making the run larger. For example, test one desktop control first. If you skip it, bots may fail for a simple setup reason. Beginners should follow this advice for the first run."
              />
              <p>{selectedTemplate.beginnerRecommendation}</p>
            </div>
            <div>
              <FieldLabel
                label="Before Starting"
                helpText="These are quick checks to complete before the bot starts. The simulator lists them because a profile can look complete while launch, controls, or endpoints still fail. For example, test one control before a desktop run. If a check fails, fix it before starting. Beginners should complete every item."
              />
              <ul>
                {selectedTemplate.beforeStarting.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="template-safety-strip">
            <FieldLabel
              label="Template Safety Limits"
              helpText="These are hard small-run settings applied by the template. They prevent an accidental large first test. Every template uses one bot, one game instance, no video, and no more than 20 actions. If you change them later, the run can use more computer power. Beginners should keep these limits for the first report."
            />
            <span>
              1 bot · 1 game instance · {selectedTemplate.actionCount} actions · {selectedTemplate.actionDelayMs} ms delay · video off · visible when supported
            </span>
          </div>

          {templateApplyMessage ? (
            <div className={`inline-notice ${templateCompatible ? 'inline-notice--ready' : 'inline-notice--loading'}`}>
              <FieldLabel
                label="Template Result"
                helpText="This confirms whether the template was applied. It helps you know if the visible session settings now use the safe values. For example, it may say one bot and 20 actions were applied. If it says the profile does not match, choose the recommended template. Beginners should read this before starting."
              />
              <span>{templateApplyMessage}</span>
            </div>
          ) : null}
        </section>

        <section className="form-section focused-test-section">
          <div className="section-header-row">
            <div>
              <p className="eyebrow">Specialist And Direction</p>
              <h2>Focused Test Template</h2>
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={applySelectedFocusedTemplate}
            >
              <ShieldCheck size={18} aria-hidden="true" />
              <span>Apply Focused Test</span>
            </button>
          </div>

          <div className="focused-template-grid">
            <SelectInput
              id="focused-test-template"
              label="Focused Test Template"
              helpText="This chooses a ready-made test for one game system. The simulator adds one suitable specialist bot, one editable direction, screenshots, and safe limits. For example, Test Crafting System adds the Crafting And Recipe Tester Bot. Applying it replaces the current bot pools and planned directions, so review everything below before starting."
              value={selectedFocusedTemplateId}
              onChange={(event) => {
                setSelectedFocusedTemplateId(event.target.value as FocusedTestTemplateId);
                setFocusedTemplateApplyMessage(null);
              }}
            >
              {focusedTestTemplates.map((template) => (
                <option value={template.id} key={template.id}>{template.name}</option>
              ))}
            </SelectInput>
            <div>
              <FieldLabel
                label="Selected Specialist Bot"
                helpText="This is the focused bot profile the template will enable. The bot already has behavior rules for this game system, while the direction tells it what to emphasize in this run. For example, Crafting Tester understands recipe actions. If the bot is missing, the template cannot be applied."
              />
              <strong>{selectedFocusedBotProfile?.displayName ?? selectedFocusedTemplate.botProfileId}</strong>
            </div>
            <div>
              <FieldLabel
                label="Focused Bot Compatibility"
                helpText="This estimates whether the selected game profile exposes useful features for this specialist. Recommended or Compatible is a strong starting point. Limited means some evidence may need manual review. Unsupported means required setup is missing. The template remains editable and never invents unavailable actions."
              />
              <span className={`status-pill ${focusedBotCompatibility?.status === 'unsupported' ? 'status-pill--warning' : ''}`}>
                {focusedBotCompatibility?.status ?? 'Choose a game profile'}
              </span>
            </div>
            <div>
              <FieldLabel
                label="Required Capabilities"
                helpText="These are the game and adapter features needed for a useful result. For example, crafting integrity needs crafting actions plus readable recipe or inventory state. Missing capabilities do not become fake actions. The bot may report the direction as limited or unavailable. Beginners should compare this list with the profile test."
              />
              <span>{selectedFocusedTemplate.requiredCapabilities.join(', ')}</span>
            </div>
            <div className="field--wide">
              <FieldLabel
                label="What The Focused Test Does"
                helpText="This explains the system the bot and direction will investigate. It helps you decide whether the bundle matches your goal. The action words are only matched against actions the game really reports. If the description is close but not exact, apply it and edit the planned direction before starting."
              />
              <span>{selectedFocusedTemplate.whatItDoes}</span>
            </div>
            <div>
              <FieldLabel
                label="Focused Test Limitations"
                helpText="This explains what the ready-made test cannot prove with every adapter. For example, screenshot-only testing may need a person to confirm item quantities or visual clipping. Read this before starting so a partial result is not mistaken for a complete result."
              />
              <span>{selectedFocusedTemplate.limitations}</span>
            </div>
            <div>
              <FieldLabel
                label="Focused Test Recommendation"
                helpText="This is the safest setup for a beginner using this focused test. It explains useful saves, controls, or first checks. Following it reduces setup failures and protects important game data. Start with the recommended one bot and increase coverage only after reviewing the first report."
              />
              <span>{selectedFocusedTemplate.beginnerRecommendation}</span>
            </div>
            <div>
              <FieldLabel
                label="Focused Test Safety Limits"
                helpText="These are the action and time limits the template applies. One bot and one game instance keep CPU and RAM use bounded. Background-preferred tests do not open an extra visible window. Screenshots can use disk space. Adapter support still depends on the selected game profile."
              />
              <span>
                1 bot, {selectedFocusedTemplate.actionCount} actions, {selectedFocusedTemplate.runtimeMinutes} minutes, {selectedFocusedTemplate.actionDelayMs} ms delay, video off
              </span>
            </div>
          </div>

          {focusedBotCompatibility && (
            focusedBotCompatibility.missingRequirements.length > 0 ||
            focusedBotCompatibility.expectedLimitations.length > 0
          ) ? (
            <div className="notice-list notice-list--warning">
              <strong>
                <FieldLabel
                  label="Focused Test Setup Warnings"
                  helpText="These messages explain missing game features or weaker evidence for the selected specialist. The template still adds only reported actions and does not pretend an unsupported feature works. Fix missing profile setup or expect a limited result. Beginners should resolve Unsupported warnings before starting."
                />
              </strong>
              {[...focusedBotCompatibility.missingRequirements, ...focusedBotCompatibility.expectedLimitations]
                .map((message) => <span key={message}>{message}</span>)}
            </div>
          ) : null}

          {selectedFocusedTemplate.id === 'reproduce-selected-issue' && !selectedReviewIssueId ? (
            <div className="notice-list notice-list--warning">
              <strong>
                <FieldLabel
                  label="Selected Issue Required"
                  helpText="This focused test works best when an issue was selected in the Issues page. Without one, the template uses an obvious editable issue ID. Apply the template, edit its planned direction, and replace the starting value with the real issue ID and last actions before starting."
                />
              </strong>
              <span>No issue is selected. The generated direction will use choose-an-issue-id until you edit it.</span>
            </div>
          ) : null}

          {focusedTemplateApplyMessage ? (
            <div className="inline-notice inline-notice--ready" aria-live="polite">
              <FieldLabel
                label="Focused Template Result"
                helpText="This confirms which specialist, direction, action limit, and runtime were applied. The bot pool and direction appear later on this page for review. Use Edit beside the planned direction to change its words, target, limits, or success condition before starting."
              />
              <span>{focusedTemplateApplyMessage}</span>
            </div>
          ) : null}
        </section>

        <section className="form-section">
          <h2>Run</h2>
          <div className="field-grid">
            <TextInput
              label="Session ID"
              name="sessionId"
              value={form.sessionId}
              error={errors.sessionId}
              onChange={(event) => update('sessionId', event.target.value)}
            />
            <SelectInput
              label="Session Label"
              name="sessionLabel"
              value={form.sessionLabel}
              onChange={(event) => {
                const sessionLabel = event.target.value as SessionLabel;

                setForm((current) =>
                  sessionLabel === 'Stress Test'
                    ? {
                        ...current,
                        sessionLabel,
                        useGlobalObservationSettings: false,
                        showBotGameplay: false,
                        observationMode: 'background',
                        bringGameToFrontOnAction: false
                      }
                    : { ...current, sessionLabel }
                );
              }}
            >
              {sessionLabels.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </SelectInput>
            <SelectInput
              label="Game Profile"
              name="gameProfileId"
              value={form.gameProfileId}
              error={errors.gameProfilePath}
              onChange={(event) => {
                const nextProfile = gameProfiles.find((profile) => profile.gameId === event.target.value);
                const nextTemplate = nextProfile ? recommendedFirstTestTemplate(nextProfile) : undefined;

                setForm((current) => {
                  if (nextProfile && nextTemplate) {
                    return applyTemplateToForm(
                      current,
                      nextTemplate,
                      nextProfile,
                      botProfiles
                    ) ?? {
                      ...current,
                      gameProfileId: event.target.value,
                      startupFlowId: ''
                    };
                  }

                  return {
                    ...current,
                    gameProfileId: event.target.value,
                    startupFlowId: ''
                  };
                });
                if (nextTemplate) {
                  setSelectedTemplateId(nextTemplate.id);
                  setTemplateApplyMessage(`${nextTemplate.name} safe settings are ready.`);
                } else {
                  setTemplateApplyMessage('No first-test template exactly matches this profile. Review the adapter setup.');
                }
                setStartupFlowTestResult(null);
              }}
            >
              {gameProfiles.map((profile) => (
                <option key={profile.gameId} value={profile.gameId}>
                  {profile.gameName}
                </option>
              ))}
            </SelectInput>
            <SelectInput
              label="Run Mode"
              name="runMode"
              value={form.runMode}
              onChange={(event) => update('runMode', event.target.value as RunMode)}
            >
              {runModes.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </SelectInput>
            <TextInput
              label="Max Runtime Minutes"
              name="maxRuntimeMinutes"
              type="number"
              min={1}
              value={form.maxRuntimeMinutes}
              onChange={(event) => update('maxRuntimeMinutes', event.target.value)}
            />
            <TextInput
              label="Action Delay Ms"
              name="actionDelayMs"
              type="number"
              min={0}
              value={form.actionDelayMs}
              error={errors.actionDelayMs}
              onChange={(event) => update('actionDelayMs', numericInput(event.target.value))}
            />
            <TextInput
              label="Max Actions Per Bot"
              name="maxActionsPerBot"
              type="number"
              min={1}
              value={form.maxActionsPerBot}
              onChange={(event) => update('maxActionsPerBot', event.target.value)}
            />
            <TextInput
              label="Screenshot Every N Actions"
              name="screenshotEveryNActions"
              type="number"
              min={1}
              value={form.screenshotEveryNActions}
              onChange={(event) => update('screenshotEveryNActions', event.target.value)}
            />
            <SelectInput
              label="Startup Flow"
              name="startupFlowId"
              value={form.startupFlowId}
              disabled={startupFlowOptions.length === 0}
              onChange={(event) => update('startupFlowId', event.target.value)}
            >
              <option value="">
                {startupFlowOptions.length === 0 ? 'No UI flows configured' : 'No startup flow'}
              </option>
              {startupFlowOptions.map((flow) => (
                <option key={flow.flowId} value={flow.flowId}>
                  {flow.name}
                </option>
              ))}
            </SelectInput>
            <TextInput
              label="Startup timeout"
              name="startupFlowTimeoutSeconds"
              type="number"
              min={1}
              value={form.startupFlowTimeoutSeconds}
              onChange={(event) => update('startupFlowTimeoutSeconds', event.target.value)}
            />
          </div>
          <div className="toggle-grid">
            <ToggleInput
              label="Run Until Stopped"
              checked={form.runUntilStopped}
              onChange={(event) => update('runUntilStopped', event.target.checked)}
            />
            <ToggleInput
              label="Stop On Critical Issue"
              checked={form.stopOnCriticalIssue}
              onChange={(event) => update('stopOnCriticalIssue', event.target.checked)}
            />
            <ToggleInput
              label="Save screenshots"
              checked={form.saveScreenshots}
              disabled={!selectedProfile?.adapter.supportsScreenshots}
              onChange={(event) => update('saveScreenshots', event.target.checked)}
            />
            <ToggleInput
              label="Action Timeline"
              checked={form.saveActionTimeline}
              onChange={(event) => update('saveActionTimeline', event.target.checked)}
            />
            <ToggleInput
              label="State Snapshots"
              checked={form.saveStateSnapshots}
              onChange={(event) => update('saveStateSnapshots', event.target.checked)}
            />
            <ToggleInput
              label="Continue if startup flow fails"
              checked={form.continueOnStartupFlowFailure}
              disabled={!form.startupFlowId}
              onChange={(event) => update('continueOnStartupFlowFailure', event.target.checked)}
            />
          </div>
          <div className="wizard-test-card">
            <div>
              <FieldLabel label="Check Startup Flow" />
              <p className="form-hint">
                {selectedStartupFlow
                  ? `Checks "${selectedStartupFlow.name}" before the real session uses it.`
                  : 'Choose a startup flow from this game profile before testing it.'}
              </p>
            </div>
            <button
              className="secondary-button"
              type="button"
              disabled={startupFlowOptions.length === 0}
              onClick={testStartupFlow}
            >
              <Play size={18} aria-hidden="true" />
              <span>Check Startup Flow</span>
            </button>
          </div>
          {startupFlowTestResult ? (
            <div className="inline-notice inline-notice--ready">
              <FieldLabel label="Startup Flow Check Result" />
              <span>{startupFlowTestResult}</span>
            </div>
          ) : null}
          {diskUsageWarning ? (
            <div className="inline-notice inline-notice--loading">
              <FieldLabel label="Disk usage warning" />
              <span>{diskUsageWarning}</span>
            </div>
          ) : null}
        </section>

        <section className="form-section session-observation-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Per-session choice</p>
              <h2>Live Observation</h2>
            </div>
            <span className="status-pill">
              {form.useGlobalObservationSettings ? 'Using global settings' : 'Session override'}
            </span>
          </div>

          <div className="toggle-grid session-observation-toggle-grid">
            <ToggleInput
              id="use-global-observation-settings"
              label="Use Global Observation Settings"
              helpText="This makes this test use the choices from the Settings page. It keeps one normal default for every new test. Turning it off lets this session use different visibility settings without changing other tests. It does not add CPU, RAM, or windows by itself. Beginners should leave it on unless a smoke test needs to be watched."
              checked={form.useGlobalObservationSettings}
              onChange={(event) => {
                const useGlobalObservationSettings = event.currentTarget.checked;
                setForm((current) => ({
                  ...current,
                  useGlobalObservationSettings,
                  ...(!useGlobalObservationSettings
                    ? {
                        showBotGameplay: runtimeObservation.showBotGameplay,
                        observationMode: runtimeObservation.observationMode,
                        selectedObservationBotId: runtimeObservation.selectedBotId ?? '',
                        bringGameToFrontOnAction: runtimeObservation.bringGameToFrontOnAction,
                        visibleActionDelayMs: runtimeObservation.visibleActionDelayMs,
                        showActionInformation: runtimeObservation.showActionInformation,
                        maxVisibleGameWindows: runtimeObservation.maxVisibleGameWindows
                      }
                    : {})
                }));
              }}
            />
            <ToggleInput
              id="session-show-bot-gameplay"
              label="Show Bot Gameplay"
              helpText="This opens a visible game window for this test so you can watch a bot play. Visible windows use more CPU, RAM, and screen space. Browser and desktop adapters normally support them; instrumented or custom adapters may not own a window. If the adapter cannot show one, the test continues in the background. Beginners should turn this on for a one-bot smoke test and off for stress or overnight tests."
              checked={effectiveObservation.showBotGameplay}
              disabled={form.useGlobalObservationSettings}
              onChange={(event) => {
                const showBotGameplay = event.currentTarget.checked;
                setForm((current) => ({
                  ...current,
                  showBotGameplay,
                  observationMode: showBotGameplay
                    ? current.observationMode === 'background'
                      ? 'follow-first-bot'
                      : current.observationMode
                    : 'background',
                  bringGameToFrontOnAction: showBotGameplay
                    ? current.bringGameToFrontOnAction
                    : false
                }));
              }}
            />
            <ToggleInput
              id="session-bring-game-to-front"
              label="Bring Game To Front On Action"
              helpText="This asks the adapter to focus the watched game before each bot action. It can help keyboard and mouse input reach the right window. It uses little extra CPU or RAM and opens no extra window, but repeated focus changes can interrupt your computer use. Beginners should leave it off unless desktop input needs focus."
              checked={effectiveObservation.bringGameToFrontOnAction}
              disabled={form.useGlobalObservationSettings || !effectiveObservation.showBotGameplay}
              onChange={(event) => update('bringGameToFrontOnAction', event.currentTarget.checked)}
            />
            <ToggleInput
              id="session-show-action-information"
              label="Show Action Information"
              helpText="This shows the watched bot's action and reason. A visible browser can show a short test-only label with the click or key. Desktop games show the details only in Live Session, so the game itself is not changed. It uses a small amount of CPU and RAM and opens no extra window. If it is off, testing still works. Beginners should leave it on while learning how a bot behaves."
              checked={effectiveObservation.showActionInformation}
              disabled={form.useGlobalObservationSettings || !effectiveObservation.showBotGameplay}
              onChange={(event) => update('showActionInformation', event.currentTarget.checked)}
            />
          </div>

          <div className="field-grid session-observation-field-grid">
            <SelectInput
              id="session-observation-mode"
              label="Observation Mode"
              helpText="This chooses which game you watch during this test. Follow first bot shows one bot, Follow selected bot uses the bot ID below, and Show all instances shows as many windows as the limit allows. More windows use more CPU, RAM, and desktop space. Browser and desktop-style adapters support visible windows best. Beginners should choose Follow first bot."
              value={effectiveObservation.observationMode}
              disabled={form.useGlobalObservationSettings || !effectiveObservation.showBotGameplay}
              onChange={(event) => update('observationMode', event.currentTarget.value as ObservationMode)}
            >
              {observationModes.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </SelectInput>
            <TextInput
              id="session-selected-observation-bot"
              label="Follow Bot"
              helpText="This is the bot ID to watch in Follow selected bot mode. For example, ui-tester-bot-001 watches that one bot. It uses no extra CPU or RAM by itself and asks the adapter to show that bot's game instance. If the ID is wrong, the adapter may show the first bot instead. Beginners can leave it blank and use Follow first bot."
              placeholder="ui-tester-bot-001"
              value={effectiveObservation.selectedBotId ?? ''}
              disabled={
                form.useGlobalObservationSettings ||
                !effectiveObservation.showBotGameplay ||
                effectiveObservation.observationMode !== 'follow-selected-bot'
              }
              onChange={(event) => update('selectedObservationBotId', event.currentTarget.value)}
            />
            <TextInput
              id="session-visible-action-delay"
              label="Visible Action Delay"
              helpText="This is the minimum wait between watched actions in milliseconds. For example, 500 is half a second. A longer delay is easier to follow and may reduce CPU use, but the test takes longer. It opens no extra windows and works through the bot runtime for every adapter. Beginners should use 500 to 750."
              type="number"
              min={0}
              max={60_000}
              step={50}
              value={effectiveObservation.visibleActionDelayMs}
              disabled={form.useGlobalObservationSettings || !effectiveObservation.showBotGameplay}
              onChange={(event) => {
                if (Number.isFinite(event.currentTarget.valueAsNumber)) {
                  update(
                    'visibleActionDelayMs',
                    Math.min(60_000, Math.max(0, Math.round(event.currentTarget.valueAsNumber)))
                  );
                }
              }}
            />
            <TextInput
              id="session-max-visible-windows"
              label="Maximum Visible Game Windows"
              helpText="This limits how many game windows this test may show. For example, 1 lets you watch one game while other instances stay in the background. Larger values use more CPU, RAM, and screen space and can cover the desktop. The selected adapter must support visible windows. Beginners should use 1."
              type="number"
              min={1}
              max={32}
              step={1}
              value={effectiveObservation.maxVisibleGameWindows}
              disabled={form.useGlobalObservationSettings || !effectiveObservation.showBotGameplay}
              onChange={(event) => {
                if (Number.isFinite(event.currentTarget.valueAsNumber)) {
                  update(
                    'maxVisibleGameWindows',
                    Math.min(32, Math.max(1, Math.round(event.currentTarget.valueAsNumber)))
                  );
                }
              }}
            />
          </div>

          <div className="notice-list observation-adapter-support">
            <strong>
              <FieldLabel
                label="Session Adapter Support"
                helpText="This tells you whether the selected adapter normally owns a visible window. Browser and desktop adapters can usually show gameplay. Unity, Godot, and Unreal desktop fallback can also show a window. Instrumented and custom adapters may control a game without owning its window. If visibility is unsupported, the session still runs in the background."
              />
            </strong>
            <span>
              {observationSupport}
            </span>
          </div>

          {observationWarnings.length > 0 ? (
            <div className="notice-list notice-list--warning" aria-label="Live observation warnings">
              <strong>
                <FieldLabel
                  label="Live Observation Warnings"
                  helpText="These warnings explain when visible gameplay may be too heavy or may show fewer windows than requested. They do not silently remove bots. Read them before starting. For a large or overnight test, choose Background."
                />
              </strong>
              {observationWarnings.map((warning) => (
                <span key={warning}>{warning}</span>
              ))}
            </div>
          ) : null}
        </section>

        <section className="form-section">
          <div className="section-header-row">
            <h2>Bot Pools</h2>
            <div className="bot-pool-adder">
              <SelectInput
                label="Add Bot Type"
                value={profileIdToAdd}
                disabled={availableBotProfiles.length === 0}
                onChange={(event) => setAddPoolProfileId(event.target.value)}
              >
                {availableBotProfiles.length === 0 ? (
                  <option value="">All profiles added</option>
                ) : (
                  availableBotProfiles.map((profile) => (
                    <option key={profile.profileId} value={profile.profileId}>
                      {profile.displayName}
                    </option>
                  ))
                )}
              </SelectInput>
              <button
                className="secondary-button"
                type="button"
                disabled={availableBotProfiles.length === 0}
                onClick={addBotPool}
              >
                <Plus size={18} aria-hidden="true" />
                <span>Add Pool</span>
              </button>
            </div>
          </div>
          <div className="bot-pool-grid">
            {form.botPools.map((pool, index) => {
              const profile = botProfiles.find((item) => item.profileId === pool.profileId);

              return (
                <div className="bot-pool-row" key={pool.profileId}>
                  <ToggleInput
                    label={profile?.displayName ?? pool.profileId}
                    helpText={`This turns the ${profile?.displayName ?? pool.profileId} pool on or off. The simulator uses enabled pools to create bots for this session. For example, turn on Explorer Bot to test maps and hidden areas. If this is off, no bots from this pool will run. Beginners should keep one simple pool enabled first.`}
                    checked={pool.enabled}
                    onChange={(event) => updatePool(index, { enabled: event.target.checked })}
                  />
                  <TextInput
                    label="Min"
                    type="number"
                    min={0}
                    value={pool.minCount}
                    error={poolError(index, 'minCount')}
                    onChange={(event) => updatePool(index, { minCount: numericInput(event.target.value) })}
                  />
                  <TextInput
                    label="Desired"
                    type="number"
                    min={0}
                    value={pool.desiredCount}
                    error={poolError(index, 'desiredCount')}
                    onChange={(event) => {
                      const desiredCount = numericInput(event.target.value);
                      updatePool(index, {
                        desiredCount,
                        ...(pool.scalingMode === 'fixed' ? { minCount: desiredCount } : {})
                      });
                    }}
                  />
                  <TextInput
                    label="Max"
                    type="number"
                    min={0}
                    value={pool.maxCount}
                    error={poolError(index, 'maxCount')}
                    onChange={(event) => updatePool(index, { maxCount: numericInput(event.target.value) })}
                  />
                  <SelectInput
                    label="Scaling"
                    value={pool.scalingMode}
                    error={poolError(index, 'scalingMode')}
                    onChange={(event) =>
                      updatePool(index, { scalingMode: event.target.value as BotPoolConfig['scalingMode'] })
                    }
                  >
                    <option value="fixed">Fixed</option>
                    <option value="auto">Auto</option>
                  </SelectInput>
                  <button
                    className="icon-text-button bot-pool-remove"
                    type="button"
                    onClick={() => removeBotPool(index)}
                  >
                    <Trash2 size={17} aria-hidden="true" />
                    <span>Remove</span>
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {hasTechnicalSafeguardPool ? (
          <section className="form-section technical-testing-section" aria-label="Technical Test Safeguards">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Technical Safety</p>
                <h2>Technical Test Safeguards</h2>
              </div>
              <span className="status-pill">Required preflight</span>
            </div>

            <div className="technical-testing-grid">
              {hasNetworkTechnicalPool ? (
                <ToggleInput
                  label="Controlled Network Test Confirmed"
                  helpText="This confirms that the network test uses a private or developer-controlled build and server that you own or have permission to test. The simulator requires this before Network Resilience or Multiplayer Session bots can start. For example, use a local studio test server, not public matchmaking. If this is off, the session is blocked. Beginners should leave it off until the private test environment is ready."
                  checked={form.controlledNetworkTestConfirmed}
                  onChange={(event) => update('controlledNetworkTestConfirmed', event.target.checked)}
                />
              ) : null}
              {hasSaveMigrationPool ? (
                <TextareaInput
                  className="field--wide"
                  label="Save Migration Test Files"
                  helpText="These are copies of older test saves that you provide for migration testing. Enter one permitted file or folder path per line. The bot uses only these paths and does not search for personal saves. For example, /tests/saves/version-1/sample-save. If this is empty, Save Migration Tester cannot start. Beginners should use one disposable copy and keep the original safe."
                  rows={4}
                  value={form.saveMigrationTestPaths}
                  onChange={(event) => update('saveMigrationTestPaths', event.target.value)}
                />
              ) : null}
              {hasFilePermissionPool ? (
                <TextareaInput
                  className="field--wide"
                  label="Approved File Test Directories"
                  helpText="These are disposable test or session folders where file checks are allowed. Enter one directory per line. The adapter must restrict every file action to these exact folders. For example, /project/runs/file-tests/session-1. If this is empty, File And Permission Tester cannot start. Never choose personal, operating-system, or unrelated project folders."
                  rows={4}
                  value={form.approvedFileTestDirectories}
                  onChange={(event) => update('approvedFileTestDirectories', event.target.value)}
                />
              ) : null}
            </div>

            <div className="notice-list notice-list--warning" aria-label="Technical test warnings">
              <strong>
                <FieldLabel
                  label="Technical Test Warnings"
                  helpText="These messages explain important limits before technical bots run. They tell you about computer load, adapter support, private network scope, and protected files. Ignoring a blocker prevents the session from starting; other warnings mean the result may be incomplete. Beginners should fix each blocker and start with one bot."
                />
              </strong>
              {hasNetworkTechnicalPool ? <span>Network tests are limited to private or developer-controlled environments. Public matchmaking automation and anti-cheat bypasses are not supported.</span> : null}
              {hasEndurancePool ? <span>Endurance testing can use substantial CPU, RAM, disk space, and time. Start with one bot, a fixed 15-minute runtime, background observation, and conservative resource limits.</span> : null}
              {hasSaveMigrationPool ? <span>Save migration uses only the test-save paths supplied above. Preserve the source files and test copied data.</span> : null}
              {hasFilePermissionPool ? <span>File tests may operate only inside the approved disposable directories listed above. Other paths remain outside the test scope.</span> : null}
            </div>
          </section>
        ) : null}

        <section className="form-section directive-section" aria-label="What Do You Want Tested">
          <div className="section-heading">
            <div>
              <p className="eyebrow">User Direction</p>
              <h2>What Do You Want Tested?</h2>
            </div>
            <span className="status-pill">
              {form.directives.length} planned
            </span>
          </div>

          <div className="directive-template-row">
            <SelectInput
              id="directive-template"
              label="Direction Template"
              helpText="This fills in a simple example direction for a common test. The simulator uses it to choose safe starting words, limits, and a suitable bot type. For example, Test this feature fills in an inventory test. If the example does not match your game, change the fields before adding it. Beginners should start with the closest template."
              value={directiveDraft.templateId}
              onChange={(event) => selectDirectiveTemplate(event.target.value as DirectiveTemplateId)}
            >
              {directiveTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </SelectInput>
            <div className="directive-template-description">
              <FieldLabel
                label="Template Purpose"
                helpText="This explains what the selected direction template is meant to test. It helps you decide whether the example fits your game. For example, Follow this sequence is for several actions that must happen in order. If it does not fit, choose another template. Beginners should use one small direction first."
              />
              <p>
                {directiveTemplates.find((template) => template.id === directiveDraft.templateId)?.description}
              </p>
            </div>
          </div>

          <div className="directive-field-grid">
            <TextInput
              name="directiveName"
              label="Direction Name"
              helpText="This is a short name for what you want tested. The simulator shows it in live status, logs, and reports. For example, Test inventory sorting. If it is vague, the result may be hard to recognize later. Beginners should name one feature or action."
              value={directiveDraft.name}
              onChange={(event) => updateDirectiveDraft('name', event.target.value)}
            />
            <TextareaInput
              name="directiveDescription"
              className="field--wide"
              label="What Should Be Tested?"
              helpText="Describe the result you want the bot to investigate in plain words. The simulator uses these words to explain the direction and find related actions. For example, open the inventory, sort items, and check that none disappear. If it asks for something the game cannot do, the direction may be unavailable. Beginners should describe one small test."
              rows={3}
              value={directiveDraft.description}
              onChange={(event) => updateDirectiveDraft('description', event.target.value)}
            />
            <SelectInput
              name="directiveType"
              label="Direction Type"
              helpText="This tells the simulator what kind of target you described. Feature is for a game system, Action is for one reported action, Area is for a place, and Sequence is for steps in order. For example, inventory sorting is a Feature. A wrong type can make required details missing. Beginners should use Feature."
              value={directiveDraft.directiveType}
              onChange={(event) => {
                const directiveType = event.target.value as BotTestDirectiveType;
                setDirectiveDraft((current) => ({
                  ...current,
                  directiveType,
                  directiveMode:
                    directiveType === 'sequence'
                      ? 'guided-sequence'
                      : current.directiveMode === 'guided-sequence'
                        ? 'focus'
                        : current.directiveMode
                }));
                setDirectiveError(null);
              }}
            >
              <option value="action">Action</option>
              <option value="feature">Feature</option>
              <option value="scene">Scene</option>
              <option value="area">Area</option>
              <option value="ui-flow">UI flow</option>
              <option value="game-state">Game state</option>
              <option value="issue-reproduction">Issue reproduction</option>
              <option value="sequence">Sequence</option>
              <option value="freeform">Freeform</option>
            </SelectInput>
            <SelectInput
              name="directiveMode"
              label="Direction Strength"
              helpText="This controls how strongly the direction changes bot choices. Influence gently prefers matching actions. Focus strongly prefers them. Force Next Valid Action requests one exact action only when the adapter reports it. Guided Sequence follows listed actions in order. If it is too strong, the bot may spend less time on normal testing. Beginners should use Focus."
              value={directiveDraft.directiveMode}
              onChange={(event) => {
                const directiveMode = event.target.value as BotTestDirectiveMode;
                setDirectiveDraft((current) => ({
                  ...current,
                  directiveMode,
                  directiveType:
                    directiveMode === 'guided-sequence'
                      ? 'sequence'
                      : directiveMode === 'force-next-valid-action'
                        ? 'action'
                        : current.directiveType === 'sequence'
                          ? 'feature'
                          : current.directiveType
                }));
                setDirectiveError(null);
              }}
            >
              <option value="influence">Influence</option>
              <option value="focus">Focus</option>
              <option value="force-next-valid-action">Force next valid action</option>
              <option value="repeat-until-condition">Repeat until condition</option>
              <option value="guided-sequence">Guided sequence</option>
            </SelectInput>
            <SelectInput
              name="directivePriority"
              label="Priority"
              helpText="This decides which queued direction a bot considers first. Urgent comes before High, then Normal, then Low. Safety recovery and startup setup still come first. For example, use High for the main feature you opened this session to test. Too many urgent directions can make ordering confusing. Beginners should use Normal or High."
              value={directiveDraft.priority}
              onChange={(event) =>
                updateDirectiveDraft('priority', event.target.value as BotTestDirectivePriority)
              }
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </SelectInput>
            <SelectInput
              name="directiveAssignmentMode"
              label="Assign To"
              helpText="This chooses which planned bots receive the direction. You can use every bot, one concrete bot, one bot type, or one game instance. For example, assign an inventory test to Inventory Stress Tester Bot. If no enabled bot matches, the direction stays queued and cannot run. Beginners should choose Bot type."
              value={directiveDraft.assignmentMode}
              onChange={(event) =>
                updateDirectiveDraft(
                  'assignmentMode',
                  event.target.value as DirectiveAssignmentMode
                )
              }
            >
              <option value="all-bots">All enabled bots</option>
              <option value="bot">One bot</option>
              <option value="profile">Bot type</option>
              <option value="instance">Game instance</option>
            </SelectInput>
            <SelectInput
              name="directiveTargetBot"
              label="Target Bot"
              helpText="This chooses one concrete bot from the resolved session plan. The direction is given only to that bot. For example, explorer-001. If bot counts change and this bot no longer exists, the direction cannot be assigned. Beginners should use Target Bot Type unless they need one exact bot."
              disabled={directiveDraft.assignmentMode !== 'bot' || resolvedLaunchPlans.length === 0}
              value={directiveDraft.targetBotId}
              onChange={(event) => updateDirectiveDraft('targetBotId', event.target.value)}
            >
              <option value="">Choose a resolved bot</option>
              {resolvedLaunchPlans.map((plan) => (
                <option key={plan.botId} value={plan.botId}>
                  {plan.botId}
                </option>
              ))}
            </SelectInput>
            <SelectInput
              name="directiveTargetProfile"
              label="Target Bot Type"
              helpText="This chooses a reusable bot profile for the direction. Every enabled bot of this type can receive its own progress record. For example, Inventory Stress Tester Bot is useful for item sorting. If this bot pool is not enabled, the direction cannot run. Beginners should choose the bot type whose description matches the feature."
              disabled={directiveDraft.assignmentMode !== 'profile'}
              value={directiveDraft.targetProfileId}
              onChange={(event) => updateDirectiveDraft('targetProfileId', event.target.value)}
            >
              <option value="">Choose a bot type</option>
              {botProfiles.map((profile) => (
                <option key={profile.profileId} value={profile.profileId}>
                  {profile.displayName}
                </option>
              ))}
            </SelectInput>
            <SelectInput
              name="directiveTargetInstance"
              label="Target Game Instance"
              helpText="This gives the direction to bots assigned to one planned game copy. For example, game-instance-001. It is useful when different instances use different saves or setup. If the instance plan changes, the target may no longer exist. Beginners should use Bot type for a first test."
              disabled={directiveDraft.assignmentMode !== 'instance'}
              value={directiveDraft.targetInstanceId}
              onChange={(event) => updateDirectiveDraft('targetInstanceId', event.target.value)}
            >
              <option value="">Choose a planned instance</option>
              {(plannedGameInstances?.instances ?? []).map((instance) => (
                <option key={instance.instanceId} value={instance.instanceId}>
                  {instance.instanceId}
                </option>
              ))}
            </SelectInput>
            <TextInput
              name="directiveActionKeywords"
              label="Action Keywords"
              helpText="These are action names or words the bot should look for. Separate them with commas. The planner matches them only against actions the adapter reports. For example, inventory, sort, move-item. If the words do not match game controls or reported actions, the direction may be unavailable. Beginners should use the action names from the profile test."
              value={directiveDraft.actionKeywords}
              onChange={(event) => updateDirectiveDraft('actionKeywords', event.target.value)}
            />
            <TextInput
              name="directiveAvoidedActions"
              label="Actions To Avoid"
              helpText="These are actions the direction should discourage while it is active. Separate them with commas. For example, leave-area or close-game. If you list a needed action here, the bot may struggle to complete the direction. Beginners can leave this blank."
              value={directiveDraft.avoidedActionKeywords}
              onChange={(event) => updateDirectiveDraft('avoidedActionKeywords', event.target.value)}
            />
            <TextInput
              name="directiveSceneArea"
              label="Scene Or Area"
              helpText="This names the place you want tested. It is required for Scene and Area directions and helps reports explain where the test belongs. For example, Forest, Main Menu, or Level 2. If the name does not match game state, automatic success may not work. Beginners should use the same name shown by instrumentation or logs."
              value={directiveDraft.sceneOrArea}
              onChange={(event) => updateDirectiveDraft('sceneOrArea', event.target.value)}
            />
            {directiveDraft.directiveType === 'ui-flow' ? (
              <SelectInput
                name="directiveTargetUiFlow"
                label="Target UI Flow"
                helpText="This chooses a configured menu journey from the game profile. The bot uses its ordered steps to reach the requested screen. For example, Create World. If the flow is missing or outdated, the direction cannot complete. Beginners should test the flow before using it."
                value={directiveDraft.targetUiFlowId}
                onChange={(event) => updateDirectiveDraft('targetUiFlowId', event.target.value)}
              >
                <option value="">Choose a UI flow</option>
                {startupFlowOptions.map((flow) => (
                  <option key={flow.flowId} value={flow.flowId}>
                    {flow.name}
                  </option>
                ))}
              </SelectInput>
            ) : null}
            {directiveDraft.directiveType === 'issue-reproduction' ? (
              <TextInput
                name="directiveTargetIssue"
                label="Target Issue ID"
                helpText="This identifies the issue you want the bot to try again. The simulator uses it to connect the new attempt to earlier evidence. For example, issue-014. If the ID is wrong, the report cannot connect the reproduction attempt correctly. Beginners should paste the issue ID from the Issues page."
                value={directiveDraft.targetIssueId}
                onChange={(event) => updateDirectiveDraft('targetIssueId', event.target.value)}
              />
            ) : null}
            <TextareaInput
              name="directiveSuccessCondition"
              className="field--wide"
              label="Success Condition"
              helpText="This describes what must happen for the direction to count as successful. For example, the inventory opens and three item actions succeed. Instrumented state can measure some conditions automatically. If the adapter cannot see the result, use Manual Success Confirmation in Live Session. Beginners should write one clear result."
              rows={2}
              value={directiveDraft.successCondition}
              onChange={(event) => updateDirectiveDraft('successCondition', event.target.value)}
            />
            <TextInput
              name="directiveMaxActions"
              label="Maximum Actions"
              helpText="This is the most bot actions this direction may use. It limits how long the bot stays focused. For example, 30 allows up to thirty actions. A large number can use more test time, CPU, and screenshots. Beginners should use 20 or 30."
              type="number"
              min={1}
              value={directiveDraft.maxActions}
              onChange={(event) => updateDirectiveDraft('maxActions', event.target.value)}
            />
            <TextInput
              name="directiveMaxAttempts"
              label="Maximum Attempts"
              helpText="This is how many times the bot may retry the direction or sequence step. For example, 3 gives it three chances. Too many attempts can repeat a broken action for a long time. Beginners should use 3."
              type="number"
              min={1}
              value={directiveDraft.maxAttempts}
              onChange={(event) => updateDirectiveDraft('maxAttempts', event.target.value)}
            />
            <TextInput
              name="directiveTimeLimit"
              label="Time Limit"
              helpText="This is the direction timeout in seconds. The bot returns to normal behavior when the direction expires or fails. For example, 120 means two minutes. A long timeout keeps the bot focused longer but does not open extra windows. Beginners should use 120."
              type="number"
              min={1}
              value={directiveDraft.timeoutSeconds}
              onChange={(event) => updateDirectiveDraft('timeoutSeconds', event.target.value)}
            />
          </div>

          <div className="directive-toggle-grid">
            <ToggleInput
              label="Repeat Until Successful"
              helpText="This asks the bot to keep trying matching valid actions until success or a limit is reached. It can increase test time and action count, but it does not create extra bots or game windows. If the game cannot report success, use manual confirmation from Live Session. Beginners should leave this off unless testing a repeatable action."
              checked={directiveDraft.repeatUntilSuccess}
              onChange={(event) =>
                updateDirectiveDraft('repeatUntilSuccess', event.target.checked)
              }
            />
            <ToggleInput
              label="Manual Success Confirmation"
              helpText="This adds a Confirm Direction Succeeded command to Live Session when the adapter cannot measure the result. Use it after you see the expected result in the game, screenshot, or logs. For example, confirm that a button changed the screen. A wrong confirmation makes the report say the test passed when it did not. Beginners should turn it on only when a warning says success cannot be measured."
              checked={directiveDraft.manualSuccessConfirmation}
              onChange={(event) =>
                updateDirectiveDraft('manualSuccessConfirmation', event.target.checked)
              }
            />
          </div>

          <div className="directive-runtime-notice">
            <FieldLabel
              label="Directive Runtime Cost"
              helpText="Directions change how an existing bot chooses actions. They do not create another bot or game window by themselves. A long action limit or repeat mode can make the session run longer and may create more logs or screenshots. Support depends on actions and state reported by the selected adapter. Beginners should keep one direction under 30 actions."
            />
            <span>
              No extra window is opened. CPU and RAM change very little, but longer directions can extend the run. Adapter support depends on reported actions and state.
            </span>
          </div>

          <div className="directive-preview" aria-live="polite">
            <FieldLabel
              label="Direction Preview"
              helpText="This sentence explains how the current direction will affect the selected bots. It shows the strength, target, topic, and action limit. For example, it may strongly guide Inventory Stress Tester Bot for 30 actions. If it sounds wrong, change the fields before adding it. Beginners should read this once."
            />
            <strong>
              {directiveDraftResult.success
                ? directivePreviewText(directiveDraftResult.data, botProfiles)
                : 'Complete the required direction fields to see the final preview.'}
            </strong>
          </div>

          {directiveWarnings.length > 0 ? (
            <div className="notice-list notice-list--warning" aria-label="Direction warnings">
              <strong>
                <FieldLabel
                  label="Direction Warnings"
                  helpText="These warnings explain setup details that may stop the direction from completing. They check enabled bots, profile controls, adapter state awareness, and success measurement. Warnings do not invent actions or silently change your direction. Beginners should fix them or enable manual confirmation before starting."
                />
              </strong>
              {directiveWarnings.map((warning) => (
                <span key={warning}>{warning}</span>
              ))}
            </div>
          ) : null}

          {directiveError ? <div className="form-error">{directiveError}</div> : null}

          <div className="directive-add-row">
            <div>
              <FieldLabel
                label={editingDirectiveId ? 'Update Test Direction' : 'Add Test Direction'}
                helpText="This validates and saves the direction in the planned session. When editing, it replaces only the selected direction and does not create another copy. The direction is saved in config.json, logs, and reports when the session starts. If required fields are missing, the app explains what to fix."
              />
              <span>
                {editingDirectiveId
                  ? 'Save these changes without starting the session yet.'
                  : 'Add the current direction without starting the session yet.'}
              </span>
            </div>
            <div className="directive-editor-actions">
              <button className="secondary-button" type="button" onClick={addDirective}>
                {editingDirectiveId
                  ? <Pencil size={18} aria-hidden="true" />
                  : <Plus size={18} aria-hidden="true" />}
                <span>{editingDirectiveId ? 'Update Direction' : 'Add Direction'}</span>
              </button>
              {editingDirectiveId ? (
                <button className="secondary-button" type="button" onClick={cancelDirectiveEdit}>
                  <X size={18} aria-hidden="true" />
                  <span>Cancel Edit</span>
                </button>
              ) : null}
            </div>
          </div>

          <div className="planned-directive-list">
            <FieldLabel
              label="Planned Test Directions"
              helpText="These are the directions that will be saved and assigned when the session starts. Each matching bot gets separate progress. For example, one inventory direction can target every Inventory Stress Tester Bot. If a direction is wrong, remove it and add a corrected one. Beginners should keep the list short."
            />
            {form.directives.length === 0 ? (
              <div className="empty-row">No test directions added. Bots will use normal profile behavior.</div>
            ) : (
              form.directives.map((directive) => (
                <div className="planned-directive-row" key={directive.directiveId}>
                  <div>
                    <strong>{directive.name}</strong>
                    <span>{directivePreviewText(directive, botProfiles)}</span>
                    <small>
                      {directive.directiveType} · {directive.directiveMode} · {directive.priority}
                    </small>
                  </div>
                  <div className="planned-directive-actions">
                    <button
                      className="icon-text-button"
                      type="button"
                      onClick={() => editDirective(directive)}
                    >
                      <Pencil size={17} aria-hidden="true" />
                      <span>Edit</span>
                    </button>
                    <button
                      className="icon-text-button"
                      type="button"
                      onClick={() => removeDirective(directive.directiveId)}
                    >
                      <Trash2 size={17} aria-hidden="true" />
                      <span>Remove</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="form-section">
          <h2>Limits</h2>
          <div className="field-grid">
            <TextInput
              label="Global Bot Limit"
              type="number"
              min={1}
              value={form.globalBotLimit}
              error={errors.globalBotLimit}
              onChange={(event) => update('globalBotLimit', numericInput(event.target.value))}
            />
            <TextInput
              label="Per-Instance Bot Limit"
              type="number"
              min={1}
              value={form.perGameInstanceBotLimit}
              error={errors.perGameInstanceBotLimit}
              onChange={(event) => update('perGameInstanceBotLimit', numericInput(event.target.value))}
            />
            <TextInput
              label="CPU Percent"
              type="number"
              min={1}
              max={100}
              value={form.maxCpuPercent}
              error={errors['resourceLimits.maxCpuPercent']}
              onChange={(event) => update('maxCpuPercent', numericInput(event.target.value))}
            />
            <TextInput
              label="RAM Percent"
              type="number"
              min={1}
              max={100}
              value={form.maxRamPercent}
              error={errors['resourceLimits.maxRamPercent']}
              onChange={(event) => update('maxRamPercent', numericInput(event.target.value))}
            />
            <TextInput
              label="GPU Percent"
              type="number"
              min={1}
              max={100}
              value={form.maxGpuPercent}
              error={errors['resourceLimits.maxGpuPercent']}
              onChange={(event) => update('maxGpuPercent', event.target.value)}
            />
            <TextInput
              label="Reserve RAM MB"
              type="number"
              min={0}
              value={form.reserveRamMb}
              error={errors['resourceLimits.reserveRamMb']}
              onChange={(event) => update('reserveRamMb', numericInput(event.target.value))}
            />
            <TextInput
              label="Max Game Instances"
              type="number"
              min={1}
              value={form.maxGameInstances}
              error={errors['resourceLimits.maxGameInstances']}
              onChange={(event) => update('maxGameInstances', numericInput(event.target.value))}
            />
          </div>
          <div className="toggle-grid">
            <ToggleInput
              label="Auto Scaling"
              checked={form.allowAutoScaling}
              onChange={(event) => update('allowAutoScaling', event.target.checked)}
            />
          </div>
        </section>
      </form>

      <section className="viability-panel" aria-label="Runtime viability estimate">
        <div className="viability-panel__header">
          <div>
            <p className="eyebrow">Resource Estimate</p>
            <h2>Bot-count viability</h2>
          </div>
          {viabilityReport ? (
            <span className="status-pill">{viabilityReport.canRun ? 'Can run' : 'Needs changes'}</span>
          ) : null}
        </div>

        {viabilityError ? <div className="form-error">{viabilityError}</div> : null}

        {adapterValidationErrors.length > 0 ? (
          <div className="notice-list notice-list--blocker">
            <strong>Adapter profile errors</strong>
            {adapterValidationErrors.map((message) => (
              <span key={message}>{message}</span>
            ))}
          </div>
        ) : null}

        {adapterValidationWarnings.length > 0 ? (
          <div className="notice-list notice-list--warning">
            <strong>Adapter profile warnings</strong>
            {adapterValidationWarnings.map((message) => (
              <span key={message}>{message}</span>
            ))}
          </div>
        ) : null}

        {viabilityReport ? (
          <>
            <div className="metric-grid">
              <div className="metric-card">
                <FieldLabel label="Requested bots" />
                <strong>{requestedBots}</strong>
              </div>
              <div className="metric-card">
                <FieldLabel
                  label="Total bot count"
                  helpText="This is the total number of bots the estimator recommends running. Visible-window limits do not lower this number. For example, 6 bots can run while only 1 game window is watched. More bots use more CPU and RAM. Beginners should start with 1 bot."
                />
                <strong>{viabilityReport.observation.totalBotCount}</strong>
              </div>
              <div className="metric-card">
                <FieldLabel label="Final bots" />
                <strong>{resolvedLaunchPlans.length}</strong>
              </div>
              <div className="metric-card">
                <FieldLabel
                  label="Total running instances"
                  helpText="This is the total number of game copies planned to run, including visible and background copies. Each copy can use CPU and RAM. A browser copy can run without a visible window. Beginners should use 1 instance for a first test."
                />
                <strong>{viabilityReport.observation.totalRunningGameInstances}</strong>
              </div>
              <div className="metric-card">
                <FieldLabel
                  label="Visible instances"
                  helpText="This is how many game copies the simulator recommends showing on screen. Visible browser windows use extra RAM and screen space. Other game copies can keep testing in the background. Beginners and laptop users should show only 1 window."
                />
                <strong>{viabilityReport.observation.recommendedVisibleGameInstances}</strong>
              </div>
              <div className="metric-card">
                <FieldLabel
                  label="Background instances"
                  helpText="This is how many game copies can keep running without being watched. Their bots still test the game normally. Background browser instances use fewer display resources. If this number is wrong, check Observation Mode and the visible-window limit. Stress and overnight tests should usually run in the background."
                />
                <strong>{viabilityReport.observation.backgroundGameInstances}</strong>
              </div>
              <div className="metric-card">
                <FieldLabel
                  label="Observation RAM"
                  helpText="This is the extra memory estimated for visible windows, action labels, and focus tracking. It is added on top of normal game and bot memory. For example, one headed browser may add a few hundred MB. If it is high, show fewer windows. Beginners should keep one visible window."
                />
                <strong>{viabilityReport.observation.estimatedRamMb} MB</strong>
              </div>
              <div className="metric-card">
                <FieldLabel label="Estimated RAM" />
                <strong>{viabilityReport.estimatedRamMb} MB</strong>
              </div>
              <div className="metric-card">
                <FieldLabel label="Estimated CPU" />
                <strong>{viabilityReport.estimatedCpuPercent}%</strong>
              </div>
            </div>

            <div className="notice-list">
              <FieldLabel
                label="Safe observation guidance"
                helpText="These are simple starting choices that reduce computer load. They do not change game behavior or remove bots. A laptop should normally show one window, a first test should watch one bot, and stress or overnight tests should run in the background."
              />
              <span>Use 1 visible window on a laptop.</span>
              <span>Watch 1 bot during a first test.</span>
              <span>Use background mode for stress tests.</span>
              <span>Use background mode for overnight tests.</span>
            </div>

            <div className="allocation-table">
              <div className="allocation-row allocation-row--head">
                <span>
                  <FieldLabel label="Bot profile" />
                </span>
                <span>
                  <FieldLabel label="Requested" />
                </span>
                <span>
                  <FieldLabel label="Recommended" />
                </span>
                <span>
                  <FieldLabel label="Reason" />
                </span>
              </div>
              {viabilityReport.botAllocation.map((allocation) => (
                <div className="allocation-row" key={allocation.profileId}>
                  <span>{allocation.profileId}</span>
                  <span>{allocation.requestedCount}</span>
                  <span>{allocation.recommendedCount}</span>
                  <span>{allocation.reason}</span>
                </div>
              ))}
            </div>

            <div className="allocation-table">
              <div className="launch-plan-row launch-plan-row--head">
                <span>
                  <FieldLabel label="Launch" />
                </span>
                <span>
                  <FieldLabel label="Bot ID" />
                </span>
                <span>
                  <FieldLabel label="Display" />
                </span>
                <span>
                  <FieldLabel label="Playstyle" />
                </span>
                <span>
                  <FieldLabel label="Instance" />
                </span>
              </div>
              {resolvedLaunchPlans.length === 0 ? (
                <div className="empty-row">No bots resolved from the current limits</div>
              ) : (
                resolvedLaunchPlans.map((plan) => (
                  <div className="launch-plan-row" key={plan.botId}>
                    <span>{plan.launchIndex}</span>
                    <span>{plan.botId}</span>
                    <span>{plan.displayName}</span>
                    <span>{plan.playstyle}</span>
                    <span>{plan.assignedGameInstanceId ?? 'Unassigned'}</span>
                  </div>
                ))
              )}
            </div>

            <div className="allocation-table">
              <div className="instance-row instance-row--head">
                <span>
                  <FieldLabel label="Instance" />
                </span>
                <span>
                  <FieldLabel label="Status" />
                </span>
                <span>
                  <FieldLabel label="Active bots" />
                </span>
                <span>
                  <FieldLabel label="Max bots" />
                </span>
                <span>
                  <FieldLabel label="Save/profile" />
                </span>
              </div>
              {!plannedGameInstances || plannedGameInstances.instances.length === 0 ? (
                <div className="empty-row">No game instances planned yet</div>
              ) : (
                plannedGameInstances.instances.map((instance) => (
                  <div className="instance-row" key={instance.instanceId}>
                    <span>{instance.instanceId}</span>
                    <span>{instance.status.status}</span>
                    <span>{instance.status.assignedBots.join(', ') || 'None'}</span>
                    <span>{instance.config.maxBots}</span>
                    <span>
                      {instance.config.saveProfileId ?? 'Shared/default'}
                      {instance.config.isolatedSaveDirectory ? <small>{instance.config.isolatedSaveDirectory}</small> : null}
                    </span>
                  </div>
                ))
              )}
            </div>

            {plannedGameInstances && plannedGameInstances.queuedBotIds.length > 0 ? (
              <div className="notice-list notice-list--warning">
                <strong>Queued bots</strong>
                <span>{plannedGameInstances.queuedBotIds.join(', ')}</span>
              </div>
            ) : null}

            {sharedSaveWarning ? (
              <div className="notice-list notice-list--warning">
                <FieldLabel label="Shared Save Warning" />
                <span>{sharedSaveWarning}</span>
              </div>
            ) : null}

            {plannedGameInstances && plannedGameInstances.warnings.length > 0 ? (
              <div className="notice-list notice-list--warning">
                <FieldLabel label="Instance planning" />
                {plannedGameInstances.warnings.map((warning) => (
                  <span key={warning}>{warning}</span>
                ))}
              </div>
            ) : null}

            {viabilityReport.warnings.length > 0 ? (
              <div className="notice-list notice-list--warning">
                <strong>Warnings</strong>
                {viabilityReport.warnings.map((warning) => (
                  <span key={warning}>{warning}</span>
                ))}
              </div>
            ) : null}

            {viabilityReport.blockers.length > 0 ? (
              <div className="notice-list notice-list--blocker">
                <strong>Blockers</strong>
                {viabilityReport.blockers.map((blocker) => (
                  <span key={blocker}>{blocker}</span>
                ))}
              </div>
            ) : null}

            {viabilityReport.canRun &&
            viabilityReport.warnings.length > 0 &&
            viabilityReport.blockers.length === 0 ? (
              <ToggleInput
                label="Run anyway"
                checked={runAnyway}
                onChange={(event) => setRunAnyway(event.target.checked)}
              />
            ) : null}
          </>
        ) : null}
      </section>

      <section className="viability-panel" aria-label="Backend session runtime">
        <div className="viability-panel__header">
          <div>
            <p className="eyebrow">Backend Runtime</p>
            <h2>Session runtime state</h2>
          </div>
          <span className="status-pill">{sessionStatus}</span>
        </div>

        <div className="metric-grid">
          <div className="metric-card">
            <FieldLabel label="Active session" />
            <strong>{activeSessionId ?? 'None'}</strong>
          </div>
          <div className="metric-card">
            <FieldLabel label="Runtime bots" />
            <strong>{runtimeBotStatuses.length}</strong>
          </div>
          <div className="metric-card">
            <FieldLabel label="Instances" />
            <strong>{runtimeInstanceStatuses.length}</strong>
          </div>
          <div className="metric-card">
            <FieldLabel label="Issues" />
            <strong>{runtimeIssues.length}</strong>
          </div>
          <div className="metric-card">
            <FieldLabel label="Logs" />
            <strong>{runtimeLogs.length}</strong>
          </div>
          <div className="metric-card">
            <FieldLabel label="Control" />
            <strong>{canStop ? 'Live' : 'Idle'}</strong>
          </div>
        </div>

        <div className="allocation-table">
          <div className="instance-row instance-row--head">
            <span>
              <FieldLabel label="Instance" />
            </span>
            <span>
              <FieldLabel label="Status" />
            </span>
            <span>
              <FieldLabel label="Assigned bots" />
            </span>
            <span>
              <FieldLabel label="Process" />
            </span>
            <span>
              <FieldLabel label="Heartbeat" />
            </span>
          </div>
          {runtimeInstanceStatuses.length === 0 ? (
            <div className="empty-row">No backend instance state yet</div>
          ) : (
            runtimeInstanceStatuses.map((instance) => (
              <div className="instance-row" key={instance.instanceId}>
                <span>{instance.instanceId}</span>
                <span>{instance.status}</span>
                <span>{instance.assignedBots.join(', ') || 'None'}</span>
                <span>{instance.processId ?? 'Mock'}</span>
                <span>{new Date(instance.lastHeartbeat).toLocaleTimeString()}</span>
              </div>
            ))
          )}
        </div>

        <div className="allocation-table">
          <div className="runtime-row runtime-row--head">
            <span>
              <FieldLabel label="Bot" />
            </span>
            <span>
              <FieldLabel label="Status" />
            </span>
            <span>
              <FieldLabel label="Instance" />
            </span>
            <span>
              <FieldLabel label="Last action" />
            </span>
            <span>
              <FieldLabel label="Message" />
            </span>
          </div>
          {runtimeBotStatuses.length === 0 ? (
            <div className="empty-row">No backend bot state yet</div>
          ) : (
            runtimeBotStatuses.slice(0, 10).map((bot) => (
              <div className="runtime-row" key={bot.botId}>
                <span>{bot.botId}</span>
                <span>{bot.status}</span>
                <span>{bot.gameInstanceId ?? 'Queued'}</span>
                <span>{bot.lastActionId ?? 'None'}</span>
                <span>{bot.message ?? ''}</span>
              </div>
            ))
          )}
        </div>

        {runtimeLogs.length > 0 ? (
          <div className="notice-list">
            <strong>Recent logs</strong>
            {runtimeLogs.slice(-4).map((log) => (
              <span key={log.id}>
                [{log.level}] {log.message}
              </span>
            ))}
          </div>
        ) : null}
      </section>

      <section className="form-section session-confirmation" aria-label="Session confirmation">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Before start</p>
            <h2>Session Confirmation</h2>
          </div>
          <span className="status-pill">
            {effectiveObservation.showBotGameplay ? 'Visible gameplay' : 'Background testing'}
          </span>
        </div>
        <div className="metric-grid">
          <div className="metric-card">
            <FieldLabel
              label="Session Observation Mode"
              helpText="This is the final visibility mode that will be saved with this test. It comes from the global setting or this session's override. Visible modes can use more CPU, RAM, and game windows. If the adapter cannot show a window, it continues in the background. Beginners should confirm Follow first bot for a smoke test or Background for a large test."
            />
            <strong>{effectiveObservation.observationMode}</strong>
          </div>
          <div className="metric-card">
            <FieldLabel
              label="Visible Window Limit"
              helpText="This is the final number of game windows the session may show. Other game instances can keep running in the background. A larger limit uses more CPU, RAM, and desktop space and only works when the adapter supports visible windows. Beginners should confirm 1."
            />
            <strong>{effectiveObservation.maxVisibleGameWindows}</strong>
          </div>
        </div>
        <div className="session-confirmation__directives">
          <FieldLabel
            label="Planned Test Directions"
            helpText="These are the user directions that will be saved with this session and shown in its logs and report. Each direction guides only the matching bots and never creates an action the adapter did not report. For example, an inventory direction can guide Inventory Stress Tester Bot for 30 actions. If this list is empty, bots use their normal profiles. Beginners should confirm each name and target before starting."
          />
          {form.directives.length === 0 ? (
            <div className="empty-row">No planned directions. Bots will use normal profile behavior.</div>
          ) : (
            <div className="planned-directive-list planned-directive-list--confirmation">
              {form.directives.map((directive) => (
                <div className="planned-directive-row" key={directive.directiveId}>
                  <div>
                    <strong>{directive.name}</strong>
                    <span>{directivePreviewText(directive, botProfiles)}</span>
                    <small>
                      {directiveTargetSummary(directive, botProfiles)} · {directive.directiveType} ·{' '}
                      {directive.priority} priority
                    </small>
                  </div>
                  <span className="status-pill">{directive.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="json-panel" aria-label="Run config preview">
        {validatedConfig ? <div className="success-text">Run config created</div> : null}
        <pre>{JSON.stringify(validatedConfig ?? preview, null, 2)}</pre>
      </section>
    </section>
  );
}
