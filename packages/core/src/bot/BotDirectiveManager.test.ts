import { describe, expect, it } from 'vitest';
import type { BotTestDirective } from '../types';
import { BotDirectiveManager, type BotDirectiveAssignment } from './BotDirectiveManager';

const bots: BotDirectiveAssignment[] = [
  { botId: 'explorer-001', profileId: 'explorer', instanceId: 'instance-001' },
  { botId: 'explorer-002', profileId: 'explorer', instanceId: 'instance-002' },
  { botId: 'ui-tester-001', profileId: 'ui-tester', instanceId: 'instance-001' }
];

function directive(
  directiveId: string,
  overrides: Partial<BotTestDirective> = {}
): BotTestDirective {
  return {
    directiveId,
    sessionId: 'session-001',
    name: `Directive ${directiveId}`,
    description: 'Test a supported part of the game.',
    directiveType: 'feature',
    directiveMode: 'focus',
    priority: 'normal',
    status: 'queued',
    target: {
      allBots: true,
      botIds: [],
      profileIds: [],
      gameInstanceIds: []
    },
    actionKeywords: ['explore'],
    avoidedActionKeywords: [],
    targetFeature: 'exploration',
    successConditions: ['The feature was tested.'],
    failureConditions: [],
    steps: [],
    repeatUntilSuccess: false,
    createdAt: '2026-07-22T10:00:00.000Z',
    createdBy: 'user',
    ...overrides
  };
}

function manager(now = '2026-07-22T10:01:00.000Z'): BotDirectiveManager {
  return new BotDirectiveManager({
    sessionId: 'session-001',
    bots,
    now: () => now
  });
}

describe('BotDirectiveManager', () => {
  it('orders queued directives by priority and then creation order', () => {
    const subject = manager();
    subject.createDirective(directive('normal-first'));
    subject.createDirective(directive('urgent', { priority: 'urgent' }));
    subject.createDirective(directive('normal-second'));
    subject.queueDirective('normal-second');
    subject.queueDirective('normal-first');

    expect(subject.getQueuedDirectives().map((item) => item.directiveId)).toEqual([
      'urgent',
      'normal-first',
      'normal-second'
    ]);
  });

  it('assigns one directive to every matching bot with separate progress', () => {
    const subject = manager();
    subject.createDirective(
      directive('explore', {
        target: { allBots: false, botIds: [], profileIds: ['explorer'], gameInstanceIds: [] }
      })
    );

    const progress = subject.assignDirective('explore');

    expect(progress.map((item) => item.botId)).toEqual(['explorer-001', 'explorer-002']);
    expect(subject.getDirectivesForBot('ui-tester-001')).toEqual([]);
    expect(subject.getDirectivesForBot('explorer-001')).toHaveLength(1);
  });

  it('supports direct bot and instance targeting', () => {
    const subject = manager();
    subject.createDirective(
      directive('one-bot', {
        target: { allBots: false, botIds: ['ui-tester-001'], profileIds: [], gameInstanceIds: [] }
      })
    );
    subject.createDirective(
      directive('one-instance', {
        target: { allBots: false, botIds: [], profileIds: [], gameInstanceIds: ['instance-002'] }
      })
    );

    expect(subject.assignDirective('one-bot').map((item) => item.botId)).toEqual(['ui-tester-001']);
    expect(subject.assignDirective('one-instance').map((item) => item.botId)).toEqual(['explorer-002']);
  });

  it('allows one active directive per bot and chooses higher priority first', () => {
    const subject = manager();
    subject.createDirective(directive('normal'));
    subject.createDirective(directive('urgent', { priority: 'urgent' }));
    subject.assignDirective('normal');
    subject.assignDirective('urgent');

    expect(() => subject.activateDirective('normal', 'explorer-001')).toThrow(/higher-priority/);
    expect(subject.activateDirective('urgent', 'explorer-001')).toHaveLength(1);
    expect(subject.getActiveDirectiveForBot('explorer-001')?.directiveId).toBe('urgent');
    expect(() => subject.activateDirective('normal', 'explorer-001')).toThrow(/already has an active/);

    subject.markDirectiveSucceeded('urgent', 'explorer-001');
    expect(subject.activateDirective('normal', 'explorer-001')).toHaveLength(1);
  });

  it('keeps a multi-bot directive queued for other bots while one bot runs it', () => {
    const subject = manager();
    subject.createDirective(directive('multi'));
    subject.assignDirective('multi');

    subject.activateDirective('multi', 'explorer-001');

    expect(subject.getQueuedDirectives('explorer-002').map((item) => item.directiveId)).toEqual([
      'multi'
    ]);
    expect(subject.activateDirective('multi', 'explorer-002')).toHaveLength(1);
  });

  it('tracks progress and emits action and step lifecycle events', () => {
    const subject = manager();
    subject.createDirective(directive('progress'));
    subject.assignDirective('progress');
    subject.activateDirective('progress', 'explorer-001');

    const progress = subject.updateDirectiveProgress('progress', 'explorer-001', {
      currentStepId: 'step-001',
      actionsAttempted: 1,
      attempts: 1,
      matchedActions: ['move-forward'],
      lastAction: 'move-forward',
      lastResult: 'succeeded',
      progressMessage: 'Reached the path.'
    });
    subject.markDirectiveStepCompleted('progress', 'explorer-001', 'step-001');

    expect(progress.actionsAttempted).toBe(1);
    expect(subject.getEvents().map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        'directive_created',
        'directive_assigned',
        'directive_activated',
        'directive_action_selected',
        'directive_step_started',
        'directive_progress',
        'directive_step_completed'
      ])
    );
  });

  it('records directive outcomes, locations, conditions, issues, and terminal evidence', () => {
    const subject = manager();
    subject.createDirective(directive('measured'));
    subject.assignDirective('measured', [bots[0]]);
    subject.activateDirective('measured', 'explorer-001');
    subject.updateDirectiveProgress('measured', 'explorer-001', {
      actionsAttempted: 2,
      attempts: 2,
      matchedActions: ['inspect-path'],
      unrelatedActions: ['wait'],
      successfulActions: 1,
      failedActions: 1
    });
    subject.recordStateChange('measured', 'explorer-001', 'Entered Forest; inventory changed.', {
      scene: 'Forest',
      area: 'North path'
    });
    subject.recordConditionCheck(
      'measured',
      'explorer-001',
      'A new path is found.',
      true
    );
    subject.recordIssue('measured', 'explorer-001', 'issue-001');
    subject.markDirectiveStepFailed('measured', 'explorer-001', 'step-001', 'Action failed.');
    subject.markDirectiveFailed('measured', 'explorer-001', 'The path could not be completed.');
    subject.recordEvidence('measured', 'explorer-001', 'screenshot', '/runs/screenshot.png');
    subject.recordEvidence('measured', 'explorer-001', 'video', '/runs/video.webm');

    expect(subject.getProgress('measured', 'explorer-001')[0]).toMatchObject({
      status: 'failed',
      matchedActions: ['inspect-path'],
      unrelatedActions: ['wait'],
      successfulActions: 1,
      failedActions: 1,
      reachedScenes: ['Forest'],
      reachedAreas: ['North path'],
      observedStateChanges: ['Entered Forest; inventory changed.'],
      conditionsMet: ['A new path is found.'],
      issueIds: ['issue-001'],
      screenshotPaths: ['/runs/screenshot.png'],
      videoPaths: ['/runs/video.webm'],
      failureReason: 'The path could not be completed.'
    });
    expect(subject.getEvents().map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        'directive_state_changed',
        'directive_condition_checked',
        'directive_step_failed',
        'directive_failed',
        'directive_evidence_captured'
      ])
    );
  });

  it('cancels directive influence without controlling bot lifecycle', () => {
    const subject = manager();
    subject.createDirective(directive('cancel-me'));
    subject.assignDirective('cancel-me');
    subject.activateDirective('cancel-me', 'explorer-001');

    const cancelled = subject.cancelDirective('cancel-me');

    expect(cancelled.status).toBe('cancelled');
    expect(subject.getActiveDirectiveForBot('explorer-001')).toBeUndefined();
    expect(subject.getProgress('cancel-me').every((item) => item.status === 'cancelled')).toBe(true);
  });

  it('cancels an active directive for one bot without changing other assigned bots', () => {
    const subject = manager();
    subject.createDirective(directive('cancel-one'));
    subject.assignDirective('cancel-one');
    subject.activateDirective('cancel-one', 'explorer-001');
    subject.activateDirective('cancel-one', 'explorer-002');

    const cancelled = subject.cancelDirectiveForBot('cancel-one', 'explorer-001');

    expect(cancelled.status).toBe('active');
    expect(subject.getActiveDirectiveForBot('explorer-001')).toBeUndefined();
    expect(subject.getActiveDirectiveForBot('explorer-002')?.directiveId).toBe('cancel-one');
    expect(subject.getProgress('cancel-one', 'explorer-001')[0].status).toBe('cancelled');
    expect(subject.getProgress('cancel-one', 'explorer-002')[0].status).toBe('active');
  });

  it('expires active and queued directives and restores normal behavior', () => {
    const subject = manager('2026-07-22T10:05:00.000Z');
    subject.createDirective(
      directive('expired', { expiresAt: '2026-07-22T10:04:00.000Z' })
    );
    subject.assignDirective('expired');
    subject.activateDirective('expired', 'explorer-001');

    expect(subject.expireDirectives()).toHaveLength(1);
    expect(subject.getDirective('expired')?.status).toBe('expired');
    expect(subject.getActiveDirectiveForBot('explorer-001')).toBeUndefined();
  });

  it('expires an active per-bot directive when its runtime timeout is reached', () => {
    let now = '2026-07-22T10:01:00.000Z';
    const subject = new BotDirectiveManager({
      sessionId: 'session-001',
      bots,
      now: () => now
    });
    subject.createDirective(directive('timed', { timeoutMs: 30_000 }));
    subject.assignDirective('timed', [bots[0]]);
    subject.activateDirective('timed', 'explorer-001');

    now = '2026-07-22T10:01:31.000Z';

    expect(subject.expireDirectives()).toHaveLength(1);
    expect(subject.getDirective('timed')?.status).toBe('expired');
    expect(subject.getProgress('timed', 'explorer-001')[0]).toMatchObject({
      status: 'expired',
      failureReason: 'Directive exceeded its 30000 ms time limit.'
    });
    expect(subject.getActiveDirectiveForBot('explorer-001')).toBeUndefined();
  });

  it('reassigns stopped-bot work to another valid target', () => {
    const subject = manager();
    subject.createDirective(directive('reassign'));
    subject.assignDirective('reassign', [bots[0]]);

    const progress = subject.reassignDirective('reassign', 'explorer-001', bots[2]);

    expect(progress.botId).toBe('ui-tester-001');
    expect(progress.status).toBe('queued');
    expect(subject.getEvents().at(-1)?.eventType).toBe('directive_reassigned');
  });

  it('reorders same-priority queued directives without overriding priority', () => {
    const subject = manager();
    subject.createDirective(directive('first'));
    subject.createDirective(directive('second'));
    subject.createDirective(directive('urgent', { priority: 'urgent' }));

    subject.reorderDirectives(['second', 'first']);

    expect(subject.getQueuedDirectives().map((item) => item.directiveId)).toEqual([
      'urgent',
      'second',
      'first'
    ]);
  });

  it('clears only terminal directives', () => {
    const subject = manager();
    subject.createDirective(directive('done'));
    subject.createDirective(directive('waiting'));
    subject.assignDirective('done');
    subject.markDirectiveSucceeded('done');

    expect(subject.clearCompletedDirectives()).toBe(1);
    expect(subject.getDirective('done')).toBeUndefined();
    expect(subject.getDirective('waiting')).toBeDefined();
  });

  it('returns a renderer-safe snapshot without exposing mutable state', () => {
    const subject = manager();
    subject.createDirective(directive('snapshot'));
    subject.assignDirective('snapshot');

    const snapshot = subject.getSnapshot();
    snapshot.directives[0].name = 'Changed outside manager';

    expect(subject.getDirective('snapshot')?.name).toBe('Directive snapshot');
    expect(snapshot.progress).toHaveLength(3);
  });
});
