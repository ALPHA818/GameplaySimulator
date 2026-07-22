// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultRuntimeObservationConfig } from '@core/config/runtimeObservationConfig';
import type { RuntimeViabilityReport } from '@core/types';
import { useConfigStore } from '../store/configStore';
import { NewSessionPage } from './NewSessionPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialConfigState = useConfigStore.getState();
let root: Root | null = null;
let container: HTMLDivElement | null = null;

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  useConfigStore.setState({
    gameProfiles: initialConfigState.gameProfiles,
    botProfiles: initialConfigState.botProfiles,
    runConfigs: [],
    lastValidatedRunConfig: null,
    runtimeObservation: defaultRuntimeObservationConfig,
    advancedIntelligence: initialConfigState.advancedIntelligence
  });

  const pending = () => new Promise<never>(() => undefined);
  Object.defineProperty(window, 'gameplaySimulator', {
    configurable: true,
    value: {
      simulation: {
        estimateViability: vi.fn(pending),
        validateSessionConfig: vi.fn(pending)
      }
    }
  });

  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  root = null;
  container?.remove();
  container = null;
  vi.restoreAllMocks();
});

describe('New Session first-test templates', () => {
  it('reapplies the matching template and restores the small safety limits', () => {
    act(() => {
      root?.render(<NewSessionPage />);
    });

    const actionsInput = container?.querySelector('input[name="maxActionsPerBot"]');
    const applyButton = Array.from(container?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent?.trim() === 'Apply Template'
    );

    expect(actionsInput).toBeInstanceOf(HTMLInputElement);
    expect(applyButton).toBeInstanceOf(HTMLButtonElement);
    expect((actionsInput as HTMLInputElement).value).toBe('20');
    expect((applyButton as HTMLButtonElement).disabled).toBe(false);

    act(() => {
      setInputValue(actionsInput as HTMLInputElement, '200');
    });
    expect((actionsInput as HTMLInputElement).value).toBe('200');

    act(() => {
      (applyButton as HTMLButtonElement).click();
    });

    expect((actionsInput as HTMLInputElement).value).toBe('20');
    expect(container?.textContent).toContain(
      'Browser Smoke Test applied: one bot, 20 actions, one game instance, and video off.'
    );
    expect(container?.textContent).toContain('UI Tester Bot');
    expect((container?.querySelector('#use-global-observation-settings') as HTMLInputElement).checked).toBe(false);
    expect((container?.querySelector('#session-show-bot-gameplay') as HTMLInputElement).checked).toBe(true);
  });

  it('can inherit read-only global observation values or enable a session override', () => {
    act(() => {
      root?.render(<NewSessionPage />);
    });

    const useGlobal = container?.querySelector('#use-global-observation-settings') as HTMLInputElement;
    const showGameplay = container?.querySelector('#session-show-bot-gameplay') as HTMLInputElement;
    const observationMode = container?.querySelector('#session-observation-mode') as HTMLSelectElement;

    expect(useGlobal.checked).toBe(false);
    expect(showGameplay.checked).toBe(true);

    act(() => useGlobal.click());

    expect(useGlobal.checked).toBe(true);
    expect(showGameplay.checked).toBe(false);
    expect(showGameplay.disabled).toBe(true);
    expect(observationMode.value).toBe('background');
    expect(observationMode.disabled).toBe(true);

    act(() => useGlobal.click());
    act(() => showGameplay.click());

    expect(useGlobal.checked).toBe(false);
    expect(showGameplay.checked).toBe(true);
    expect(observationMode.disabled).toBe(false);
    expect(container?.textContent).toContain('Session Observation Mode');

    act(() => {
      observationMode.value = 'show-all-instances';
      observationMode.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(container?.textContent).toContain('Showing all game instances can open several windows');

    for (const label of [
      'Use Global Observation Settings',
      'Show Bot Gameplay',
      'Observation Mode',
      'Follow Bot',
      'Bring Game To Front On Action',
      'Visible Action Delay',
      'Show Action Information',
      'Maximum Visible Game Windows'
    ]) {
      expect(document.querySelector(`[aria-label="Help for ${label}"]`)).not.toBeNull();
    }
  });

  it('switches stress tests to a background-first session override', () => {
    act(() => {
      root?.render(<NewSessionPage />);
    });

    const sessionLabel = container?.querySelector('select[name="sessionLabel"]') as HTMLSelectElement;

    act(() => {
      sessionLabel.value = 'Stress Test';
      sessionLabel.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect((container?.querySelector('#use-global-observation-settings') as HTMLInputElement).checked).toBe(false);
    expect((container?.querySelector('#session-show-bot-gameplay') as HTMLInputElement).checked).toBe(false);
    expect((container?.querySelector('#session-observation-mode') as HTMLSelectElement).value).toBe('background');
  });

  it('keeps long overnight mode background-first even when a smoke template is recommended', () => {
    useConfigStore.setState({
      advancedIntelligence: {
        ...initialConfigState.advancedIntelligence,
        longOvernightTestMode: true
      }
    });

    act(() => {
      root?.render(<NewSessionPage />);
    });

    expect((container?.querySelector('#use-global-observation-settings') as HTMLInputElement).checked).toBe(false);
    expect((container?.querySelector('#session-show-bot-gameplay') as HTMLInputElement).checked).toBe(false);
    expect((container?.querySelector('#session-observation-mode') as HTMLSelectElement).value).toBe('background');
  });

  it('shows bot, total instance, visible instance, and background instance counts separately', async () => {
    const report: RuntimeViabilityReport = {
      canRun: true,
      recommendedTotalBots: 4,
      recommendedGameInstances: 3,
      warnings: ['Only 1 of 3 requested game windows is recommended as visible.'],
      blockers: [],
      estimatedCpuPercent: 42,
      estimatedRamMb: 2800,
      botAllocation: [],
      observation: {
        enabled: true,
        totalBotCount: 4,
        totalRunningGameInstances: 3,
        requestedVisibleGameInstances: 3,
        recommendedVisibleGameInstances: 1,
        backgroundGameInstances: 2,
        recommendedVisibleWindowLimit: 1,
        estimatedCpuPercent: 2.75,
        estimatedRamMb: 236,
        breakdown: {
          headedBrowserWindow: { cpuPercent: 2.4, ramMb: 220, gpuPercent: 1 },
          additionalVisibleWindows: { cpuPercent: 0, ramMb: 0, gpuPercent: 0 },
          actionOverlays: { cpuPercent: 0.15, ramMb: 8, gpuPercent: 0.05 },
          focusTracking: { cpuPercent: 0.2, ramMb: 8, gpuPercent: 0 }
        }
      }
    };
    Object.defineProperty(window, 'gameplaySimulator', {
      configurable: true,
      value: {
        simulation: {
          estimateViability: vi.fn(async () => report),
          validateSessionConfig: vi.fn(async () => ({ valid: true, errors: [], warnings: [] }))
        }
      }
    });

    await act(async () => {
      root?.render(<NewSessionPage />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain('Total bot count');
    expect(container?.textContent).toContain('Total running instances');
    expect(container?.textContent).toContain('Visible instances');
    expect(container?.textContent).toContain('Background instances');
    expect(container?.textContent).toContain('Safe observation guidance');
    expect(container?.textContent).toContain('Only 1 of 3 requested game windows');
    expect(document.querySelector('[aria-label="Help for Visible instances"]')).not.toBeNull();
  });
});
