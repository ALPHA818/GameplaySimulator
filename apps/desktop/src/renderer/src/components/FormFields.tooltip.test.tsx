// @vitest-environment jsdom

import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculateViewportSafeTooltipPosition, FieldLabel } from './FormFields';

type TestRect = {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
};

const mountedRoots: Root[] = [];
const mountedContainers: HTMLElement[] = [];

function render(ui: ReactNode) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  act(() => {
    root.render(ui);
  });

  mountedRoots.push(root);
  mountedContainers.push(container);

  return container;
}

function rect(overrides: TestRect): DOMRect {
  return {
    x: overrides.left,
    y: overrides.top,
    toJSON: () => overrides,
    ...overrides
  } as DOMRect;
}

function helpIcon(label = 'Game URL'): HTMLElement {
  const icon = document.querySelector(`[aria-label="Help for ${label}"]`);

  if (!(icon instanceof HTMLElement)) {
    throw new Error(`Missing help icon for ${label}`);
  }

  return icon;
}

function tooltip(): HTMLElement {
  const element = document.querySelector('[role="tooltip"]');

  if (!(element instanceof HTMLElement)) {
    throw new Error('Missing tooltip');
  }

  return element;
}

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  Object.defineProperty(window, 'scrollX', { configurable: true, value: 0 });
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
}

afterEach(() => {
  for (const root of mountedRoots) {
    act(() => {
      root.unmount();
    });
  }

  mountedRoots.length = 0;
  mountedContainers.length = 0;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('FieldHelp portal tooltip', () => {
  it('appears on hover and renders outside the field container', () => {
    setViewport(900, 700);
    const container = render(
      <div className="clipped-panel" style={{ overflow: 'hidden' }}>
        <FieldLabel label="Game URL" />
      </div>
    );
    const icon = helpIcon();
    vi.spyOn(icon, 'getBoundingClientRect').mockReturnValue(
      rect({ bottom: 36, height: 16, left: 20, right: 36, top: 20, width: 16 })
    );

    act(() => {
      icon.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: null }));
    });

    const visibleTooltip = tooltip();

    expect(visibleTooltip.textContent).toContain('This is the web address of the browser game.');
    expect(container.contains(visibleTooltip)).toBe(false);
    expect(visibleTooltip.parentElement).toBe(document.body);
  });

  it('appears on keyboard focus', () => {
    setViewport(900, 700);
    render(<FieldLabel label="Executable Path" />);
    const icon = helpIcon('Executable Path');
    vi.spyOn(icon, 'getBoundingClientRect').mockReturnValue(
      rect({ bottom: 86, height: 16, left: 80, right: 96, top: 70, width: 16 })
    );

    act(() => {
      icon.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });

    expect(tooltip().textContent).toContain('This is the file that starts your game.');
  });

  it('clamps a tooltip near the left edge into the viewport', () => {
    const position = calculateViewportSafeTooltipPosition(
      rect({ bottom: 86, height: 16, left: 0, right: 16, top: 70, width: 16 }),
      { width: 320, height: 120 },
      { height: 500, scrollX: 0, scrollY: 0, width: 700 },
      'bottom'
    );

    expect(position.left).toBe(12);
    expect(position.left + 320).toBeLessThanOrEqual(688);
  });

  it('clamps a tooltip near the right edge into the viewport', () => {
    const position = calculateViewportSafeTooltipPosition(
      rect({ bottom: 86, height: 16, left: 684, right: 700, top: 70, width: 16 }),
      { width: 320, height: 120 },
      { height: 500, scrollX: 0, scrollY: 0, width: 700 },
      'bottom'
    );

    expect(position.left).toBeGreaterThanOrEqual(12);
    expect(position.left + 320).toBeLessThanOrEqual(688);
  });

  it('falls back above the help icon near the bottom edge', () => {
    const position = calculateViewportSafeTooltipPosition(
      rect({ bottom: 296, height: 16, left: 390, right: 406, top: 280, width: 16 }),
      { width: 320, height: 120 },
      { height: 300, scrollX: 0, scrollY: 0, width: 400 },
      'bottom'
    );

    expect(position.placement).toBe('top');
    expect(position.left).toBeGreaterThanOrEqual(12);
    expect(position.left + 320).toBeLessThanOrEqual(388);
    expect(position.top).toBeGreaterThanOrEqual(12);
    expect(position.top + 120).toBeLessThanOrEqual(288);
    expect(position.maxWidth).toBe(360);
    expect(position.maxHeight).toBe(135);
  });

  it('renders above the sidebar without being trapped by its overflow', () => {
    setViewport(900, 700);
    const container = render(
      <aside className="sidebar" style={{ overflow: 'auto', position: 'sticky', zIndex: 10 }}>
        <FieldLabel label="Adapter Type" />
      </aside>
    );
    const icon = helpIcon('Adapter Type');
    vi.spyOn(icon, 'getBoundingClientRect').mockReturnValue(
      rect({ bottom: 216, height: 16, left: 12, right: 28, top: 200, width: 16 })
    );

    act(() => {
      icon.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: null }));
    });

    const visibleTooltip = tooltip();

    expect(container.contains(visibleTooltip)).toBe(false);
    expect(visibleTooltip.parentElement).toBe(document.body);
    expect(Number(visibleTooltip.style.zIndex)).toBeGreaterThan(10_000);
  });

  it('renders outside a scroll panel and closes when that panel scrolls', () => {
    setViewport(900, 700);
    const container = render(
      <div className="scroll-panel" style={{ height: 80, overflow: 'auto' }}>
        <div style={{ height: 400 }}>
          <FieldLabel label="Game URL" />
        </div>
      </div>
    );
    const panel = container.querySelector('.scroll-panel');
    const icon = helpIcon();

    if (!(panel instanceof HTMLElement)) {
      throw new Error('Missing scroll panel');
    }

    vi.spyOn(icon, 'getBoundingClientRect').mockReturnValue(
      rect({ bottom: 136, height: 16, left: 200, right: 216, top: 120, width: 16 })
    );

    act(() => {
      icon.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: null }));
    });

    expect(container.contains(tooltip())).toBe(false);

    act(() => {
      panel.dispatchEvent(new Event('scroll', { bubbles: false }));
    });

    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('closes when Escape is pressed', () => {
    setViewport(900, 700);
    render(<FieldLabel label="Game URL" />);
    const icon = helpIcon();
    vi.spyOn(icon, 'getBoundingClientRect').mockReturnValue(
      rect({ bottom: 36, height: 16, left: 20, right: 36, top: 20, width: 16 })
    );

    act(() => {
      icon.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });

    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });
});
