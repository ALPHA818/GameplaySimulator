# Desktop Window Adapter

`DesktopWindowAdapter` is the general fallback for normal desktop games that do not expose structured state. It works across many engines, but it has weaker awareness than instrumented adapters.

## Best Integration Method

Use this adapter when the game is a local executable and cannot easily expose a local state/action endpoint. Configure the game profile with executable path, working directory, arguments, platform, and control bindings.

If you control the game, prefer adding instrumentation first and keep `DesktopWindowAdapter` as a fallback for smoke tests and packaged-build validation.

## Fallback Method

If desktop window control is unreliable, add an `InstrumentedAdapter` endpoint or a custom file/socket bridge to expose state while keeping desktop input for actions.

## Data The Simulator Can Read

Without instrumentation:

- Process status and process ID when available.
- Window status and focus result when available.
- Screenshots captured from the game window.
- Last action sent.
- Basic resource usage estimates.
- Limited telemetry from logs if configured later.

With a companion bridge:

- Any structured game state the companion process emits.

## Actions The Simulator Can Perform

- Launch a local executable.
- Stop the process safely.
- Focus the game window where possible.
- Send keyboard input.
- Send mouse input.
- Reserve controller input abstraction for later.
- Capture screenshots of the game window when supported.

## Limitations

- State awareness is weak. The simulator may not know the true scene, inventory, quest flags, or UI state.
- Focus, fullscreen mode, display scaling, overlays, and OS permissions can affect input.
- Screenshots can prove what happened but do not automatically explain game state.
- Do not use this adapter for anti-cheat bypasses, process injection, or multiplayer exploits.

## Example Game Profile

```json
{
  "gameId": "desktop-action-game",
  "gameName": "Desktop Action Game QA",
  "version": "1.0.0",
  "buildId": "qa-offline",
  "engine": { "type": "unknown" },
  "launch": {
    "executablePath": "C:/Games/DesktopAction/Game.exe",
    "workingDirectory": "C:/Games/DesktopAction",
    "arguments": ["--qa-profile"],
    "platform": "windows"
  },
  "adapter": {
    "type": "desktop",
    "supportsMultipleInstances": false,
    "supportsStateRead": false,
    "supportsDirectActions": false,
    "supportsScreenshots": true,
    "supportsVideo": false,
    "supportsSaveIsolation": false
  },
  "controls": [
    { "controlId": "move-up", "label": "Move Up", "inputType": "keyboard", "binding": "W", "action": "move-up" },
    { "controlId": "move-down", "label": "Move Down", "inputType": "keyboard", "binding": "S", "action": "move-down" },
    { "controlId": "interact", "label": "Interact", "inputType": "keyboard", "binding": "E", "action": "interact" },
    { "controlId": "jump", "label": "Jump", "inputType": "keyboard", "binding": "Space", "action": "jump" },
    { "controlId": "attack", "label": "Attack", "inputType": "mouse", "binding": "MouseLeft", "action": "attack" },
    { "controlId": "menu", "label": "Menu", "inputType": "keyboard", "binding": "Escape", "action": "open-menu" }
  ],
  "testingTargets": [],
  "progressSignals": [],
  "failureSignals": [],
  "knownContent": {
    "scenes": ["Main Menu", "Start Area"],
    "levels": [],
    "quests": [],
    "mainQuests": [],
    "sideQuests": [],
    "optionalStories": [],
    "npcs": [],
    "shops": [],
    "bosses": [],
    "items": [],
    "menus": ["Pause"],
    "dialogueBranches": [],
    "minigames": [],
    "endings": [],
    "hiddenAreas": [],
    "postGameContent": [],
    "collectibles": [],
    "achievements": [],
    "locations": ["Start Area"],
    "characters": [],
    "mechanics": ["movement", "combat"],
    "notes": []
  }
}
```

## Example Instrumentation State

Desktop-only runs may not have structured state. A weak desktop state can still look like:

```json
{
  "scene": "Unknown",
  "processAlive": true,
  "processResponsive": true,
  "windowStatus": "focused",
  "lastAction": "interact",
  "screenshotPath": "runs/session-.../bots/explorer-001/screenshots/issue-detected.svg",
  "telemetry": {
    "source": "desktop-window",
    "stateAwareness": "limited"
  }
}
```

## Recommended Dev-Build Setup

- Provide a windowed mode with stable resolution.
- Disable intro videos or add command-line skips for QA builds.
- Add deterministic saves/profiles if possible.
- Keep control bindings stable and document them in the game profile.
- Allow screenshots from the game window.
- Prefer offline/dev builds. Do not test against protected public multiplayer clients.

