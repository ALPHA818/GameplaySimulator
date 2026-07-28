import { describe, expect, it } from 'vitest';
import {
  BotTestDirectiveSchema,
  DirectiveTargetSchema,
  resolveAvailableActionType,
  resolveDirectiveActionAvailability,
  type BotTestDirective
} from './botTestDirective';

function directive(overrides: Partial<BotTestDirective> = {}): BotTestDirective {
  return {
    directiveId: 'directive-001',
    sessionId: 'session-001',
    name: 'Open the inventory',
    description: 'Check that the inventory can be opened from gameplay.',
    directiveType: 'action',
    directiveMode: 'force-next-valid-action',
    priority: 'normal',
    status: 'queued',
    target: {
      allBots: false,
      botIds: ['ui-tester-001'],
      profileIds: [],
      gameInstanceIds: []
    },
    actionKeywords: ['open-inventory'],
    avoidedActionKeywords: [],
    successConditions: ['The inventory screen is open.'],
    failureConditions: [],
    steps: [],
    repeatUntilSuccess: false,
    createdAt: '2026-07-22T10:00:00.000Z',
    createdBy: 'user',
    ...overrides
  };
}

describe('BotTestDirectiveSchema', () => {
  it('strictly validates a force-next directive', () => {
    const parsed = BotTestDirectiveSchema.parse(
      directive({ manualSuccessConfirmation: true })
    );

    expect(parsed.actionKeywords).toEqual(['open-inventory']);
    expect(parsed.target.botIds).toEqual(['ui-tester-001']);
    expect(parsed.manualSuccessConfirmation).toBe(true);
  });

  it('rejects an unknown directive mode', () => {
    expect(
      BotTestDirectiveSchema.safeParse({
        ...directive(),
        directiveMode: 'always-do-exactly-this'
      }).success
    ).toBe(false);
  });

  it('rejects zero or negative action, attempt, and timeout limits', () => {
    for (const invalidLimits of [
      { maxActions: 0 },
      { maxAttempts: 0 },
      { timeoutMs: 0 },
      { maxActions: -1, maxAttempts: -1, timeoutMs: -1 }
    ]) {
      expect(
        BotTestDirectiveSchema.safeParse({
          ...directive(),
          ...invalidLimits
        }).success
      ).toBe(false);
    }
  });

  it('validates an expired directive and preserves its terminal timestamps', () => {
    const parsed = BotTestDirectiveSchema.parse(
      directive({
        status: 'expired',
        expiresAt: '2026-07-22T10:01:00.000Z',
        completedAt: '2026-07-22T10:02:00.000Z'
      })
    );

    expect(parsed.status).toBe('expired');
    expect(parsed.expiresAt).toBe('2026-07-22T10:01:00.000Z');
    expect(parsed.completedAt).toBe('2026-07-22T10:02:00.000Z');
  });

  it('supports all-bot, bot, profile, and game-instance targets', () => {
    const targets = [
      { allBots: true, botIds: [], profileIds: [], gameInstanceIds: [] },
      { allBots: false, botIds: ['bot-001'], profileIds: [], gameInstanceIds: [] },
      { allBots: false, botIds: [], profileIds: ['explorer'], gameInstanceIds: [] },
      { allBots: false, botIds: [], profileIds: [], gameInstanceIds: ['instance-001'] }
    ];

    targets.forEach((target) => expect(DirectiveTargetSchema.parse(target)).toEqual(target));
  });

  it('rejects missing, contradictory, and duplicate targets', () => {
    expect(() =>
      DirectiveTargetSchema.parse({
        allBots: false,
        botIds: [],
        profileIds: [],
        gameInstanceIds: []
      })
    ).toThrow(/Choose all bots/);
    expect(() =>
      DirectiveTargetSchema.parse({
        allBots: true,
        botIds: ['bot-001'],
        profileIds: [],
        gameInstanceIds: []
      })
    ).toThrow(/cannot be combined/);
    expect(() =>
      DirectiveTargetSchema.parse({
        allBots: false,
        botIds: ['bot-001', 'bot-001'],
        profileIds: [],
        gameInstanceIds: []
      })
    ).toThrow(/must not be repeated/);
  });

  it('requires a reported exact action and rejects unavailable actions', () => {
    const parsed = BotTestDirectiveSchema.parse(directive());
    const actions = [{ actionType: 'open-inventory' }, { actionType: 'move-forward' }];

    expect(resolveDirectiveActionAvailability(parsed, actions)).toEqual({
      available: true,
      actionType: 'open-inventory'
    });
    expect(resolveDirectiveActionAvailability(parsed, [{ actionType: 'move-forward' }])).toEqual({
      available: false,
      requestedActionType: 'open-inventory',
      reason: 'The adapter does not currently report open-inventory as an available action.'
    });
    expect(resolveAvailableActionType('imaginary-action', actions).available).toBe(false);
  });

  it('requires exactly one action type for force-next directives', () => {
    expect(() => BotTestDirectiveSchema.parse(directive({ actionKeywords: [] }))).toThrow(
      /exactly one reported action type/
    );
    expect(() =>
      BotTestDirectiveSchema.parse(
        directive({ actionKeywords: ['open-inventory', 'close-inventory'] })
      )
    ).toThrow(/exactly one reported action type/);
  });

  it('validates ordered guided sequences', () => {
    const parsed = BotTestDirectiveSchema.parse(
      directive({
        directiveType: 'sequence',
        directiveMode: 'guided-sequence',
        actionKeywords: [],
        steps: [
          {
            stepId: 'open-menu',
            name: 'Open menu',
            actionType: 'open-menu',
            actionKeywords: ['menu'],
            successCondition: 'The main menu is visible.',
            maxAttempts: 2,
            waitAfterMs: 250
          }
        ]
      })
    );

    expect(parsed.steps[0].actionType).toBe('open-menu');
    expect(() =>
      BotTestDirectiveSchema.parse(
        directive({
          directiveType: 'sequence',
          directiveMode: 'guided-sequence',
          actionKeywords: [],
          steps: []
        })
      )
    ).toThrow(/at least one step/);
  });

  it('requires type-specific targets and rejects unknown fields', () => {
    expect(() =>
      BotTestDirectiveSchema.parse({
        ...directive({ directiveType: 'scene', directiveMode: 'focus', actionKeywords: [] }),
        unexpected: true
      })
    ).toThrow();
    expect(() =>
      BotTestDirectiveSchema.parse(
        directive({ directiveType: 'ui-flow', directiveMode: 'focus', actionKeywords: [] })
      )
    ).toThrow(/targetUiFlowId is required/);
  });
});
