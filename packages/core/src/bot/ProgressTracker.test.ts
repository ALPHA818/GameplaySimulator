import type { ActionResult, GameAction, GameStateSnapshot } from '../types';
import { describe, expect, it } from 'vitest';
import { ProgressTracker } from './ProgressTracker';

function snapshot(input: {
  id: number;
  at?: string;
  scene?: string;
  position?: unknown;
  state?: Record<string, unknown>;
  metrics?: Record<string, number>;
}): GameStateSnapshot {
  return {
    snapshotId: `snapshot-${input.id}`,
    sessionId: 'session',
    gameId: 'game',
    gameInstanceId: 'game-instance-001',
    botId: 'bot-001',
    capturedAt: input.at ?? `2026-07-04T10:00:0${input.id}.000Z`,
    tick: input.id,
    scene: input.scene,
    state: {
      position: input.position,
      ...input.state
    },
    metrics: input.metrics ?? {}
  };
}

function action(type: string, index: number): GameAction {
  return {
    actionId: `action-${index}`,
    sessionId: 'session',
    gameInstanceId: 'game-instance-001',
    botId: 'bot-001',
    type,
    payload: {},
    requestedAt: `2026-07-04T10:00:${String(index).padStart(2, '0')}.000Z`
  };
}

function result(actionId: string, status: ActionResult['status'], index: number): ActionResult {
  return {
    actionId,
    botId: 'bot-001',
    status,
    completedAt: `2026-07-04T10:00:${String(index).padStart(2, '0')}.000Z`,
    durationMs: 1,
    issueIds: []
  };
}

describe('ProgressTracker', () => {
  it('reports progress when meaningful state changes are observed', () => {
    const tracker = new ProgressTracker();

    tracker.recordState(snapshot({ id: 1, scene: 'start', position: { x: 0, y: 0 } }));
    tracker.recordState(snapshot({ id: 2, scene: 'start', position: { x: 4, y: 0 } }));

    expect(tracker.isMakingProgress()).toBe(true);
    expect(tracker.isPossiblyStuck()).toBe(false);
    expect(tracker.getProgressSummary().latestPosition).toContain('x:4');
  });

  it('detects repeated no-action observations', () => {
    const tracker = new ProgressTracker({ noAvailableActionsLimit: 2 });

    tracker.recordAvailableActions(0, '2026-07-04T10:00:00.000Z');
    tracker.recordAvailableActions(0, '2026-07-04T10:00:01.000Z');

    expect(tracker.isPossiblyStuck()).toBe(true);
    expect(tracker.getStuckReason()).toContain('No available actions');
  });

  it('detects repeated failed actions', () => {
    const tracker = new ProgressTracker({ failedActionLimit: 2 });

    tracker.recordAction(action('move-forward', 1));
    tracker.recordActionResult(result('action-1', 'failed', 1));
    tracker.recordAction(action('move-forward', 2));
    tracker.recordActionResult(result('action-2', 'timed_out', 2));

    expect(tracker.isPossiblyStuck()).toBe(true);
    expect(tracker.getStuckReason()).toContain('repeatedly failing');
  });

  it('detects repeated same actions without progress', () => {
    const tracker = new ProgressTracker({ repeatedActionLimit: 3 });

    tracker.recordState(snapshot({ id: 1, scene: 'arena', position: { x: 1, y: 1 } }));
    for (let index = 1; index <= 3; index += 1) {
      tracker.recordAction(action('jump-corner', index));
      tracker.recordActionResult(result(`action-${index}`, 'succeeded', index));
    }

    expect(tracker.isPossiblyStuck()).toBe(true);
    expect(tracker.getStuckReason()).toContain('jump-corner');
  });

  it('detects stale heartbeat and unresponsive desktop-window state', () => {
    const tracker = new ProgressTracker({
      heartbeatTimeoutMs: 1000,
      unresponsiveLimit: 2
    });

    tracker.recordState(
      snapshot({
        id: 1,
        at: '2026-07-04T10:00:00.000Z',
        scene: 'desktop-window',
        state: {
          processAlive: true,
          processResponsive: false,
          lastHeartbeat: '2026-07-04T09:59:58.000Z'
        }
      })
    );
    tracker.recordHeartbeat('2026-07-04T09:59:58.000Z', false, '2026-07-04T10:00:02.000Z');

    expect(tracker.isPossiblyStuck()).toBe(true);
    expect(tracker.getStuckReason()).toMatch(/heartbeat|unresponsive/);
  });

  it('detects stable player position', () => {
    const tracker = new ProgressTracker({
      stablePositionLimit: 3,
      stableStateLimit: 99,
      stateLoopLimit: 99,
      noMeaningfulProgressMs: 999999
    });

    for (let index = 1; index <= 3; index += 1) {
      tracker.recordState(
        snapshot({
          id: index,
          scene: 'field',
          position: { x: 8, y: 12 },
          metrics: { frame: index }
        })
      );
    }

    expect(tracker.isPossiblyStuck()).toBe(true);
    expect(tracker.getStuckReason()).toContain('position');
  });
});
