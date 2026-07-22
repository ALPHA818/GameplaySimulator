export interface BrowserActionIndicatorPayload {
  actionId: string;
  actionName: string;
  botId: string;
  botName: string;
  reason: string;
  input?: string;
  key?: string;
  clickPosition?: {
    x: number;
    y: number;
  };
  durationMs?: number;
}

// This function is serialized by Playwright and runs inside the game page.
export function renderBrowserActionIndicator(input: BrowserActionIndicatorPayload): void {
  const actionIndicatorMarker = '__GAMEPLAY_SIM_ACTION_INDICATOR__';
  void actionIndicatorMarker;

  const overlayAttribute = 'data-gameplay-simulator-overlay';
  const overlayId = 'gameplay-simulator-action-indicator';
  document.getElementById(overlayId)?.remove();

  const mark = <T extends HTMLElement>(element: T): T => {
    element.setAttribute(overlayAttribute, 'true');
    element.style.pointerEvents = 'none';
    return element;
  };
  const text = (value: string, maxLength: number): string =>
    value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 1))}...` : value;
  const root = mark(document.createElement('div'));
  root.id = overlayId;
  root.dataset.actionId = input.actionId;
  Object.assign(root.style, {
    all: 'initial',
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    pointerEvents: 'none',
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    color: '#f8fafc'
  });

  const card = mark(document.createElement('div'));
  Object.assign(card.style, {
    position: 'absolute',
    top: '16px',
    right: '16px',
    boxSizing: 'border-box',
    width: 'min(360px, calc(100vw - 32px))',
    maxHeight: 'min(240px, calc(100vh - 32px))',
    overflow: 'hidden',
    padding: '12px 14px',
    border: '1px solid rgba(148, 163, 184, 0.72)',
    borderRadius: '6px',
    background: 'rgba(15, 23, 42, 0.94)',
    boxShadow: '0 12px 28px rgba(0, 0, 0, 0.35)',
    lineHeight: '1.35'
  });

  const bot = mark(document.createElement('div'));
  bot.textContent = text(input.botName, 80);
  Object.assign(bot.style, {
    margin: '0 0 5px',
    color: '#93c5fd',
    fontSize: '12px',
    fontWeight: '700'
  });
  card.append(bot);

  const action = mark(document.createElement('div'));
  action.textContent = `Action: ${text(input.actionName, 100)}`;
  Object.assign(action.style, {
    margin: '0 0 3px',
    fontSize: '14px',
    fontWeight: '700'
  });
  card.append(action);

  if (input.input) {
    const actionInput = mark(document.createElement('div'));
    actionInput.textContent = `Input: ${text(input.input, 100)}`;
    Object.assign(actionInput.style, {
      margin: '0 0 3px',
      color: '#e2e8f0',
      fontSize: '12px'
    });
    card.append(actionInput);
  }

  if (input.key) {
    const key = mark(document.createElement('div'));
    key.textContent = `Key: ${text(input.key, 40)}`;
    Object.assign(key.style, {
      margin: '0 0 3px',
      color: '#fde68a',
      fontSize: '12px',
      fontWeight: '700'
    });
    card.append(key);
  }

  const reason = mark(document.createElement('div'));
  reason.textContent = `Reason: ${text(input.reason, 180)}`;
  Object.assign(reason.style, {
    margin: '5px 0 0',
    color: '#cbd5e1',
    fontSize: '12px'
  });
  card.append(reason);
  root.append(card);

  if (input.clickPosition) {
    const marker = mark(document.createElement('div'));
    marker.setAttribute('aria-hidden', 'true');
    Object.assign(marker.style, {
      position: 'absolute',
      left: `${input.clickPosition.x}px`,
      top: `${input.clickPosition.y}px`,
      width: '28px',
      height: '28px',
      boxSizing: 'border-box',
      border: '3px solid #facc15',
      borderRadius: '50%',
      boxShadow: '0 0 0 3px rgba(15, 23, 42, 0.7)',
      transform: 'translate(-50%, -50%)'
    });
    root.append(marker);
  }

  document.body?.append(root);
  window.setTimeout(() => {
    const current = document.getElementById(overlayId);
    if (current?.dataset.actionId === input.actionId) {
      current.remove();
    }
  }, Math.max(500, Math.min(input.durationMs ?? 1600, 5000)));
}

// This function is serialized by Playwright and runs inside the game page.
export function setBrowserActionIndicatorsHidden(hidden: boolean): void {
  const actionIndicatorVisibilityMarker = '__GAMEPLAY_SIM_ACTION_INDICATOR_VISIBILITY__';
  void actionIndicatorVisibilityMarker;

  document.querySelectorAll<HTMLElement>('[data-gameplay-simulator-overlay]').forEach((element) => {
    if (hidden) {
      if (!element.dataset.gameplaySimulatorPreviousVisibility) {
        element.dataset.gameplaySimulatorPreviousVisibility = element.style.visibility || 'visible';
      }
      element.style.setProperty('visibility', 'hidden', 'important');
      return;
    }

    const previous = element.dataset.gameplaySimulatorPreviousVisibility;
    element.style.visibility = previous === 'visible' ? '' : previous ?? '';
    delete element.dataset.gameplaySimulatorPreviousVisibility;
  });
}
