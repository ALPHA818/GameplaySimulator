// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    lastValidatedRunConfig: null
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
  });
});
