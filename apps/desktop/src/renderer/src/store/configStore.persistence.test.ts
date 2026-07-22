// @vitest-environment jsdom

import { defaultRuntimeObservationConfig } from '@core/config/runtimeObservationConfig';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadRuntimeObservationPreference,
  RUNTIME_OBSERVATION_STORAGE_KEY,
  useConfigStore
} from './configStore';

describe('runtime observation preference persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useConfigStore.setState({ runtimeObservation: defaultRuntimeObservationConfig });
  });

  afterEach(() => {
    window.localStorage.clear();
    useConfigStore.setState({ runtimeObservation: defaultRuntimeObservationConfig });
  });

  it('writes updates and restores them through the validated restart loader', () => {
    useConfigStore.getState().updateRuntimeObservation({
      showBotGameplay: true,
      observationMode: 'follow-selected-bot',
      selectedBotId: 'ui-tester-bot-001',
      visibleActionDelayMs: 600,
      maxVisibleGameWindows: 2
    });

    expect(window.localStorage.getItem(RUNTIME_OBSERVATION_STORAGE_KEY)).not.toBeNull();
    const reloaded = loadRuntimeObservationPreference(window.localStorage);

    expect(reloaded).toMatchObject({
      showBotGameplay: true,
      observationMode: 'follow-selected-bot',
      selectedBotId: 'ui-tester-bot-001',
      visibleActionDelayMs: 600,
      maxVisibleGameWindows: 2
    });

    useConfigStore.setState({ runtimeObservation: defaultRuntimeObservationConfig });
    useConfigStore.setState({ runtimeObservation: reloaded });
    expect(useConfigStore.getState().runtimeObservation).toMatchObject({
      showBotGameplay: true,
      observationMode: 'follow-selected-bot',
      selectedBotId: 'ui-tester-bot-001'
    });
  });

  it('returns safe defaults when saved settings are damaged', () => {
    window.localStorage.setItem(RUNTIME_OBSERVATION_STORAGE_KEY, '{bad-json');

    expect(loadRuntimeObservationPreference(window.localStorage)).toEqual(
      defaultRuntimeObservationConfig
    );
  });
});
