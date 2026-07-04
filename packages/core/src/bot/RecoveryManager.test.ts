import { describe, expect, it } from 'vitest';
import { RecoveryManager } from './RecoveryManager';
import type { AvailableGameActionLike } from './ActionPlanner';

const baseOptions = {
  sessionId: 'session',
  gameInstanceId: 'game-instance-001',
  botId: 'explorer-001',
  now: () => '2026-07-04T10:00:00.000Z'
};

describe('RecoveryManager', () => {
  it('creates recovery actions in the safe default order', () => {
    const manager = new RecoveryManager(baseOptions);
    const first = manager.createNextAttempt({
      stuckReason: 'No available actions.',
      availableActions: []
    });
    const second = manager.createNextAttempt({
      stuckReason: 'No available actions.',
      availableActions: []
    });
    const third = manager.createNextAttempt({
      stuckReason: 'No available actions.',
      availableActions: []
    });

    expect(first?.recoveryType).toBe('wait');
    expect(first?.actions[0].type).toBe('wait');
    expect(second?.recoveryType).toBe('close-menu');
    expect(third?.recoveryType).toBe('open-menu-then-close-menu');
    expect(third?.actions.map((action) => action.type)).toEqual(['open-menu', 'close-menu']);
  });

  it('uses advertised adapter actions for reload-style recoveries', () => {
    const manager = new RecoveryManager({
      ...baseOptions,
      maxAttempts: 9
    });
    const availableActions: AvailableGameActionLike[] = [
      { actionType: 'load-checkpoint', label: 'Load Checkpoint' }
    ];

    let attempt = null;
    for (let index = 0; index < 9; index += 1) {
      attempt = manager.createNextAttempt({
        stuckReason: 'Loading screen has lasted too long.',
        availableActions
      });
    }

    expect(attempt?.recoveryType).toBe('reload-checkpoint');
    expect(attempt?.actions[0].type).toBe('load-checkpoint');
  });

  it('gates restart-game-instance behind explicit configuration', () => {
    const disabled = new RecoveryManager({
      ...baseOptions,
      maxAttempts: 12
    });
    const enabled = new RecoveryManager({
      ...baseOptions,
      maxAttempts: 12,
      allowRestartGameInstance: true
    });

    const disabledTypes = Array.from({ length: 12 }, () =>
      disabled.createNextAttempt({ stuckReason: 'Game instance heartbeat is stale.', availableActions: [] })?.recoveryType
    );
    const enabledTypes = Array.from({ length: 12 }, () =>
      enabled.createNextAttempt({ stuckReason: 'Game instance heartbeat is stale.', availableActions: [] })?.recoveryType
    );

    expect(disabledTypes).not.toContain('restart-game-instance');
    expect(enabledTypes).toContain('restart-game-instance');
  });
});
