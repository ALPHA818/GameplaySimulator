import { describe, expect, it } from 'vitest';
import {
  InstrumentationEventSchema,
  InstrumentedActionSchema,
  InstrumentedGameStateSchema,
  PerformActionRequestSchema
} from './protocol';

describe('instrumentation protocol schemas', () => {
  it('validates structured state and direct actions', () => {
    const state = InstrumentedGameStateSchema.parse({
      gameId: 'sample',
      instanceId: 'instance-001',
      timestamp: '2026-07-02T20:00:00.000Z',
      playerPosition: { playerId: 'player', x: 1, y: 2 },
      uiState: { screenId: 'hud' },
      performance: { fps: 60 },
      state: { hp: 10 }
    });
    const action = InstrumentedActionSchema.parse({
      actionType: 'interact',
      label: 'Interact'
    });
    const request = PerformActionRequestSchema.parse({
      requestId: 'request-001',
      instanceId: 'instance-001',
      botId: 'explorer-001',
      actionType: 'interact'
    });

    expect(state.inventory).toEqual([]);
    expect(action.metadata).toEqual({});
    expect(request.payload).toEqual({});
  });

  it('validates coverage, quest, inventory, position, UI, and performance events', () => {
    const eventKinds = [
      'content.coverage',
      'quest.update',
      'inventory.update',
      'player.position',
      'ui.state',
      'performance.data'
    ] as const;

    for (const kind of eventKinds) {
      const event = InstrumentationEventSchema.parse({
        eventId: `${kind}-001`,
        kind,
        instanceId: 'instance-001',
        timestamp: '2026-07-02T20:00:00.000Z',
        name: kind,
        payload: {}
      });

      expect(event.severity).toBe('info');
    }
  });
});
