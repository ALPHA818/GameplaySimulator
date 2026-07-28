import type {
  BotDirectiveProgress,
  BotTestDirective,
  GameStateSnapshot,
  UIFlow
} from '../types';
import { describe, expect, it } from 'vitest';
import { defaultBotProfiles } from './defaultBotProfiles';
import { actionInsightFromAction, plannerMetadataForLog } from './ActionExplanation';
import { ActionPlanner, type AvailableGameActionLike } from './ActionPlanner';

const actions: AvailableGameActionLike[] = [
  { actionType: 'follow-main-objective', label: 'Follow Main Objective' },
  { actionType: 'attack-enemy', label: 'Attack Enemy' },
  { actionType: 'open-settings-menu', label: 'Open Settings Menu' },
  { actionType: 'buy-shop-item', label: 'Buy Shop Item' },
  { actionType: 'save-game', label: 'Save Game' },
  { actionType: 'boundary-jump-corner', label: 'Boundary Jump Corner' },
  { actionType: 'random-menu-spam', label: 'Random Menu Spam' },
  { actionType: 'idle-wait', label: 'Idle Wait' }
];

const state: GameStateSnapshot = {
  snapshotId: 'snapshot',
  sessionId: 'session',
  gameId: 'game',
  gameInstanceId: 'game-instance-001',
  botId: 'bot',
  capturedAt: '2026-07-04T10:00:00.000Z',
  scene: 'Start Area',
  state: {},
  metrics: {}
};

function profile(id: string) {
  const found = defaultBotProfiles.find((item) => item.profileId === id);

  if (!found) {
    throw new Error(`Missing test profile ${id}`);
  }

  return found;
}

function chooseAction(
  profileId: string,
  seed: number,
  actionIndex = 0,
  overrides: Partial<Parameters<ActionPlanner['chooseAction']>[0]> = {}
) {
  return new ActionPlanner().chooseAction({
    sessionId: 'session',
    gameInstanceId: 'game-instance-001',
    botId: `${profileId}-001`,
    profile: profile(profileId),
    state,
    availableActions: actions,
    actionIndex,
    now: '2026-07-04T10:00:00.000Z',
    seed,
    memory: {
      actionCount: actionIndex,
      stateCount: 1,
      errorCount: 0,
      recentActionTypes: []
    },
    coverageData: {
      visitedActions: [],
      visitedScenes: ['Start Area'],
      actionCounts: {},
      sceneCounts: { 'Start Area': 1 }
    },
    recentIssues: [],
    ...overrides
  });
}

function choose(profileId: string, seed: number, actionIndex = 0): string | null {
  return chooseAction(profileId, seed, actionIndex)?.type ?? null;
}

function activeDirective(overrides: Partial<BotTestDirective> = {}): BotTestDirective {
  return {
    directiveId: 'directive-001',
    sessionId: 'session',
    name: 'Test inventory sorting',
    description: 'Focus on opening and sorting the inventory.',
    directiveType: 'feature',
    directiveMode: 'focus',
    priority: 'high',
    status: 'active',
    target: {
      allBots: false,
      botIds: ['ui-tester-bot-001'],
      profileIds: [],
      gameInstanceIds: []
    },
    actionKeywords: ['sort-inventory'],
    avoidedActionKeywords: [],
    targetFeature: 'inventory sorting',
    successConditions: ['Inventory items are sorted.'],
    failureConditions: [],
    steps: [],
    repeatUntilSuccess: false,
    createdAt: '2026-07-04T09:59:00.000Z',
    activatedAt: '2026-07-04T10:00:00.000Z',
    createdBy: 'user',
    ...overrides
  };
}

function directiveProgress(
  directive: BotTestDirective,
  botId: string,
  overrides: Partial<BotDirectiveProgress> = {}
): BotDirectiveProgress {
  return {
    directiveId: directive.directiveId,
    botId,
    instanceId: 'game-instance-001',
    status: 'active',
    actionsAttempted: 0,
    attempts: 0,
    matchedActions: [],
    startedAt: '2026-07-04T10:00:00.000Z',
    updatedAt: '2026-07-04T10:00:00.000Z',
    ...overrides
  };
}

describe('ActionPlanner', () => {
  it('makes noticeably different choices for different profile types', () => {
    expect(choose('main-story-bot', 100)).toBe('follow-main-objective');
    expect(choose('combat-tester-bot', 100)).toBe('attack-enemy');
    expect(choose('ui-tester-bot', 100)).toBe('open-settings-menu');
    expect(choose('economy-tester-bot', 100)).toBe('buy-shop-item');
    expect(choose('save-load-tester-bot', 100)).toBe('save-game');
    expect(choose('boundary-breaker-bot', 100)).toBe('boundary-jump-corner');
  });

  it('detects every focused gameplay-system profile and uses its dedicated rule set', () => {
    const specialistCases = [
      ['crafting-recipe-tester-bot', 'crafting', 'select-recipe'],
      ['building-destruction-tester-bot', 'building', 'place-overlap'],
      ['physics-interaction-tester-bot', 'physics', 'high-speed-collision'],
      ['camera-view-tester-bot', 'camera', 'rotate-camera'],
      ['loot-random-drop-tester-bot', 'loot', 'trigger-loot-drop'],
      ['death-respawn-tester-bot', 'death', 'trigger-death'],
      ['npc-behaviour-tester-bot', 'npc', 'follow-npc'],
      ['boss-encounter-tester-bot', 'boss', 'start-boss-encounter'],
      ['procedural-generation-tester-bot', 'procedural', 'generate-world'],
      ['environment-cycle-tester-bot', 'environment', 'change-weather']
    ] as const;
    const availableActions = specialistCases.map(([, , actionType]) => ({ actionType }));

    for (const [profileId, expectedProfileKey, expectedAction] of specialistCases) {
      const selected = chooseAction(profileId, 100, 0, { availableActions });

      expect(selected?.type, profileId).toBe(expectedAction);
      expect(selected?.payload.profileKey, profileId).toBe(expectedProfileKey);
      expect(selected?.payload.reason, profileId).toContain('rule match');
    }
  });

  it('uses dedicated rules for controls, display, accessibility, and UX specialists', () => {
    const specialistCases = [
      ['keyboard-input-mapping-tester-bot', 'keyboard-input', 'press-key-combination'],
      ['controller-gamepad-tester-bot', 'controller', 'test-gamepad-dead-zone'],
      ['touch-mobile-controls-tester-bot', 'touch', 'multi-touch-control'],
      ['display-resolution-tester-bot', 'display', 'change-aspect-ratio'],
      ['localization-text-overflow-tester-bot', 'localization', 'switch-rtl-layout'],
      ['audio-subtitle-tester-bot', 'audio', 'inspect-subtitle-timing'],
      ['accessibility-tester-bot', 'accessibility', 'enable-reduced-motion'],
      ['settings-configuration-tester-bot', 'settings', 'verify-settings-persistence']
    ] as const;
    const availableActions = specialistCases.map(([, , actionType]) => ({ actionType }));

    for (const [profileId, expectedProfileKey, expectedAction] of specialistCases) {
      const selected = chooseAction(profileId, 100, 0, { availableActions });

      expect(selected?.type, profileId).toBe(expectedAction);
      expect(selected?.payload.profileKey, profileId).toBe(expectedProfileKey);
      expect(selected?.payload.explanation, profileId).toMatch(/preferred actions|profile rules/);
    }
  });

  it('uses dedicated rules for long-running and technical specialists', () => {
    const specialistCases = [
      ['loading-transition-tester-bot', 'transition', 'fast-travel'],
      ['network-resilience-tester-bot', 'network-resilience', 'simulate-packet-loss'],
      ['multiplayer-session-tester-bot', 'multiplayer', 'set-lobby-ready'],
      ['memory-leak-endurance-tester-bot', 'endurance', 'sample-memory'],
      ['save-migration-tester-bot', 'save-migration', 'run-save-migration'],
      ['world-persistence-tester-bot', 'world-persistence', 'verify-world-state'],
      ['achievement-unlock-tester-bot', 'achievement', 'trigger-achievement-unlock'],
      ['file-permission-tester-bot', 'file-permission', 'use-read-only-test-folder']
    ] as const;
    const availableActions = specialistCases.map(([, , actionType]) => ({ actionType }));

    for (const [profileId, expectedProfileKey, expectedAction] of specialistCases) {
      const selected = chooseAction(profileId, 100, 0, { availableActions });

      expect(selected?.type, profileId).toBe(expectedAction);
      expect(selected?.payload.profileKey, profileId).toBe(expectedProfileKey);
      expect(selected?.payload.explanation, profileId).toMatch(/preferred actions|profile rules/);
    }
  });

  it('routes every specialized profile through a named planner rule', () => {
    for (const specialist of defaultBotProfiles.filter(
      (candidate) => candidate.profileGroup === 'specialized'
    )) {
      const preferredAction = specialist.preferredActions?.[0];
      expect(preferredAction, specialist.profileId).toEqual(expect.any(String));

      const selected = chooseAction(specialist.profileId, 100, 0, {
        availableActions: [
          { actionType: preferredAction!, label: preferredAction },
          { actionType: 'unrelated-noop', label: 'Unrelated Noop' }
        ]
      });

      expect(selected?.type, specialist.profileId).toBe(preferredAction);
      expect(selected?.payload.profileKey, specialist.profileId).not.toBe('default');
    }
  });

  it('is deterministic when given the same seed', () => {
    const first = [0, 1, 2, 3].map((index) => choose('explorer-bot', 4242, index));
    const second = [0, 1, 2, 3].map((index) => choose('explorer-bot', 4242, index));

    expect(second).toEqual(first);
  });

  it('lets same-type bots diverge when their seeds differ', () => {
    const choices = new Set([1, 2, 3, 4, 5, 6].map((seed) => choose('explorer-bot', seed)));

    expect(choices.size).toBeGreaterThan(1);
  });

  it('makes chaos bots highly seed-sensitive while still reproducible per seed', () => {
    const chaosChoices = new Set(Array.from({ length: 12 }, (_item, index) => choose('chaos-monkey-bot', index + 1)));

    expect(choose('chaos-monkey-bot', 999)).toBe(choose('chaos-monkey-bot', 999));
    expect(chaosChoices.size).toBeGreaterThan(2);
  });

  it('explains profile decisions and assigns action quality labels', () => {
    const uiAction = chooseAction('ui-tester-bot', 100);
    const explorerAction = chooseAction('explorer-bot', 100);
    const chaosAction = chooseAction('chaos-monkey-bot', 7);

    expect(uiAction?.payload.explanation).toContain('matched UI profile rules');
    expect(explorerAction?.payload.quality).toBe('exploratory');
    expect(explorerAction?.payload.explanation).toContain('unvisited action');
    expect(chaosAction?.payload.quality).toBe('random');
    expect(chaosAction?.payload.explanation).toContain('chaos profile favors unpredictable, risky stress actions');
    expect(chaosAction?.payload.nextLikelyAction).toEqual(expect.any(String));
  });

  it('labels repeated and risky decisions', () => {
    const repeated = chooseAction('explorer-bot', 100, 2, {
      availableActions: [{ actionType: 'move-forward', label: 'Move Forward' }],
      memory: {
        actionCount: 2,
        stateCount: 2,
        errorCount: 0,
        recentActionTypes: ['move-forward']
      },
      coverageData: {
        visitedActions: ['move-forward']
      }
    });
    const risky = chooseAction('boundary-breaker-bot', 100, 0, {
      availableActions: [{ actionType: 'boundary-jump-corner', label: 'Boundary Jump Corner' }],
      coverageData: {
        visitedActions: ['boundary-jump-corner']
      }
    });

    expect(repeated?.payload.quality).toBe('repeated');
    expect(risky?.payload.quality).toBe('risky');
  });

  it('strongly shifts focus directives toward matching actions', () => {
    const directive = activeDirective();
    const botId = 'ui-tester-bot-001';
    const action = chooseAction('ui-tester-bot', 100, 0, {
      botId,
      availableActions: [
        { actionType: 'open-settings-menu', label: 'Open Settings' },
        { actionType: 'sort-inventory', label: 'Sort Inventory' }
      ],
      activeDirective: directive,
      directiveProgress: directiveProgress(directive, botId)
    });

    expect(action?.type).toBe('sort-inventory');
    expect(action?.payload.planner).toBe('user-directive');
    expect(action?.payload.quality).toBe('user-directed');
    expect(action?.payload.directiveId).toBe('directive-001');
    expect(action?.payload.directivePriority).toBe('high');
    expect(action?.payload.matchedKeywords).toContain('sort-inventory');
    expect(action?.payload.score).toBeGreaterThan(action?.payload.originalProfilePlannerScore as number);
    expect(action?.payload.explanation).toContain('user asked it to test inventory sorting');
    expect(actionInsightFromAction(action)?.quality).toBe('user-directed');
    expect(plannerMetadataForLog(action!)).toMatchObject({
      planner: 'user-directive',
      directiveId: 'directive-001',
      directiveName: 'Test inventory sorting',
      matchedKeywords: ['sort-inventory'],
      fallbackUsed: false
    });
  });

  it('adds moderate influence scoring without fabricating actions', () => {
    const botId = 'new-player-bot-001';
    const directive = activeDirective({
      directiveMode: 'influence',
      priority: 'normal',
      actionKeywords: ['inspect-right']
    });
    const action = chooseAction('new-player-bot', 19, 0, {
      botId,
      availableActions: [
        { actionType: 'inspect-left', label: 'Inspect Left' },
        { actionType: 'inspect-right', label: 'Inspect Right' }
      ],
      activeDirective: directive,
      directiveProgress: directiveProgress(directive, botId)
    });

    expect(action?.type).toBe('inspect-right');
    expect(action?.payload.score).toBeGreaterThan(action?.payload.originalProfilePlannerScore as number);
  });

  it('marks later repeat-until-condition attempts as directive retries', () => {
    const botId = 'ui-tester-bot-001';
    const directive = activeDirective({
      directiveMode: 'repeat-until-condition',
      actionKeywords: ['sort-inventory'],
      successConditions: ['Inventory order changes.']
    });
    const action = chooseAction('ui-tester-bot', 100, 1, {
      botId,
      availableActions: [
        { actionType: 'sort-inventory', label: 'Sort Inventory' },
        { actionType: 'open-settings-menu', label: 'Open Settings' }
      ],
      activeDirective: directive,
      directiveProgress: directiveProgress(directive, botId, { attempts: 1 })
    });

    expect(action?.type).toBe('sort-inventory');
    expect(action?.payload.quality).toBe('directive-retry');
    expect(action?.payload.directiveMode).toBe('repeat-until-condition');
  });

  it('executes an exact forced action only when the adapter reports it', () => {
    const botId = 'ui-tester-bot-001';
    const directive = activeDirective({
      directiveType: 'action',
      directiveMode: 'force-next-valid-action',
      priority: 'urgent',
      actionKeywords: ['open-inventory'],
      targetFeature: undefined
    });
    const action = chooseAction('ui-tester-bot', 100, 0, {
      botId,
      availableActions: [
        { actionType: 'open-settings-menu', label: 'Open Settings' },
        { actionType: 'open-inventory', label: 'Open Inventory' }
      ],
      activeDirective: directive,
      directiveProgress: directiveProgress(directive, botId)
    });

    expect(action?.type).toBe('open-inventory');
    expect(action?.payload.fallbackUsed).toBe(false);
    expect(action?.payload.directiveUnavailable).toBe(false);
  });

  it('uses a valid profile fallback when a forced action is unavailable', () => {
    const botId = 'ui-tester-bot-001';
    const directive = activeDirective({
      directiveType: 'action',
      directiveMode: 'force-next-valid-action',
      priority: 'urgent',
      actionKeywords: ['imaginary-action'],
      targetFeature: undefined
    });
    const availableActions = [
      { actionType: 'open-settings-menu', label: 'Open Settings' },
      { actionType: 'idle-wait', label: 'Wait' }
    ];
    const action = chooseAction('ui-tester-bot', 100, 0, {
      botId,
      availableActions,
      activeDirective: directive,
      directiveProgress: directiveProgress(directive, botId)
    });

    expect(availableActions.map((item) => item.actionType)).toContain(action?.type);
    expect(action?.type).not.toBe('imaginary-action');
    expect(action?.payload.fallbackUsed).toBe(true);
    expect(action?.payload.directiveUnavailable).toBe(true);
    expect(action?.payload.directiveOutcome).toBe('unavailable');
    expect(action?.payload.quality).toBe('directive-retry');
    expect(action?.payload.explanation).toContain('valid fallback');
  });

  it('follows only the current guided-sequence step', () => {
    const botId = 'ui-tester-bot-001';
    const directive = activeDirective({
      directiveType: 'sequence',
      directiveMode: 'guided-sequence',
      actionKeywords: [],
      targetFeature: undefined,
      steps: [
        {
          stepId: 'open-inventory',
          name: 'Open inventory',
          actionType: 'open-inventory',
          actionKeywords: ['inventory'],
          successCondition: 'The inventory is open.',
          maxAttempts: 2,
          waitAfterMs: 0
        },
        {
          stepId: 'sort-inventory',
          name: 'Sort inventory',
          actionType: 'sort-inventory',
          actionKeywords: ['sort'],
          successCondition: 'The inventory is sorted.',
          maxAttempts: 2,
          waitAfterMs: 250
        }
      ]
    });
    const action = chooseAction('ui-tester-bot', 100, 0, {
      botId,
      availableActions: [
        { actionType: 'open-inventory', label: 'Open Inventory' },
        { actionType: 'sort-inventory', label: 'Sort Inventory' }
      ],
      activeDirective: directive,
      directiveProgress: directiveProgress(directive, botId, {
        currentStepId: 'sort-inventory'
      })
    });

    expect(action?.type).toBe('sort-inventory');
    expect(action?.payload.directiveStepId).toBe('sort-inventory');
    expect(action?.payload.expectedCondition).toBe('The inventory is sorted.');
    expect(action?.payload.directiveWaitAfterMs).toBe(250);
    expect(action?.payload.quality).toBe('directive-sequence');
  });

  it('keeps required startup flow actions ahead of user directives', () => {
    const uiFlow: UIFlow = {
      flowId: 'start-game',
      name: 'Start Game',
      steps: [
        {
          stepId: 'press-play',
          actionType: 'press-play',
          targetLabel: 'Play'
        }
      ]
    };
    const botId = 'ui-journey-bot-001';
    const directive = activeDirective({
      directiveType: 'action',
      directiveMode: 'force-next-valid-action',
      priority: 'urgent',
      actionKeywords: ['open-inventory'],
      targetFeature: undefined
    });
    const action = chooseAction('ui-journey-bot', 50, 0, {
      botId,
      availableActions: [
        { actionType: 'press-play', label: 'Play' },
        { actionType: 'open-inventory', label: 'Inventory' }
      ],
      uiFlows: [uiFlow],
      activeDirective: directive,
      directiveProgress: directiveProgress(directive, botId)
    });

    expect(action?.type).toBe('press-play');
    expect(action?.payload.planner).toBe('ui-journey');
  });

  it('returns to normal profile planning after directive completion', () => {
    const botId = 'combat-tester-bot-001';
    const directive = activeDirective({ status: 'succeeded' });
    const action = chooseAction('combat-tester-bot', 100, 0, {
      botId,
      activeDirective: directive,
      directiveProgress: directiveProgress(directive, botId, { status: 'succeeded' })
    });

    expect(action?.type).toBe('attack-enemy');
    expect(action?.payload.planner).toBe('rule-based');
  });

  it('uses configured UI flows for the UI Journey Bot', () => {
    const uiFlow: UIFlow = {
      flowId: 'create-world',
      name: 'Create World',
      startState: 'main-menu',
      endState: 'world-loaded',
      steps: [
        {
          stepId: 'choose-play-game',
          expectedScreen: 'main-menu',
          actionType: 'choose-play-game',
          targetLabel: 'Play Game',
          keyBinding: 'Enter',
          waitAfterMs: 500
        }
      ]
    };
    const action = chooseAction('ui-journey-bot', 123, 0, {
      state: {
        ...state,
        scene: 'main-menu',
        state: {
          uiState: {
            screen: 'main-menu'
          }
        }
      },
      availableActions: [{ actionType: 'choose-play-game', label: 'Play Game' }],
      uiFlows: [uiFlow]
    });

    expect(action?.type).toBe('choose-play-game');
    expect(action?.payload.planner).toBe('ui-journey');
    expect(action?.payload.flowId).toBe('create-world');
    expect(action?.payload.binding).toBe('Enter');
    expect(action?.payload.quality).toBe('startup-flow');
    expect(action?.payload.explanation).toContain('next configured step');
  });

  it('can create a UI Journey action from configured fallback data when no actions are exposed', () => {
    const uiFlow: UIFlow = {
      flowId: 'desktop-create-world',
      name: 'Desktop Create World',
      steps: [
        {
          stepId: 'press-play',
          expectedScreen: 'main-menu',
          actionType: 'choose-play-game',
          targetLabel: 'Play Game',
          keyBinding: 'Enter',
          waitAfterMs: 750
        }
      ]
    };
    const action = chooseAction('ui-journey-bot', 456, 0, {
      availableActions: [],
      uiFlows: [uiFlow]
    });

    expect(action?.type).toBe('choose-play-game');
    expect(action?.payload.binding).toBe('Enter');
    expect(action?.payload.durationMs).toBe(750);
  });

  it('uses browser UI state and a visible button before a misleading page scene', () => {
    const uiFlow: UIFlow = {
      flowId: 'hexcraft-start',
      name: 'Start Hexcraft World',
      steps: [
        {
          stepId: 'create-world',
          expectedScreen: 'main-menu',
          actionType: 'choose-create-world',
          targetLabel: 'Create World'
        }
      ]
    };
    const action = chooseAction('ui-journey-bot', 912, 0, {
      state: {
        ...state,
        scene: 'Hexcraft Browser Window',
        uiState: {
          currentScreen: 'main-menu',
          openMenus: ['main-menu'],
          visibleButtons: [
            { label: 'Create World', selector: '#create-world', disabled: false }
          ],
          modalStack: [],
          canStartGame: true,
          isInGameplay: false,
          isPaused: false,
          isLoading: false,
          source: 'hook'
        }
      },
      availableActions: [],
      uiFlows: [uiFlow]
    });

    expect(action?.type).toBe('choose-create-world');
    expect(action?.payload.currentScreen).toBe('main-menu');
    expect(action?.payload.domTarget).toBe(true);
    expect(action?.payload.domTargetLabel).toBe('Create World');
    expect(action?.payload.domSelector).toBe('#create-world');
    expect(action?.payload.reason).toContain('visible UI button Create World');
  });
});
