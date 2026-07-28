// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultRuntimeObservationConfig } from '@core/config/runtimeObservationConfig';
import type { RuntimeViabilityReport } from '@core/types';
import { useConfigStore } from '../store/configStore';
import { useSessionStore } from '../store/sessionStore';
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
    pendingSessionBotProfileId: null,
    pendingSessionBotProfileIds: []
  });
  useSessionStore.setState({ reviewIssueId: null });

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
  it('adds a user-created custom specialist profile to a new session', async () => {
    const source = initialConfigState.botProfiles.find(
      (profile) => profile.profileId === 'inventory-stress-tester-bot'
    );

    expect(source).toBeDefined();
    useConfigStore.setState({
      botProfiles: [
        ...initialConfigState.botProfiles,
        {
          ...source!,
          profileId: 'hexcraft-material-combination-tester',
          displayName: 'Hexcraft Material Combination Tester',
          botType: 'hexcraft-material-combination-tester',
          profileGroup: 'custom',
          specializationCategory: 'gameplay-systems',
          defaultEnabled: false
        }
      ],
      pendingSessionBotProfileId: 'hexcraft-material-combination-tester'
    });

    await act(async () => {
      root?.render(<NewSessionPage />);
    });

    expect(container?.textContent).toContain(
      'Hexcraft Material Combination Tester added to this session.'
    );
    expect(container?.textContent).toContain('hexcraft-material-combination-tester');
    expect(useConfigStore.getState().pendingSessionBotProfileId).toBeNull();
  });

  it('consumes a bot profile selected from the Bot Profiles page', async () => {
    useConfigStore.setState({ pendingSessionBotProfileId: 'save-load-tester-bot' });

    await act(async () => {
      root?.render(<NewSessionPage />);
    });

    expect(container?.textContent).toContain('Save Load Tester Bot added to this session.');
    expect(container?.textContent).toContain('save-load-tester-bot');
    expect(useConfigStore.getState().pendingSessionBotProfileId).toBeNull();
  });

  it('consumes an explicit batch of recommended profiles without duplicating pools', async () => {
    useConfigStore.setState({
      pendingSessionBotProfileIds: [
        'crafting-recipe-tester-bot',
        'building-destruction-tester-bot',
        'crafting-recipe-tester-bot'
      ]
    });

    await act(async () => {
      root?.render(<NewSessionPage />);
    });

    expect(container?.textContent).toContain('2 recommended bot profiles added to this session.');
    expect(container?.textContent).toContain('crafting-recipe-tester-bot');
    expect(container?.textContent).toContain('building-destruction-tester-bot');
    expect(useConfigStore.getState().pendingSessionBotProfileIds).toEqual([]);
  });

  it('shows guarded technical-test inputs with beginner hover help', async () => {
    useConfigStore.setState({ pendingSessionBotProfileId: 'network-resilience-tester-bot' });

    await act(async () => {
      root?.render(<NewSessionPage />);
    });

    const addPoolSelect = Array.from(container?.querySelectorAll('select') ?? []).find(
      (select) => select.labels?.[0]?.textContent?.includes('Add Bot Type')
    ) as HTMLSelectElement;
    const addPoolButton = Array.from(container?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent?.trim() === 'Add Pool'
    ) as HTMLButtonElement;

    for (const profileId of [
      'memory-leak-endurance-tester-bot',
      'save-migration-tester-bot',
      'file-permission-tester-bot'
    ]) {
      act(() => {
        addPoolSelect.value = profileId;
        addPoolSelect.dispatchEvent(new Event('change', { bubbles: true }));
      });
      act(() => addPoolButton.click());
    }

    expect(container?.textContent).toContain('Technical Test Safeguards');
    expect(container?.textContent).toContain('Public matchmaking automation and anti-cheat bypasses are not supported');
    expect(container?.textContent).toContain('Endurance testing can use substantial CPU, RAM, disk space, and time');
    for (const label of [
      'Controlled Network Test Confirmed',
      'Save Migration Test Files',
      'Approved File Test Directories',
      'Technical Test Warnings'
    ]) {
      expect(document.querySelector(`[aria-label="Help for ${label}"]`)).not.toBeNull();
    }
  });

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

  it('applies a focused template as one specialist pool plus one editable directive', async () => {
    await act(async () => {
      root?.render(<NewSessionPage />);
    });

    const focusedTemplate = container?.querySelector(
      '#focused-test-template'
    ) as HTMLSelectElement;
    const applyFocusedTest = Array.from(container?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent?.trim() === 'Apply Focused Test'
    ) as HTMLButtonElement;

    expect(focusedTemplate).toBeInstanceOf(HTMLSelectElement);
    expect(applyFocusedTest).toBeInstanceOf(HTMLButtonElement);
    expect(Array.from(focusedTemplate.options).map((option) => option.textContent)).toContain(
      'Test Crafting System'
    );

    act(() => applyFocusedTest.click());

    expect(container?.textContent).toContain(
      'Test Crafting System applied: Crafting And Recipe Tester Bot'
    );
    expect(container?.textContent).toContain('crafting-recipe-tester-bot');
    expect(container?.textContent).toContain('Test crafting recipes and output integrity');
    expect((container?.querySelector('input[name="maxActionsPerBot"]') as HTMLInputElement).value)
      .toBe('30');
    expect((container?.querySelector('input[name="maxRuntimeMinutes"]') as HTMLInputElement).value)
      .toBe('15');

    const plannedDirection = Array.from(
      container?.querySelectorAll('.planned-directive-row') ?? []
    ).find((row) => row.textContent?.includes('Test crafting recipes and output integrity'));
    const editButton = Array.from(plannedDirection?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent?.trim() === 'Edit'
    ) as HTMLButtonElement;

    expect(editButton).toBeInstanceOf(HTMLButtonElement);
    act(() => editButton.click());

    const directionName = container?.querySelector(
      'input[name="directiveName"]'
    ) as HTMLInputElement;
    expect(directionName.value).toBe('Test crafting recipes and output integrity');

    act(() => setInputValue(directionName, 'Test Hexcraft material combinations'));
    const updateDirection = Array.from(container?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent?.trim() === 'Update Direction'
    ) as HTMLButtonElement;
    act(() => updateDirection.click());

    expect(container?.textContent).toContain('Test Hexcraft material combinations');
    expect(container?.textContent).not.toContain('2 planned');
  });

  it('shows every focused template and beginner field help', async () => {
    await act(async () => {
      root?.render(<NewSessionPage />);
    });

    const options = Array.from(
      (container?.querySelector('#focused-test-template') as HTMLSelectElement).options
    ).map((option) => option.textContent);

    expect(options).toEqual([
      'Test Crafting System',
      'Test Building System',
      'Test Inventory Integrity',
      'Test Save And Reload',
      'Test Main Menu And Settings',
      'Test Controller Inputs',
      'Test Mobile Controls',
      'Test Resolution And UI Scaling',
      'Test NPC Navigation',
      'Test Boss Encounter',
      'Test Procedural World Generation',
      'Test Day/Night And Weather',
      'Test Loading Transitions',
      'Test Long-Term Memory Use',
      'Reproduce Selected Issue'
    ]);

    for (const label of [
      'Focused Test Template',
      'Selected Specialist Bot',
      'Focused Bot Compatibility',
      'Required Capabilities',
      'What The Focused Test Does',
      'Focused Test Limitations',
      'Focused Test Recommendation',
      'Focused Test Safety Limits'
    ]) {
      expect(document.querySelector(`[aria-label="Help for ${label}"]`), label).not.toBeNull();
    }
  });

  it('passes the selected issue into the issue reproduction focused template', async () => {
    useSessionStore.setState({ reviewIssueId: 'issue-hexcraft-017' });

    await act(async () => {
      root?.render(<NewSessionPage />);
    });

    const focusedTemplate = container?.querySelector(
      '#focused-test-template'
    ) as HTMLSelectElement;
    act(() => {
      focusedTemplate.value = 'reproduce-selected-issue';
      focusedTemplate.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const applyFocusedTest = Array.from(container?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent?.trim() === 'Apply Focused Test'
    ) as HTMLButtonElement;
    act(() => applyFocusedTest.click());

    const plannedDirection = Array.from(
      container?.querySelectorAll('.planned-directive-row') ?? []
    ).find((row) => row.textContent?.includes('Reproduce the selected issue'));
    const editButton = Array.from(plannedDirection?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent?.trim() === 'Edit'
    ) as HTMLButtonElement;
    act(() => editButton.click());

    expect(
      (container?.querySelector('input[name="directiveTargetIssue"]') as HTMLInputElement).value
    ).toBe('issue-hexcraft-017');
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

  it('does not expose unavailable video or mock-runtime controls in the beginner session form', () => {
    act(() => {
      root?.render(<NewSessionPage />);
    });

    expect(container?.textContent).not.toContain('Save video');
    expect(container?.textContent).not.toContain('Use mock runtime');
    expect(container?.textContent).toContain('Session runtime state');
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

  it('creates a beginner test direction and shows it in the session confirmation', () => {
    act(() => {
      root?.render(<NewSessionPage />);
    });

    const targetProfile = container?.querySelector(
      'select[name="directiveTargetProfile"]'
    ) as HTMLSelectElement;
    const manualConfirmation = Array.from(
      container?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? []
    ).find((input) => input.labels?.[0]?.textContent?.includes('Manual Success Confirmation'));
    const addButton = Array.from(container?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent?.trim() === 'Add Direction'
    );

    expect(targetProfile).toBeInstanceOf(HTMLSelectElement);
    expect(manualConfirmation).toBeInstanceOf(HTMLInputElement);
    expect(addButton).toBeInstanceOf(HTMLButtonElement);

    act(() => {
      targetProfile.value = 'ui-tester-bot';
      targetProfile.dispatchEvent(new Event('change', { bubbles: true }));
      manualConfirmation?.click();
    });

    act(() => {
      (addButton as HTMLButtonElement).click();
    });

    expect(container?.textContent).toContain('1 planned');
    expect(container?.textContent).toContain('Test inventory sorting');
    expect(container?.textContent).toContain(
      'strongly guide UI Tester Bot toward inventory-related actions for up to 30 actions'
    );
    expect(container?.textContent).toContain('queued');

    const preview = container?.querySelector('.json-panel pre')?.textContent ?? '';
    expect(preview).toContain('"directives"');
    expect(preview).toContain('"manualSuccessConfirmation": true');
    expect(preview).toContain('"profileIds": [\n          "ui-tester-bot"');
  });

  it('offers all beginner direction templates, setup warnings, and field help', () => {
    act(() => {
      root?.render(<NewSessionPage />);
    });

    const template = container?.querySelector('#directive-template') as HTMLSelectElement;
    expect(Array.from(template.options).map((option) => option.textContent)).toEqual([
      'Test this menu',
      'Test this button',
      'Test this game area',
      'Test this feature',
      'Repeat this action',
      'Try to reproduce an issue',
      'Follow this sequence',
      'Test this setting',
      'Test saving and loading',
      'Test controls'
    ]);
    expect(container?.textContent).toContain('No enabled bot currently matches this assignment');
    expect(container?.textContent).toContain(
      'This success condition cannot be measured reliably from the selected profile'
    );

    for (const label of [
      'Direction Template',
      'Direction Name',
      'What Should Be Tested?',
      'Direction Type',
      'Direction Strength',
      'Priority',
      'Assign To',
      'Target Bot',
      'Target Bot Type',
      'Target Game Instance',
      'Action Keywords',
      'Actions To Avoid',
      'Scene Or Area',
      'Success Condition',
      'Maximum Actions',
      'Maximum Attempts',
      'Time Limit',
      'Repeat Until Successful',
      'Manual Success Confirmation',
      'Add Test Direction'
    ]) {
      expect(document.querySelector(`[aria-label="Help for ${label}"]`)).not.toBeNull();
    }
  });
});
