import type { GameAction } from '@core/types';
import { IssueDetectionRunner } from '@core/detection/IssueDetectors';
import { describe, expect, it } from 'vitest';
import { startInstrumentedTestServer } from '../../../../examples/instrumented-test-server/src/server';
import { InstrumentedAdapter } from './InstrumentedAdapter';

function action(type: string, actionId = `${type}-001`): GameAction {
  return {
    actionId,
    sessionId: 'sdk-test-session',
    gameInstanceId: 'game-instance-001',
    botId: 'explorer-001',
    type,
    payload: {},
    requestedAt: '2026-07-02T20:00:00.000Z'
  };
}

describe('InstrumentedAdapter', () => {
  it('connects to the example fake game server and reads structured state', async () => {
    const server = await startInstrumentedTestServer({ port: 0 });

    try {
      const adapter = new InstrumentedAdapter({ instrumentationEndpoint: server.endpoint });
      const instance = await adapter.launchInstance({
        instanceId: 'game-instance-001',
        gameProfileId: 'fake-instrumented-game',
        launch: { platform: 'linux', arguments: [] },
        maxBots: 2,
        environment: {}
      });

      expect(instance.metadata.instrumentationHealth).toMatchObject({
        ok: true,
        gameId: 'fake-instrumented-game'
      });

      const state = await adapter.getState('game-instance-001', 'explorer-001');
      const actions = await adapter.getAvailableActions('game-instance-001', 'explorer-001');

      expect(state?.scene).toBe('Start Area');
      expect(state?.state).toMatchObject({
        currency: 25,
        playerPosition: {
          x: 0,
          y: 0
        }
      });
      expect(state?.metrics.fps).toBe(60);
      expect(actions.map((item) => item.actionType)).toEqual(
        expect.arrayContaining(['move-forward', 'buy-item', 'trigger-crash'])
      );
    } finally {
      await server.stop();
    }
  });

  it('mutates fake game state through direct HTTP actions', async () => {
    const server = await startInstrumentedTestServer({ port: 0 });

    try {
      const adapter = new InstrumentedAdapter({ instrumentationEndpoint: server.endpoint });
      await adapter.launchInstance({
        instanceId: 'game-instance-001',
        gameProfileId: 'fake-instrumented-game',
        launch: { platform: 'linux', arguments: [] },
        maxBots: 2,
        environment: {}
      });

      const firstState = await adapter.getState('game-instance-001', 'explorer-001');
      const moveResult = await adapter.performAction('game-instance-001', 'explorer-001', action('move-forward'));
      const buyResult = await adapter.performAction('game-instance-001', 'explorer-001', action('buy-item'));
      const hiddenResult = await adapter.performAction(
        'game-instance-001',
        'explorer-001',
        action('enter-hidden-area')
      );
      const nextState = await adapter.getState('game-instance-001', 'explorer-001');

      expect(moveResult.status).toBe('succeeded');
      expect(buyResult.status).toBe('succeeded');
      expect(hiddenResult.status).toBe('succeeded');
      expect(nextState?.state.playerPosition).toMatchObject({ y: 12 });
      expect(nextState?.state.currency).toBe(20);
      expect(nextState?.scene).toBe('Hidden Grotto');
      expect(nextState?.state.inventory).toEqual(
        expect.arrayContaining([expect.objectContaining({ itemId: 'health-potion', quantity: 1 })])
      );
      expect(nextState?.tick).toBeGreaterThan(firstState?.tick ?? 0);
    } finally {
      await server.stop();
    }
  });

  it('exposes fake issue states that the detector pipeline can report', async () => {
    const server = await startInstrumentedTestServer({ port: 0 });

    try {
      const adapter = new InstrumentedAdapter({ instrumentationEndpoint: server.endpoint });
      const detector = new IssueDetectionRunner();
      await adapter.launchInstance({
        instanceId: 'game-instance-001',
        gameProfileId: 'fake-instrumented-game',
        launch: { platform: 'linux', arguments: [] },
        maxBots: 2,
        environment: {}
      });

      const beforeCrash = await adapter.getState('game-instance-001', 'explorer-001');
      const crashAction = action('trigger-crash');
      const crashResult = await adapter.performAction('game-instance-001', 'explorer-001', crashAction);
      const crashedState = await adapter.getState('game-instance-001', 'explorer-001');
      const issues = detector.detect({
        sessionId: 'sdk-test-session',
        botId: 'explorer-001',
        instanceId: 'game-instance-001',
        timestamp: '2026-07-02T20:00:01.000Z',
        memory: {
          previousState: beforeCrash,
          lastState: crashedState,
          lastAction: crashAction,
          lastResult: crashResult,
          recentActionTypes: ['trigger-crash']
        }
      });

      expect(crashResult.status).toBe('succeeded');
      expect(crashedState?.state.processStatus).toBe('crashed');
      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: 'crash',
            severity: 'critical',
            title: 'Game process crashed'
          })
        ])
      );
    } finally {
      await server.stop();
    }
  });
});
