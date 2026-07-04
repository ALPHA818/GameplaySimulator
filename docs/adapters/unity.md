# Unity Adapter

Unity games can use either a QA-only instrumentation endpoint or normal desktop input/window control. The instrumentation path gives the best simulator results.

## Best Integration Method

Use `InstrumentedAdapter` with a Unity QA build that exposes the GameplaySimulator instrumentation protocol on localhost. A `UnityAdapter` can wrap this choice and select instrumented mode when the endpoint is available.

Recommended Unity implementation:

- Add a dev-only MonoBehaviour, service, or package enabled only for QA builds.
- Start a local HTTP or WebSocket bridge.
- Serialize Unity scene, GameObject, player controller, quest, inventory, UI, save, and performance state.
- Expose direct actions as safe debug commands.
- Emit coverage events from scene changes, quest steps, NPC interactions, item pickups, menus, dialogue choices, bosses, minigames, hidden areas, endings, and achievements.

## Fallback Method

Use `DesktopWindowAdapter` for a normal Unity executable. This can launch the game, focus the window, send keyboard/mouse/controller-style inputs, and capture screenshots. It has weaker awareness unless the game also emits logs or state externally.

## Data The Simulator Can Read

With instrumentation:

- Active scene and loaded additive scenes.
- Player position, health, movement ability, death/respawn state.
- Current UI screen, selected menu, dialogue state, and input focus.
- Inventory, currency, quest flags, rewards, save/load status, progression flags.
- Unity logs, warnings, exceptions, frame timing, memory, and custom telemetry.
- Content coverage events.

With desktop fallback:

- Process/window status.
- Screenshots.
- Last action sent.
- Limited resource estimates and optional logs.

## Actions The Simulator Can Perform

With instrumentation:

- Move, interact, jump, attack, block, dodge, use item, equip item.
- Open/close menu, select UI option, choose dialogue branch.
- Accept/turn in quest, reload checkpoint, save/load, reset test state.
- Optional dev-only actions such as teleport to marker or spawn test fixture.

With desktop fallback:

- Keyboard, mouse, and future controller input mapped from `controls`.
- Screenshot capture.
- Safe process stop.

## Limitations

- Keep the instrumentation bridge out of public builds unless it is intentionally protected for internal testing.
- Do not use this to bypass anti-cheat or multiplayer protections.
- Desktop fallback cannot reliably infer inventory, quests, flags, or content coverage without OCR/vision or logs.
- Direct actions should behave like QA commands, not hidden player cheats in public builds.

## Example Game Profile

```json
{
  "gameId": "unity-rpg",
  "gameName": "Unity RPG QA",
  "version": "1.2.0",
  "buildId": "qa-local",
  "engine": { "type": "unity", "version": "2022.3" },
  "launch": {
    "executablePath": "/games/unity-rpg/UnityRpg.x86_64",
    "workingDirectory": "/games/unity-rpg",
    "arguments": ["--qa", "--gsi-port=4317"],
    "platform": "linux"
  },
  "adapter": {
    "type": "unity",
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
    "scenes": ["MainMenu", "Town", "Dungeon01"],
    "levels": ["TownHub", "Dungeon01"],
    "quests": ["Find the Gate"],
    "mainQuests": ["Find the Gate"],
    "sideQuests": ["Lost Cat"],
    "optionalStories": [],
    "npcs": ["Guide", "Shopkeeper"],
    "shops": ["General Store"],
    "bosses": ["Gate Guardian"],
    "items": ["Potion", "Gate Key"],
    "menus": ["Inventory", "Settings"],
    "dialogueBranches": ["Guide greeting"],
    "minigames": [],
    "endings": [],
    "hiddenAreas": ["Old Cellar"],
    "postGameContent": [],
    "collectibles": [],
    "achievements": ["First Steps"],
    "locations": ["Town"],
    "characters": ["Guide"],
    "mechanics": ["movement", "inventory"],
    "notes": []
  }
}
```

## Example Instrumentation State

```json
{
  "scene": "Dungeon01",
  "level": "Dungeon01",
  "player": {
    "position": { "x": 18.5, "y": 0.0, "z": -4.2 },
    "alive": true,
    "canMove": true
  },
  "uiState": "none",
  "inventory": {
    "potion": { "quantity": 2 },
    "gateKey": { "quantity": 1 }
  },
  "currency": 80,
  "questFlags": {
    "met_guide": true,
    "gate_key_received": true
  },
  "availableActions": ["move-forward", "attack-enemy", "open-menu"],
  "unity": {
    "activeScene": "Dungeon01",
    "loadedScenes": ["Dungeon01"],
    "frameTimeMs": 16.8
  }
}
```

## Recommended Dev-Build Setup

- Add `DEVELOPMENT_BUILD` or a custom `GAMEPLAY_SIMULATOR` scripting define.
- Bind the bridge to `127.0.0.1` only.
- Add a visible QA build watermark or command-line gate.
- Use isolated save directories per game instance.
- Log Unity exceptions and warnings into the instrumentation event stream.
- Include deterministic seed support for reproducible bot runs.

