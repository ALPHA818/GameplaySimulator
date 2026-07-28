// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppErrorBoundary } from './AppErrorBoundary';

function BrokenView(): never {
  throw new Error('Dashboard rendering failed');
}

describe('AppErrorBoundary', () => {
  let root: Root | undefined;

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = undefined;
    }
  });

  it('shows recovery actions instead of a blank renderer', async () => {
    Object.defineProperty(window, 'gameplaySimulator', {
      configurable: true,
      value: {
        app: {
          reportRendererError: vi.fn().mockResolvedValue(undefined),
          openApplicationLogs: vi.fn().mockResolvedValue({
            opened: true,
            message: 'Application logs opened.'
          })
        }
      }
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <AppErrorBoundary>
          <BrokenView />
        </AppErrorBoundary>
      );
    });

    expect(container.textContent).toContain('GameplaySimulator could not show this screen');
    expect(container.textContent).toContain('Dashboard rendering failed');
    expect(container.textContent).toContain('Reload Interface');
    expect(container.textContent).toContain('Open Application Logs');
    expect(container.textContent).toContain('Copy Error Details');
  });
});
