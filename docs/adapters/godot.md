# Godot Adapter

Godot projects work best when a QA-only autoload exposes structured game state and safe direct actions to GameplaySimulator.

## Best Integration Method

Use `InstrumentedAdapter` with a Godot autoload singleton or editor/dev-only plugin. A `GodotAdapter` can wrap instrumented mode and fall back to desktop window/input mode when the bridge is unavailable.

Recommended Godot implementation:

- Create an autoload singleton such as `GameplaySimulatorBridge`.
- Start a local HTTP or WebSocket endpoint in QA builds.
- Serialize current scene, node paths, player state, resources, signals, quest data, UI focus, inventory, and performance data.
- Register direct actions as safe callables.
- Emit coverage events from signals, scene transitions, quest updates, UI screens, item changes, dialogue branches, and minigames.

## Fallback Method

Use `DesktopWindowAdapter` for exported Godot desktop builds. This supports launching, focus, input simulation, screenshots, and process status, but it cannot see Godot nodes or resources unless the game exposes them.

## Data The Simulator Can Read

With instrumentation:

- Current scene path and active gameplay nodes.
- Player position, velocity, health, movement lock state.
- UI focus, modal/dialogue/menu state.
- Inventory resources, quest resources, flags, rewards, save/load state.
- Godot errors/warnings if forwarded.
- Content coverage and custom events.

With desktop fallback:

- Process/window state.
- Screenshots and last known input.
- Basic runtime health.

## Actions The Simulator Can Perform

With instrumentation:

- Call mapped Godot methods for movement, interaction, dialogue selection, menu navigation, combat, save/load, and checkpoint reload.
- Trigger safe QA-only methods such as reset test profile or load test scene.

With desktop fallback:

- Keyboard and mouse input based on `controls`.
- Screenshots and safe stop.

## Limitations

- Autoload bridges must be disabled or gated outside internal QA builds.
- Node names and resource structures can change often, so keep state payloads stable and versioned.
- Desktop fallback is weaker for canvas-heavy games, UI-only games, and games with custom input capture.

## Example Game Profile

```json
{
  "gameId": "godot-platformer",
  "gameName": "Godot Platformer QA",
  "version": "0.8.0",
  "buildId": "qa-linux",
  "engine": { "type": "godot", "version": "4.3" },
  "launch": {
    "executablePath": "/games/godot-platformer/Game.x86_64",
    "workingDirectory": "/games/godot-platformer",
    "arguments": ["--qa", "--gsi-port=4317"],
    "platform": "linux"
  },
  "adapter": {
    "type": "godot",
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
    "scenes": ["res://scenes/main_menu.tscn", "res://levels/forest_01.tscn"],
    "levels": ["forest_01"],
    "quests": [],
    "mainQuests": ["Reach the Forest Gate"],
    "sideQuests": ["Find the Lost Seed"],
    "optionalStories": [],
    "npcs": ["Forest Guide"],
    "shops": [],
    "bosses": ["Moss Golem"],
    "items": ["Seed", "Double Jump Charm"],
    "menus": ["Pause", "Inventory"],
    "dialogueBranches": ["Forest Guide intro"],
    "minigames": [],
    "endings": [],
    "hiddenAreas": ["Forest Hollow"],
    "postGameContent": [],
    "collectibles": ["Blue Leaf"],
    "achievements": ["First Jump"],
    "locations": ["Forest"],
    "characters": ["Forest Guide"],
    "mechanics": ["jump", "dash"],
    "notes": []
  }
}
```

## Example Instrumentation State

```json
{
  "scene": "res://levels/forest_01.tscn",
  "level": "forest_01",
  "player": {
    "nodePath": "/root/Level/Player",
    "position": { "x": 220.0, "y": 64.0 },
    "alive": true,
    "canMove": true
  },
  "uiState": "none",
  "inventory": {
    "seed": { "quantity": 1 }
  },
  "questFlags": {
    "forest_gate_seen": true
  },
  "availableActions": ["move-right", "jump", "interact"],
  "godot": {
    "fps": 60,
    "focusedControl": null
  }
}
```

## Recommended Dev-Build Setup

- Enable the bridge only for debug/export presets used by QA.
- Bind local endpoints to `127.0.0.1`.
- Emit signal-based coverage events.
- Use per-instance user data directories.
- Include a protocol version in `/health`.
- Keep direct actions deterministic and side-effect limited.

