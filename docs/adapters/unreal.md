# Unreal Adapter

Unreal games can expose high-quality state through a QA-only plugin, subsystem, or debug module. If that is not available, GameplaySimulator can use desktop window/input fallback.

## Best Integration Method

Use `InstrumentedAdapter` with a local Unreal development module. An `UnrealAdapter` can choose instrumented mode when the QA endpoint is available and use `DesktopWindowAdapter` otherwise.

Recommended Unreal implementation:

- Add a QA-only plugin, `UGameInstanceSubsystem`, or developer module.
- Expose local HTTP or WebSocket endpoints.
- Map world, level, pawn, controller, gameplay tags, UI widgets, inventory, quests, save state, and performance data.
- Expose direct actions through safe subsystem calls or debug exec commands.
- Emit coverage events from level streaming, gameplay tags, quest systems, NPC interactions, widgets, bosses, minigames, and achievements.

## Fallback Method

Use `DesktopWindowAdapter` for packaged Unreal builds. It can launch the executable, focus the window, send input, take screenshots, and track process health.

## Data The Simulator Can Read

With instrumentation:

- Current map, streaming levels, world partition region.
- Pawn position, movement state, health, combat state.
- Gameplay tags, quest flags, inventory, currency, reward state.
- UMG widget stack, menu/dialogue state, focused widget.
- Logs, ensures, warnings, crashes, frame timing, memory, and GPU samples.
- Coverage events.

With desktop fallback:

- Process/window status.
- Screenshots and last input.
- Basic resource telemetry.

## Actions The Simulator Can Perform

With instrumentation:

- Movement, interaction, combat abilities, item use, UI navigation, dialogue choices.
- Save/load, checkpoint reload, restart level, reset test profile.
- Dev-only commands such as load map, teleport to marker, grant test item, or force quest step when appropriate for QA.

With desktop fallback:

- Keyboard/mouse/controller-style input mapped through controls.
- Screenshot capture and safe process stop.

## Limitations

- Do not expose QA endpoints in public online builds.
- Networked/multiplayer builds must not use instrumentation to bypass server authority or anti-cheat.
- Desktop fallback cannot see gameplay tags, widgets, or replicated state without instrumentation or logs.
- Unreal packaging paths and focus behavior vary by platform.

## Example Game Profile

```json
{
  "gameId": "unreal-adventure",
  "gameName": "Unreal Adventure QA",
  "version": "2.0.0",
  "buildId": "qa-editor",
  "engine": { "type": "unreal", "version": "5.4" },
  "launch": {
    "executablePath": "C:/Games/UnrealAdventure/Adventure.exe",
    "workingDirectory": "C:/Games/UnrealAdventure",
    "arguments": ["-QA", "-GameplaySimulatorPort=4317"],
    "platform": "windows"
  },
  "adapter": {
    "type": "unreal",
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
    "scenes": ["MainMenu", "OpenWorld_P"],
    "levels": ["OpenWorld_P", "Dungeon_A"],
    "quests": ["Recover the Relic"],
    "mainQuests": ["Recover the Relic"],
    "sideQuests": ["Rescue the Scout"],
    "optionalStories": ["Old Battlefield Memory"],
    "npcs": ["Scout", "Relic Keeper"],
    "shops": ["Camp Vendor"],
    "bosses": ["Relic Warden"],
    "items": ["Relic Shard", "Health Flask"],
    "menus": ["Inventory", "Map"],
    "dialogueBranches": ["Scout rescue choice"],
    "minigames": [],
    "endings": ["Relic Restored"],
    "hiddenAreas": ["Collapsed Tunnel"],
    "postGameContent": ["Arena"],
    "collectibles": ["Lore Tablet"],
    "achievements": ["First Relic"],
    "locations": ["Camp"],
    "characters": ["Scout"],
    "mechanics": ["combat", "inventory"],
    "notes": []
  }
}
```

## Example Instrumentation State

```json
{
  "scene": "OpenWorld_P",
  "level": "Dungeon_A",
  "player": {
    "pawn": "BP_PlayerCharacter_C_0",
    "position": { "x": 1200.0, "y": -300.0, "z": 80.0 },
    "alive": true,
    "canMove": true
  },
  "uiState": "Map",
  "inventory": {
    "health_flask": { "quantity": 4 }
  },
  "currency": 240,
  "questFlags": {
    "relic_intro_complete": true
  },
  "gameplayTags": ["State.Exploration", "Quest.Relic.Active"],
  "availableActions": ["move-forward", "attack-enemy", "open-menu"],
  "unreal": {
    "mapName": "OpenWorld_P",
    "streamingLevels": ["Dungeon_A"],
    "frameTimeMs": 18.4
  }
}
```

## Recommended Dev-Build Setup

- Compile the bridge only in editor/development/QA configurations.
- Bind endpoints to localhost.
- Add command-line gating such as `-QA`.
- Use isolated save directories and deterministic test seeds.
- Forward Unreal logs, ensures, crashes, and gameplay error events.
- Keep direct actions server-safe and local to permitted QA builds.

