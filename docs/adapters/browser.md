# Browser Adapter

`BrowserAdapter` is for browser games and local web builds. It is only one adapter in GameplaySimulator, not the main focus of the architecture.

## Best Integration Method

Use `BrowserAdapter` for games that run in a normal browser or local web runtime. For best results, add instrumentation to the game and expose structured state/actions through a local endpoint, `window` bridge, dev server route, or WebSocket.

Recommended browser implementation:

- Expose state from the game runtime rather than scraping DOM or canvas pixels.
- Emit events for scenes, menus, dialogue branches, quests, inventory, economy, errors, and performance.
- Provide safe direct actions for QA builds.
- Keep the bridge available only for local/dev/test builds.

## Fallback Method

Use browser-level input automation where available, or use `DesktopWindowAdapter` if the game is packaged as Electron, NW.js, WebView, or a desktop wrapper. For canvas/WebGL games without instrumentation, state awareness is limited.

## Data The Simulator Can Read

With instrumentation:

- Route, scene, level, UI screen, player state, inventory, currency, quests, rewards, flags.
- JavaScript errors, console warnings, network failures, frame timing, memory estimates.
- Coverage events from UI flows, levels, quests, NPCs, shops, minigames, endings, and achievements.

With browser-only fallback:

- Page URL/title.
- DOM text for DOM-based games.
- Screenshots.
- Console/log events if connected.
- Limited canvas/WebGL awareness.

## Actions The Simulator Can Perform

With instrumentation:

- Direct game actions exposed by the dev build.
- UI actions such as selecting menu entries, choosing dialogue, buying/selling, saving/loading, or entering test scenes.

With browser/input fallback:

- Keyboard and mouse events.
- Clicks, focus, navigation, reload.
- Screenshot capture.

## Limitations

- BrowserAdapter is not intended for unauthorized testing of third-party games.
- Canvas/WebGL games often expose little state unless instrumented.
- Browser security boundaries, CORS, iframes, and focus can limit direct control.
- Production web builds should not expose debug bridges unless intentionally protected for QA.

## Example Game Profile

```json
{
  "gameId": "browser-rpg",
  "gameName": "Browser RPG QA",
  "version": "0.4.0",
  "buildId": "local-dev",
  "engine": { "type": "browser" },
  "launch": {
    "url": "http://localhost:3000",
    "arguments": [],
    "platform": "browser"
  },
  "adapter": {
    "type": "browser",
    "supportsMultipleInstances": true,
    "supportsStateRead": true,
    "supportsDirectActions": true,
    "supportsScreenshots": true,
    "supportsVideo": false,
    "supportsSaveIsolation": true
  },
  "controls": [],
  "testingTargets": [],
  "progressSignals": [],
  "failureSignals": [],
  "knownContent": {
    "scenes": ["title", "town", "battle"],
    "levels": [],
    "quests": ["Find the Gate"],
    "mainQuests": ["Find the Gate"],
    "sideQuests": ["Lost Cat"],
    "optionalStories": [],
    "npcs": ["Guide"],
    "shops": ["Potion Shop"],
    "bosses": ["Slime King"],
    "items": ["Potion"],
    "menus": ["Inventory", "Settings"],
    "dialogueBranches": ["Guide greeting"],
    "minigames": ["Fishing"],
    "endings": [],
    "hiddenAreas": [],
    "postGameContent": [],
    "collectibles": [],
    "achievements": ["First Login"],
    "locations": ["Town"],
    "characters": ["Guide"],
    "mechanics": ["click movement"],
    "notes": []
  }
}
```

## Example Instrumentation State

```json
{
  "scene": "town",
  "route": "/play/town",
  "player": {
    "position": { "x": 42, "y": 18 },
    "alive": true,
    "canMove": true
  },
  "uiState": "inventory",
  "inventory": {
    "potion": { "quantity": 3 }
  },
  "currency": 50,
  "questFlags": {
    "intro_complete": true
  },
  "availableActions": ["move-forward", "interact", "open-settings-menu"],
  "browser": {
    "url": "http://localhost:3000/play/town",
    "consoleErrors": []
  }
}
```

## Recommended Dev-Build Setup

- Run the game locally with a stable dev server URL.
- Expose instrumentation only for localhost or authenticated internal QA sessions.
- Add deterministic fixtures and reset endpoints for repeatable tests.
- Emit JavaScript errors and rejected promises.
- Provide isolated storage profiles per bot or game instance.

