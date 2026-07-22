// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { defaultRuntimeObservationConfig } from '@core/config/runtimeObservationConfig';
import { defaultAdvancedIntelligenceConfig } from '@core/config/advancedIntelligenceConfig';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppShell } from '../components/AppShell';
import { useConfigStore } from '../store/configStore';
import { SettingsPage } from './SettingsPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function renderSettings(inAppShell = false): HTMLDivElement {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root?.render(inAppShell ? <AppShell><SettingsPage /></AppShell> : <SettingsPage />);
  });

  return container;
}

function inputFor(id: string): HTMLInputElement {
  const input = document.querySelector(`#${id}`);

  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Missing input ${id}`);
  }

  return input;
}

function selectFor(id: string): HTMLSelectElement {
  const select = document.querySelector(`#${id}`);

  if (!(select instanceof HTMLSelectElement)) {
    throw new Error(`Missing select ${id}`);
  }

  return select;
}

beforeEach(() => {
  window.localStorage.clear();
  useConfigStore.setState({
    currentPage: 'settings',
    advancedIntelligence: defaultAdvancedIntelligenceConfig,
    runtimeObservation: defaultRuntimeObservationConfig
  });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  container?.remove();
  container = undefined;
  document.body.innerHTML = '';
  window.localStorage.clear();
  useConfigStore.setState({ runtimeObservation: defaultRuntimeObservationConfig });
});

describe('SettingsPage live bot observation', () => {
  it('renders every observation field with beginner help and safe defaults', () => {
    const page = renderSettings();

    expect(page.textContent).toContain('Live Bot Observation');
    expect(inputFor('show-bot-gameplay').checked).toBe(false);
    expect(selectFor('observation-mode').value).toBe('background');
    expect(selectFor('observation-mode').disabled).toBe(true);
    expect(inputFor('observation-selected-bot').disabled).toBe(true);
    expect(inputFor('bring-game-to-front-on-action').disabled).toBe(true);
    expect(inputFor('visible-action-delay').value).toBe('250');
    expect(inputFor('show-action-information').checked).toBe(true);
    expect(inputFor('maximum-visible-game-windows').value).toBe('1');

    for (const label of [
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

    expect(page.textContent).toContain('Visible browser or game windows can use more CPU and RAM');
    expect(page.textContent).toContain('Instrumented and custom adapters may stay in the background');
  });

  it('enables first-bot observation and lets the user choose all visible instances', () => {
    renderSettings();
    const showGameplay = inputFor('show-bot-gameplay');

    act(() => {
      showGameplay.click();
    });

    expect(useConfigStore.getState().runtimeObservation).toMatchObject({
      showBotGameplay: true,
      observationMode: 'follow-first-bot'
    });
    expect(selectFor('observation-mode').disabled).toBe(false);
    expect(inputFor('visible-action-delay').disabled).toBe(false);

    const mode = selectFor('observation-mode');
    act(() => {
      mode.value = 'show-all-instances';
      mode.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(useConfigStore.getState().runtimeObservation.observationMode).toBe('show-all-instances');
    expect(inputFor('observation-selected-bot').disabled).toBe(true);
  });

  it('enables the Follow Bot field only for selected-bot mode', () => {
    renderSettings();

    act(() => {
      inputFor('show-bot-gameplay').click();
    });

    const mode = selectFor('observation-mode');
    act(() => {
      mode.value = 'follow-selected-bot';
      mode.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(inputFor('observation-selected-bot').disabled).toBe(false);
  });

  it('keeps headings, notices, toggles, and help marks intact across sidebar breakpoints and live resize', () => {
    const page = renderSettings(true);

    for (const width of [1280, 900, 600, 1280]) {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });

      expect(page.querySelector('.app-layout')).not.toBeNull();
      expect(page.querySelector('.sidebar')).not.toBeNull();
      expect(page.textContent).toContain('Real Runtime Readiness');
      expect(page.textContent).toContain('Adapter-first');
      expect(page.textContent).toContain('Advanced Intelligence');
      expect(page.textContent).toContain('0 enabled');

      const notices = [...page.querySelectorAll('.settings-page .notice-list')];
      expect(notices.length).toBeGreaterThan(0);
      expect(notices.every((notice) => notice.closest('.form-section') !== null)).toBe(true);

      const longToggle = Array.from(page.querySelectorAll('.toggle-row')).find((toggle) =>
        toggle.textContent?.includes('Long Overnight Test Mode')
      );
      expect(longToggle?.querySelector('input')).not.toBeNull();
      expect(longToggle?.querySelector('.field-label__text + .field-help')).not.toBeNull();
    }
  });
});
