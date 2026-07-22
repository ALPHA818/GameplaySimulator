import type { BrowserUIState, BrowserVisibleButton } from '@core/types';
import type { AvailableGameAction } from '../base/GameAdapter';

export type BrowserUISource = BrowserUIState['source'];

export interface BrowserDomTarget {
  label?: string;
  selector?: string;
  x?: number;
  y?: number;
}

export interface BrowserDomClickResult {
  succeeded: boolean;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map(stringValue).filter((item): item is string => Boolean(item)))];
}

function visibleButton(value: unknown): BrowserVisibleButton | null {
  if (typeof value === 'string') {
    const label = stringValue(value);
    return label ? { label, disabled: false } : null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const label =
    stringValue(value.label) ??
    stringValue(value.text) ??
    stringValue(value.name) ??
    stringValue(value.ariaLabel);

  if (!label) {
    return null;
  }

  return {
    label,
    selector: stringValue(value.selector),
    role: stringValue(value.role),
    disabled: value.disabled === true,
    x: numberValue(value.x),
    y: numberValue(value.y)
  };
}

function visibleButtons(value: unknown): BrowserVisibleButton[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();

  return value.flatMap((item) => {
    const button = visibleButton(item);
    const key = button ? `${button.label.toLowerCase()}|${button.selector ?? ''}` : '';

    if (!button || seen.has(key)) {
      return [];
    }

    seen.add(key);
    return [button];
  });
}

export function normalizeBrowserUIState(value: unknown, source: BrowserUISource): BrowserUIState | null {
  if (typeof value === 'string') {
    const currentScreen = stringValue(value);

    return currentScreen
      ? {
          currentScreen,
          openMenus: [],
          visibleButtons: [],
          modalStack: [],
          canStartGame: false,
          isInGameplay: false,
          isPaused: false,
          isLoading: false,
          source
        }
      : null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const focusedElementValue = isRecord(value.focusedElement)
    ? value.focusedElement.label ?? value.focusedElement.id ?? value.focusedElement.name
    : value.focusedElement;
  const dom = isRecord(value.dom)
    ? {
        headings: stringList(value.dom.headings),
        dialogs: stringList(value.dom.dialogs),
        visibleText: stringList(value.dom.visibleText),
        hasCanvas: booleanValue(value.dom.hasCanvas),
        canvasCount: Math.max(0, Math.floor(numberValue(value.dom.canvasCount) ?? 0)),
        scannedAt: stringValue(value.dom.scannedAt) ?? new Date().toISOString()
      }
    : undefined;

  return {
    currentScreen:
      stringValue(value.currentScreen) ?? stringValue(value.screenId) ?? stringValue(value.screen),
    openMenus: stringList(value.openMenus),
    focusedElement:
      stringValue(focusedElementValue) ?? stringValue(value.focusedElementId),
    visibleButtons: visibleButtons(value.visibleButtons),
    modalStack: stringList(value.modalStack),
    canStartGame: booleanValue(value.canStartGame),
    isInGameplay: booleanValue(value.isInGameplay),
    isPaused: booleanValue(value.isPaused),
    isLoading: booleanValue(value.isLoading),
    source,
    dom
  };
}

function uniqueStrings(...groups: string[][]): string[] {
  return [...new Set(groups.flat())];
}

function uniqueButtons(...groups: BrowserVisibleButton[][]): BrowserVisibleButton[] {
  const seen = new Set<string>();

  return groups.flat().filter((button) => {
    const key = `${button.label.toLowerCase()}|${button.selector ?? ''}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export function mergeBrowserUIStates(
  preferred: BrowserUIState | null,
  fallback: BrowserUIState | null,
  source: BrowserUISource = 'merged'
): BrowserUIState | null {
  if (!preferred) {
    return fallback;
  }

  if (!fallback) {
    return preferred;
  }

  return {
    currentScreen: preferred.currentScreen ?? fallback.currentScreen,
    openMenus: uniqueStrings(preferred.openMenus, fallback.openMenus),
    focusedElement: preferred.focusedElement ?? fallback.focusedElement,
    visibleButtons: uniqueButtons(preferred.visibleButtons, fallback.visibleButtons),
    modalStack: uniqueStrings(preferred.modalStack, fallback.modalStack),
    canStartGame: preferred.canStartGame || fallback.canStartGame,
    isInGameplay: preferred.isInGameplay || fallback.isInGameplay,
    isPaused: preferred.isPaused || fallback.isPaused,
    isLoading: preferred.isLoading || fallback.isLoading,
    source,
    dom: preferred.dom ?? fallback.dom
  };
}

export function hasBrowserUIClues(uiState: BrowserUIState | null): boolean {
  return Boolean(
    uiState &&
      (uiState.currentScreen ||
        uiState.focusedElement ||
        uiState.openMenus.length > 0 ||
        uiState.visibleButtons.length > 0 ||
        uiState.modalStack.length > 0 ||
        uiState.canStartGame ||
        uiState.isInGameplay ||
        uiState.isPaused ||
        uiState.isLoading)
  );
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'button';
}

export function domActionsFromUIState(uiState: BrowserUIState | null): AvailableGameAction[] {
  if (!uiState) {
    return [];
  }

  return uiState.visibleButtons
    .filter((button) => !button.disabled)
    .map((button) => ({
      actionType: `click-${slug(button.label)}`,
      label: button.label,
      description: `Click the visible browser button labelled "${button.label}".`,
      requiresStateRead: true,
      requiresDirectAction: false,
      requiresInputSimulation: true,
      payloadSchema: {
        domTarget: true,
        domTargetLabel: button.label,
        domSelector: button.selector,
        x: button.x,
        y: button.y
      }
    }));
}

export function domTargetFromActionPayload(payload: Record<string, unknown>): BrowserDomTarget | null {
  const adapterPayload = isRecord(payload.adapterPayload) ? payload.adapterPayload : {};
  const domTarget = payload.domTarget === true || adapterPayload.domTarget === true;
  const label =
    stringValue(adapterPayload.domTargetLabel) ??
    stringValue(payload.domTargetLabel) ??
    stringValue(payload.targetLabel);
  const selector = stringValue(adapterPayload.domSelector) ?? stringValue(payload.domSelector);
  const x = numberValue(adapterPayload.x) ?? numberValue(payload.x);
  const y = numberValue(adapterPayload.y) ?? numberValue(payload.y);

  return domTarget || label || selector ? { label, selector, x, y } : null;
}

// This function is serialized by Playwright and runs inside the game page.
export function scanBrowserDom(): unknown {
  const scanMarker = '__GAMEPLAY_SIM_DOM_SCAN__';
  void scanMarker;

  const overlaySelector = '[data-gameplay-simulator-overlay]';
  const clean = (value: string | null | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim();
  const isSimulatorOverlay = (element: Element): boolean =>
    element.matches(overlaySelector) || Boolean(element.closest(overlaySelector));
  const isVisible = (element: Element): boolean => {
    if (isSimulatorOverlay(element)) {
      return false;
    }

    const node = element as HTMLElement;
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      Number(style.opacity || '1') > 0 &&
      rect.width > 0 &&
      rect.height > 0
    );
  };
  const labelFor = (element: Element): string => {
    const input = element as HTMLInputElement;
    return (
      clean(element.getAttribute('aria-label')) ||
      clean(element.getAttribute('title')) ||
      clean(input.value) ||
      clean(element.textContent)
    );
  };
  const selectorFor = (element: Element): string | undefined => {
    if (element.id) {
      return `[id="${element.id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
    }

    const testId = element.getAttribute('data-testid');
    if (testId) {
      return `[data-testid="${testId.replace(/"/g, '\\"')}"]`;
    }

    const name = element.getAttribute('name');
    if (name) {
      return `${element.tagName.toLowerCase()}[name="${name.replace(/"/g, '\\"')}"]`;
    }

    return undefined;
  };
  const unique = (values: string[]): string[] => [...new Set(values.filter(Boolean))];
  const labelledVisible = (selector: string, limit: number): string[] =>
    unique(
      [...document.querySelectorAll(selector)]
        .filter(isVisible)
        .map(labelFor)
        .filter(Boolean)
    ).slice(0, limit);
  const buttonElements = [
    ...document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]')
  ].filter(isVisible).slice(0, 50);
  const visibleButtons = buttonElements.flatMap((element) => {
    const label = labelFor(element);
    if (!label) {
      return [];
    }

    const rect = (element as HTMLElement).getBoundingClientRect();
    const input = element as HTMLInputElement;
    return [{
      label,
      selector: selectorFor(element),
      role: element.getAttribute('role') ?? element.tagName.toLowerCase(),
      disabled: input.disabled === true || element.getAttribute('aria-disabled') === 'true',
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2)
    }];
  });
  const headings = labelledVisible('h1, h2, h3, [role="heading"]', 20);
  const dialogs = labelledVisible('dialog[open], [role="dialog"], [aria-modal="true"]', 10);
  const openMenus = labelledVisible('[role="menu"], nav, [data-menu]:not([hidden]), [aria-expanded="true"]', 20);
  const modalStack = dialogs;
  const focusedElement = document.activeElement &&
    document.activeElement !== document.body &&
    !isSimulatorOverlay(document.activeElement)
    ? labelFor(document.activeElement) || document.activeElement.id || document.activeElement.tagName.toLowerCase()
    : undefined;
  const bodyClone = document.body?.cloneNode(true) as HTMLElement | undefined;
  bodyClone?.querySelectorAll(overlaySelector).forEach((element) => element.remove());
  const visibleText = unique(
    clean(bodyClone?.textContent)
      .split(/\n+/)
      .map((line) => clean(line).slice(0, 180))
      .filter(Boolean)
  ).slice(0, 80);
  const allText = clean([headings.join(' '), dialogs.join(' '), visibleButtons.map((button) => button.label).join(' '), visibleText.join(' ')].join(' ')).toLowerCase();
  const canvasCount = [...document.querySelectorAll('canvas')].filter(isVisible).length;
  const isLoading =
    [...document.querySelectorAll('[aria-busy="true"], progress, .loading, [data-loading="true"]')]
      .some((element) => !isSimulatorOverlay(element)) ||
    /\bloading\b|please wait|generating world/.test(allText);
  const isPaused = /\bpaused\b|pause menu/.test(allText) || visibleButtons.some((button) => /\bresume\b/i.test(button.label));
  const canStartGame = !isPaused && visibleButtons.some((button) =>
    /\b(play|play game|start|start game|start world|new game|create game|create world|continue)\b/i.test(button.label)
  );
  const explicitGameplay =
    document.body?.dataset.gameplay === 'true' ||
    document.documentElement.dataset.gameplay === 'true';
  const isInGameplay = explicitGameplay || (canvasCount > 0 && !isLoading && !isPaused && !canStartGame);
  const screenElement = [...document.querySelectorAll('[data-gameplay-screen]')]
    .find((element) => !isSimulatorOverlay(element));
  const explicitScreen = clean(
    document.body?.dataset.gameplayScreen ??
      document.body?.dataset.currentScreen ??
      document.body?.dataset.screen ??
      document.documentElement.dataset.gameplayScreen ??
      screenElement?.getAttribute('data-gameplay-screen')
  );
  const slugText = (value: string): string =>
    clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const firstHeading = headings[0] ?? '';
  let currentScreen = explicitScreen;

  if (!currentScreen && isLoading) {
    currentScreen = 'loading';
  } else if (!currentScreen && isPaused) {
    currentScreen = 'pause-menu';
  } else if (!currentScreen && /main menu|title screen/i.test(firstHeading)) {
    currentScreen = 'main-menu';
  } else if (!currentScreen && /create game|create world|game settings|play game|select world/i.test(firstHeading)) {
    currentScreen = slugText(firstHeading);
  } else if (!currentScreen && isInGameplay) {
    currentScreen = 'gameplay';
  } else if (!currentScreen && canStartGame) {
    currentScreen = 'main-menu';
  } else if (!currentScreen && firstHeading) {
    currentScreen = slugText(firstHeading);
  }

  return {
    currentScreen: currentScreen || undefined,
    openMenus,
    focusedElement,
    visibleButtons,
    modalStack,
    canStartGame,
    isInGameplay,
    isPaused,
    isLoading,
    dom: {
      headings,
      dialogs,
      visibleText,
      hasCanvas: canvasCount > 0,
      canvasCount,
      scannedAt: new Date().toISOString()
    }
  };
}

// This function is serialized by Playwright and runs inside the game page.
export function clickBrowserDomTarget(target: BrowserDomTarget): BrowserDomClickResult {
  const clickMarker = '__GAMEPLAY_SIM_DOM_CLICK__';
  void clickMarker;

  const overlaySelector = '[data-gameplay-simulator-overlay]';
  const clean = (value: string | null | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim();
  const normalize = (value: string | undefined): string => clean(value).toLowerCase();
  const isSimulatorOverlay = (element: Element): boolean =>
    element.matches(overlaySelector) || Boolean(element.closest(overlaySelector));
  const isVisible = (element: Element): boolean => {
    if (isSimulatorOverlay(element)) {
      return false;
    }

    const node = element as HTMLElement;
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  let element: HTMLElement | null = null;

  if (target.selector) {
    try {
      const selected = document.querySelector(target.selector);
      element = selected instanceof HTMLElement && isVisible(selected) ? selected : null;
    } catch {
      element = null;
    }
  }

  if (!element && target.label) {
    const wanted = normalize(target.label);
    const candidates = [
      ...document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]')
    ];
    const matched = candidates.find((candidate) => {
      const input = candidate as HTMLInputElement;
      const label =
        normalize(candidate.getAttribute('aria-label') ?? undefined) ||
        normalize(candidate.getAttribute('title') ?? undefined) ||
        normalize(input.value) ||
        normalize(candidate.textContent ?? undefined);
      return isVisible(candidate) && (label === wanted || label.includes(wanted));
    });
    element = matched instanceof HTMLElement ? matched : null;
  }

  if (element) {
    element.focus();
    element.click();
    return { succeeded: true, message: `Clicked visible button "${target.label ?? element.textContent ?? 'button'}".` };
  }

  if (typeof target.x === 'number' && typeof target.y === 'number') {
    const pointElement = document.elementFromPoint(target.x, target.y);
    if (pointElement instanceof HTMLElement && !isSimulatorOverlay(pointElement)) {
      pointElement.focus();
      pointElement.click();
      return { succeeded: true, message: `Clicked DOM target at ${target.x}, ${target.y}.` };
    }
  }

  return {
    succeeded: false,
    message: `Could not find a visible browser control${target.label ? ` labelled "${target.label}"` : ''}.`
  };
}
