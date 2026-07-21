# Browser Instrumentation Hooks

Browser game hooks are optional helpers for local, development, and permitted QA builds. They let `BrowserAdapter` understand game state and layered menus without guessing from pixels. Do not expose private debug data in a public production build.

## Small Working Example

Add a module like this after your game has started. Replace the sample variables and actions with calls into your own game code.

```js
const qaState = {
  tick: 0,
  scene: 'title',
  currentScreen: 'main-menu',
  paused: false,
  loading: false
};

window.__GAMEPLAY_SIM_STATE__ = ({ instanceId, botId }) => ({
  gameId: 'my-browser-game',
  instanceId,
  botId,
  scene: qaState.scene,
  tick: qaState.tick,
  timestamp: new Date().toISOString(),
  state: {
    player: { alive: true, canMove: qaState.scene === 'gameplay' },
    inventory: [],
    quests: []
  }
});

window.__GAMEPLAY_SIM_UI_STATE__ = () => ({
  currentScreen: qaState.currentScreen,
  openMenus: qaState.paused ? ['pause-menu'] : [],
  focusedElement: document.activeElement?.getAttribute('aria-label') ?? undefined,
  visibleButtons: [...document.querySelectorAll('button:not([hidden])')].map((button) => ({
    label: button.textContent.trim(),
    selector: button.id ? `[id="${button.id}"]` : undefined,
    disabled: button.disabled
  })),
  modalStack: [...document.querySelectorAll('[role="dialog"]')].map(
    (dialog) => dialog.getAttribute('aria-label') ?? 'dialog'
  ),
  canStartGame: qaState.currentScreen === 'main-menu',
  isInGameplay: qaState.scene === 'gameplay',
  isPaused: qaState.paused,
  isLoading: qaState.loading
});

window.__GAMEPLAY_SIM_ACTIONS__ = () => {
  if (qaState.currentScreen === 'main-menu') {
    return [{ actionType: 'start-game', label: 'Start Game' }];
  }

  return [
    { actionType: 'move-forward', label: 'Move Forward' },
    { actionType: 'open-menu', label: 'Open Menu' }
  ];
};

window.__GAMEPLAY_SIM_PERFORM_ACTION__ = async (action) => {
  if (action.type === 'start-game') {
    qaState.loading = true;
    qaState.currentScreen = 'loading';
    document.querySelector('#start-game')?.click();
    await new Promise((resolve) => setTimeout(resolve, 500));
    qaState.loading = false;
    qaState.scene = 'gameplay';
    qaState.currentScreen = 'gameplay';
  } else if (action.type === 'open-menu') {
    qaState.paused = true;
    qaState.currentScreen = 'pause-menu';
  } else {
    // Call your game's normal QA-safe action API here.
  }

  qaState.tick += 1;
  return { status: 'succeeded', message: `Handled ${action.type}` };
};
```

## Hook Rules

- `window.__GAMEPLAY_SIM_STATE__` can be an object or a function. It provides game state such as scene, player, inventory, quests, and performance.
- `window.__GAMEPLAY_SIM_UI_STATE__` can be an object or a function. It provides the current screen, menus, buttons, dialogs, and menu/gameplay flags.
- `window.__GAMEPLAY_SIM_ACTIONS__` can be an array or a function. It lists actions that are valid right now.
- `window.__GAMEPLAY_SIM_PERFORM_ACTION__` is a function. It receives the selected `GameAction` and returns a success, failure, skip, or timeout result.
- State, UI-state, and action-list functions may receive `{ instanceId, botId }` so a test build can keep instances separate.

Keep names stable and return plain data that can be copied as JSON. A hook error does not crash the simulator; `BrowserAdapter` falls back to weaker browser information.

## DOM Scan Mode

`DOM Scan Mode` helps games that do not expose UI hooks:

- `Fallback` is recommended. It scans visible buttons, headings, dialogs, menus, text, and canvas presence only when hook data has no useful UI clues.
- `Always` merges DOM clues with hook data. Use it while building or checking your hooks.
- `Off` disables DOM clues. Use it when the page is very large, UI data is sensitive, or hooks already provide everything bots need.

DOM scanning is bounded and reads only visible page information. Canvas and WebGL pixels do not reveal internal game state, so canvas-heavy games still benefit greatly from custom hooks.
