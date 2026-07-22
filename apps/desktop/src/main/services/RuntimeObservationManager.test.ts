import { describe, expect, it } from 'vitest';
import { RuntimeObservationManager } from './RuntimeObservationManager';

const config = {
  showBotGameplay: true,
  observationMode: 'follow-first-bot' as const,
  bringGameToFrontOnAction: false,
  visibleActionDelayMs: 250,
  showActionInformation: true,
  maxVisibleGameWindows: 1
};

const bots = [
  { botId: 'explorer-001', status: 'running', gameInstanceId: 'instance-001' },
  { botId: 'explorer-002', status: 'running', gameInstanceId: 'instance-002' }
];

describe('RuntimeObservationManager', () => {
  it('defaults to the first running bot and navigates without changing bot status', () => {
    const manager = new RuntimeObservationManager(config);
    const first = manager.reconcile(bots);
    const next = manager.move('next', bots);
    const previous = manager.move('previous', bots);

    expect(first).toMatchObject({
      watchedBotId: 'explorer-001',
      watchedGameInstanceId: 'instance-001',
      reason: 'default'
    });
    expect(next?.watchedBotId).toBe('explorer-002');
    expect(previous?.watchedBotId).toBe('explorer-001');
    expect(bots.every((bot) => bot.status === 'running')).toBe(true);
  });

  it('automatically switches when the watched bot stops', () => {
    const manager = new RuntimeObservationManager(config);
    manager.follow('explorer-002', bots);

    const change = manager.reconcile([
      bots[0],
      { ...bots[1], status: 'stopped' }
    ]);

    expect(change).toMatchObject({
      previousBotId: 'explorer-002',
      watchedBotId: 'explorer-001',
      reason: 'stopped'
    });
    expect(change?.message).toContain('Switched to explorer-001');
  });

  it('keeps observation in the background after Stop Following', () => {
    const manager = new RuntimeObservationManager(config);
    manager.reconcile(bots);

    const stopped = manager.stopFollowing();

    expect(stopped.observationMode).toBe('background');
    expect(manager.selectedBotId).toBeUndefined();
    expect(manager.reconcile(bots)).toBeNull();
  });
});
