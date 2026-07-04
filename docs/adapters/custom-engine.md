# Custom Engine Adapter

Custom engines can usually provide the best integration because you control the runtime, state model, and test hooks.

## Best Integration Method

Implement the GameplaySimulator instrumentation protocol over local HTTP, WebSocket, file/socket bridge, or a future plugin bridge. Use `InstrumentedAdapter` when the protocol is available. Use `CustomAdapter` when you need engine-specific transport or plugin behavior.

Minimum useful endpoints:

- `GET /gsi/v1/health`
- `GET /gsi/v1/state`
- `GET /gsi/v1/actions`
- `POST /gsi/v1/actions`
- `POST /gsi/v1/events`

## Fallback Method

Use `DesktopWindowAdapter` for packaged custom-engine executables when the bridge is unavailable. You can also combine desktop input with read-only instrumentation state.

## Data The Simulator Can Read

With instrumentation:

- Scene, level, world, player position, physics status, UI state.
- Inventory, currency, stats, quest flags, rewards, progression flags, save/load state.
- Engine logs, warnings, errors, crash/freeze signals, performance metrics.
- Content coverage events for main story, side content, optional content, endings, post-game content, collectibles, and achievements.

With desktop fallback:

- Process/window status.
- Screenshots.
- Last action sent.
- Basic resource estimates.

## Actions The Simulator Can Perform

With instrumentation:

- Any safe direct action you expose: movement, interaction, combat, UI, dialogue, economy, crafting, save/load, checkpoint reload.
- QA-only actions such as reset profile, load fixture, teleport to test marker, or seed deterministic state.

With desktop fallback:

- Keyboard and mouse input mapped from controls.
- Screenshots and safe stop.

## Limitations

- The protocol shape is your contract. Keep it stable and versioned.
- Direct actions should be safe and restricted to QA builds.
- If you expose too little state, issue reports become less precise.
- If you expose too much noisy state, detectors may become harder to tune.

## Example Game Profile

```json
{
  "gameId": "custom-engine-game",
  "gameName": "Custom Engine Game QA",
  "version": "0.6.0",
  "buildId": "qa-protocol-v1",
  "engine": { "type": "custom", "version": "internal-2026.07" },
  "launch": {
    "executablePath": "/games/custom/Game",
    "workingDirectory": "/games/custom",
    "arguments": ["--qa", "--gsi=http://127.0.0.1:4317"],
    "platform": "linux"
  },
  "adapter": {
    "type": "instrumented",
    "supportsMultipleInstances": true,
    "supportsStateRead": true,
    "supportsDirectActions": true,
    "supportsScreenshots": true,
    "supportsVideo": true,
    "supportsSaveIsolation": true
  },
  "controls": [],
  "testingTargets": [],
  "progressSignals": [],
  "failureSignals": [],
  "knownContent": {
    "scenes": ["boot", "town", "dungeon"],
    "levels": ["town_hub", "dungeon_01"],
    "quests": ["Find the Gate"],
    "mainQuests": ["Find the Gate"],
    "sideQuests": ["Lost Cat"],
    "optionalStories": ["Old Well"],
    "npcs": ["Guide", "Shopkeeper"],
    "shops": ["General Store"],
    "bosses": ["Gate Guardian"],
    "items": ["Potion", "Gate Key"],
    "menus": ["Inventory", "Settings"],
    "dialogueBranches": ["Guide greeting"],
    "minigames": ["Fishing"],
    "endings": ["Good Ending"],
    "hiddenAreas": ["Secret Cave"],
    "postGameContent": ["Arena"],
    "collectibles": ["Blue Gem"],
    "achievements": ["First Steps"],
    "locations": ["Town"],
    "characters": ["Guide"],
    "mechanics": ["crafting", "combat"],
    "notes": []
  }
}
```

## Example Instrumentation State

```json
{
  "scene": "dungeon",
  "level": "dungeon_01",
  "tick": 18442,
  "player": {
    "position": { "x": 12, "y": 0, "z": -8 },
    "alive": true,
    "canMove": true
  },
  "uiState": "none",
  "inventory": {
    "potion": { "quantity": 2 },
    "gate_key": { "quantity": 1 }
  },
  "currency": 120,
  "stats": {
    "strength": 12
  },
  "statMaximums": {
    "strength": 99
  },
  "questFlags": {
    "met_guide": true,
    "gate_key_received": true
  },
  "availableActions": ["move-forward", "interact", "attack-enemy"],
  "performance": {
    "fps": 60,
    "frameTimeMs": 16.6
  }
}
```

## Recommended Dev-Build Setup

- Version the protocol and return it from `/health`.
- Bind to localhost and gate it behind QA/dev flags.
- Provide deterministic seeds and reset commands.
- Provide per-instance save/profile directories.
- Emit structured event IDs for content coverage and issues.
- Keep public online builds free of debug endpoints unless intentionally designed for internal QA.

