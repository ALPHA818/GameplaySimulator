import { describe, expect, it } from 'vitest';
import {
  applyRuntimeObservationToRunConfig,
  defaultRuntimeObservationConfig,
  hasRuntimeObservationOverrides,
  resolveRuntimeObservationConfig,
  RuntimeObservationConfigSchema
} from './runtimeObservationConfig';

describe('RuntimeObservationConfig', () => {
  it('defaults to safe background observation with one visible window', () => {
    expect(defaultRuntimeObservationConfig).toEqual({
      showBotGameplay: false,
      observationMode: 'background',
      bringGameToFrontOnAction: false,
      visibleActionDelayMs: 250,
      showActionInformation: true,
      maxVisibleGameWindows: 1
    });
  });

  it('accepts following one bot or showing all supported instances', () => {
    expect(
      RuntimeObservationConfigSchema.parse({
        showBotGameplay: true,
        observationMode: 'follow-selected-bot',
        selectedBotId: 'explorer-001',
        bringGameToFrontOnAction: true,
        visibleActionDelayMs: 500,
        showActionInformation: false,
        maxVisibleGameWindows: 3
      })
    ).toMatchObject({
      observationMode: 'follow-selected-bot',
      selectedBotId: 'explorer-001',
      maxVisibleGameWindows: 3
    });

    expect(
      RuntimeObservationConfigSchema.parse({ observationMode: 'show-all-instances' }).observationMode
    ).toBe('show-all-instances');
  });

  it('rejects unsafe numeric settings', () => {
    expect(
      RuntimeObservationConfigSchema.safeParse({ visibleActionDelayMs: -1 }).success
    ).toBe(false);
    expect(
      RuntimeObservationConfigSchema.safeParse({ maxVisibleGameWindows: 0 }).success
    ).toBe(false);
  });

  it('inherits global settings when a run has no overrides', () => {
    const globalConfig = RuntimeObservationConfigSchema.parse({
      showBotGameplay: true,
      observationMode: 'show-all-instances',
      maxVisibleGameWindows: 3
    });

    expect(hasRuntimeObservationOverrides({})).toBe(false);
    expect(resolveRuntimeObservationConfig({}, globalConfig)).toMatchObject({
      showBotGameplay: true,
      observationMode: 'show-all-instances',
      maxVisibleGameWindows: 3
    });
  });

  it('resolves and stores session overrides without changing unrelated global values', () => {
    const resolved = resolveRuntimeObservationConfig(
      {
        showBotGameplay: true,
        observationMode: 'follow-selected-bot',
        selectedObservationBotId: 'ui-tester-bot-001',
        visibleActionDelayMs: 700
      },
      defaultRuntimeObservationConfig
    );
    const stored = applyRuntimeObservationToRunConfig({ sessionId: 'session-1' }, resolved);

    expect(stored).toMatchObject({
      sessionId: 'session-1',
      showBotGameplay: true,
      observationMode: 'follow-selected-bot',
      selectedObservationBotId: 'ui-tester-bot-001',
      visibleActionDelayMs: 700,
      showActionInformation: true,
      maxVisibleGameWindows: 1
    });
  });

  it('gives an explicit session override priority over visible global defaults', () => {
    const globalConfig = RuntimeObservationConfigSchema.parse({
      showBotGameplay: true,
      observationMode: 'show-all-instances',
      bringGameToFrontOnAction: true,
      maxVisibleGameWindows: 4
    });
    const resolved = resolveRuntimeObservationConfig({
      showBotGameplay: false,
      observationMode: 'background',
      bringGameToFrontOnAction: false,
      maxVisibleGameWindows: 1
    }, globalConfig);

    expect(resolved).toMatchObject({
      showBotGameplay: false,
      observationMode: 'background',
      bringGameToFrontOnAction: false,
      maxVisibleGameWindows: 1
    });
  });
});
