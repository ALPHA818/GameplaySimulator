# Adapter Overview

GameplaySimulator is game-agnostic. It does not assume a browser game, a specific engine, or a specific input model. Games are connected through adapters, and the best adapter depends on how much control you have over the game build.

Use this simulator only for games you own, control, or have permission to test. Do not use adapters to bypass anti-cheat, exploit public multiplayer games, or violate a game's rules.

## Adapter Selection

| Game type | Best integration | Fallback | Use when |
| --- | --- | --- | --- |
| Unity | `InstrumentedAdapter` through the instrumentation SDK, optionally wrapped by `UnityAdapter` | `DesktopWindowAdapter` | You can add a QA-only MonoBehaviour/service or local endpoint. |
| Godot | `InstrumentedAdapter` through an autoload/local bridge, optionally wrapped by `GodotAdapter` | `DesktopWindowAdapter` | You can expose scene, node, quest, UI, and inventory state from a dev build. |
| Unreal | `InstrumentedAdapter` through a QA plugin/subsystem, optionally wrapped by `UnrealAdapter` | `DesktopWindowAdapter` | You can expose gameplay tags, level, pawn, UI, quest, and inventory state. |
| Browser game | `BrowserAdapter` or `InstrumentedAdapter` for local/dev web builds | `DesktopWindowAdapter` for packaged/electron/webview builds | The game actually runs in a browser or local web runtime. |
| Desktop game | `InstrumentedAdapter` if the game exposes a local API | `DesktopWindowAdapter` | The game is a normal executable with keyboard/mouse/controller input. |
| Custom engine | `InstrumentedAdapter` over local HTTP/WebSocket/file bridge | `DesktopWindowAdapter` | You control the engine and can emit structured state/actions. |

## Best Results

Instrumented adapters give the best results because the simulator can read structured state and perform safe direct actions:

- Current scene, level, area, player position, UI state, inventory, quests, flags, rewards, performance, and logs.
- Available actions such as move, interact, attack, open menu, choose dialogue, save, load, reload checkpoint, and dev-only test commands.
- Content coverage events for main story, side quests, NPCs, shops, bosses, dialogue branches, hidden areas, minigames, endings, post-game content, collectibles, and achievements.
- More accurate issue detection, exploit detection, stuck detection, and reproduction reports.

## Fallback Results

`DesktopWindowAdapter` works for many games but has weaker awareness. It can launch a process, focus a window where possible, send input, capture screenshots, and track basic process/window health. Without instrumentation, the simulator may only know:

- Process status and window status.
- Last action sent.
- Screenshot/evidence paths.
- Basic resource estimates.
- Limited telemetry supplied by the adapter.

That is still useful for smoke tests, input loops, UI navigation, crash detection, screenshot evidence, and broad compatibility checks, but reports are less precise than instrumented runs.

## Browser Is One Adapter

`BrowserAdapter` exists for browser games, local web builds, and web-hosted prototypes. It is only one adapter among many. GameplaySimulator is not browser-first; it is intended to test Unity, Godot, Unreal, desktop games, custom engines, browser games, RPG Maker, GameMaker, and future adapter types.

## Common Game Profile Shape

Every adapter is selected through a game profile:

```json
{
  "gameId": "my-game",
  "gameName": "My Game",
  "version": "0.9.0",
  "buildId": "qa-2026-07-04",
  "engine": {
    "type": "custom",
    "version": "dev"
  },
  "launch": {
    "executablePath": "/path/to/game",
    "workingDirectory": "/path/to",
    "arguments": ["--qa"],
    "platform": "linux"
  },
  "adapter": {
    "type": "instrumented",
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
    "scenes": ["Main Menu", "Town"],
    "levels": [],
    "quests": [],
    "mainQuests": ["Find the Gate"],
    "sideQuests": ["Lost Cat"],
    "optionalStories": [],
    "npcs": ["Guide"],
    "shops": ["General Store"],
    "bosses": ["Gate Guardian"],
    "items": ["Potion"],
    "menus": ["Inventory"],
    "dialogueBranches": ["Guide greeting"],
    "minigames": [],
    "endings": [],
    "hiddenAreas": [],
    "postGameContent": [],
    "collectibles": [],
    "achievements": [],
    "locations": ["Town"],
    "characters": ["Guide"],
    "mechanics": [],
    "notes": []
  }
}
```

## Common Instrumentation State

Instrumented games should expose a compact but useful state object:

```json
{
  "scene": "Town",
  "level": "TownHub",
  "player": {
    "position": { "x": 10.2, "y": 0.0, "z": 4.5 },
    "alive": true,
    "canMove": true
  },
  "uiState": "inventory",
  "inventory": {
    "potion": { "quantity": 3 }
  },
  "currency": 120,
  "questFlags": {
    "met_guide": true
  },
  "availableActions": ["move-forward", "interact", "open-menu"],
  "performance": {
    "fps": 58,
    "frameTimeMs": 17
  }
}
```

## Adapter Docs

- [Unity](./unity.md)
- [Godot](./godot.md)
- [Unreal](./unreal.md)
- [Browser](./browser.md)
- [Desktop Window](./desktop-window.md)
- [Custom Engine](./custom-engine.md)

