# GameplaySimulator

GameplaySimulator is a desktop-first QA tool for running controlled AI/player-bot simulations against games you own, control, or have permission to test.

It is game-agnostic by design. The core simulator is intended to work through adapters for many game types and engines, including Unity, Godot, Unreal, browser games, custom engines, RPG Maker, GameMaker, desktop games, and future adapter types.

The UI is the main way to use GameplaySimulator. It will provide workflows for creating test sessions, selecting game profiles, choosing bot types, setting bot counts, starting and stopping simulations, watching live bot status, reviewing logs, inspecting issues, viewing screenshots or other evidence, and opening reports.

This project is for legitimate QA, regression testing, accessibility-style exploration, and reliability testing. It is not for cheating in public online games, bypassing anti-cheat, exploiting multiplayer systems, or violating a game's rules.

## Current Status

GameplaySimulator now has the desktop shell, shared data models, adapter-backed backend simulation service, bot pools, live session monitoring, issue/log viewers, readable reports, content coverage tracking, evidence capture, exploit detection, and placeholder adapter architecture. Mock runtime mode is available only as an explicit debug/demo option with `useMockRuntime: true`; normal sessions use the selected adapter.

## Adapter Documentation

Use the adapter docs to decide how to connect a game build:

- [Adapter overview](docs/adapters/overview.md)
- [Unity](docs/adapters/unity.md)
- [Godot](docs/adapters/godot.md)
- [Unreal](docs/adapters/unreal.md)
- [Browser games](docs/adapters/browser.md)
- [Desktop window fallback](docs/adapters/desktop-window.md)
- [Custom engines](docs/adapters/custom-engine.md)

In short: instrumented adapters give the best results, `DesktopWindowAdapter` works for many desktop games with weaker state awareness, and `BrowserAdapter` is only one adapter for browser-based games rather than the center of the architecture.

## Scripts

- `npm run dev` starts the Electron desktop app in development mode.
- `npm run desktop` starts the same desktop app entry point.
- `npm run build` type-checks and builds the desktop app and placeholder runner.
- `npm run test` runs the Vitest test suite.

## Usage Examples

### Testing a Unity Game

Create a Game Profile with engine type `Unity`. Prefer the `InstrumentedAdapter` when your dev build can expose the GameplaySimulator instrumentation SDK over a local HTTP/WebSocket endpoint. If no instrumentation hook is available, use the Unity adapter in desktop-window fallback mode with launch path, working directory, and mapped controls.

### Testing a Godot Game

Create a Godot Game Profile and point the launch config at your exported debug build. Use instrumentation for scene, quest, inventory, UI, and performance state when possible. Use desktop-window fallback when only keyboard/mouse input and screenshots are available.

### Testing an Unreal Game

Create an Unreal Game Profile with the packaged dev executable and build ID. Instrumented Unreal dev builds should expose structured state and available actions through the SDK bridge. For black-box smoke tests, use desktop-window control mapping and screenshot evidence.

### Testing a Browser Game

Create a Browser Game Profile with the local or staging URL. Select `browser` as the adapter type, configure whether multiple instances are supported, and choose bot pools such as explorer, UI tester, dialogue tester, and chaos monkey. Reports and evidence are written under `runs/`.

### Testing a Generic Desktop Game

Create a Game Profile with engine type `custom` or `unknown`, launch platform `windows`, `linux`, or `mac`, and adapter type `desktop`. Map actions to controls such as `move up -> W`, `interact -> E`, `jump -> Space`, and `attack -> MouseLeft`. Desktop-window testing can launch the executable, send mapped input, capture screenshots, and collect limited process/window telemetry.

### Running Multiple Explorer Bots

On the New Session screen, add or enable the explorer bot pool. Set a range such as min `1`, desired `8`, max `20`, then choose `auto` scaling. The ResourceManager estimates a safe final count from PC resources, adapter type, game instance limits, and user limits. The Live Session page shows the final resolved bots before and during the run.

### Using Auto Scaling

Use `auto` scaling for pools that can flex based on available CPU/RAM/GPU headroom. Use `fixed` scaling for bots that must run at the requested count. Fixed pools keep their desired count unless the request is impossible, and the viability panel explains warnings or blockers instead of silently dropping bots.

### Reading Reports

Open the Reports page after a run. Session summaries include bot counts, viability, actions, issues, coverage, stuck/crash status, and generated evidence paths. Bot reports live under each bot folder, issue markdown lives under `runs/session-.../issues/`, and optional GitHub issue markdown exports live under `runs/session-.../github-issues/`.

## Known Limitations

- Black-box desktop testing is weaker than instrumented testing because it has less direct access to game state.
- Some games cannot safely run multiple instances, especially if they use shared save files, exclusive device locks, or singleton launchers.
- Visual understanding is limited until vision model support is added; screenshot capture is evidence-first right now.
- Anti-cheat-protected games should not be targeted. GameplaySimulator does not bypass anti-cheat, inject into protected processes, or evade multiplayer protections.
- Public multiplayer games are out of scope unless you own/control the environment and have explicit permission to test.

## Project Layout

- `apps/desktop` contains the Electron main process, preload bridge, and React renderer UI.
- `apps/runner` contains the placeholder backend runner package.
- `packages/core` contains game-agnostic simulator types and future core services.
- `packages/adapters` contains adapter boundaries for instrumented, desktop, browser, Unity, Godot, Unreal, and custom games.
- `packages/ui-shared` contains shared UI constants and helpers.
- `examples` contains sample game profile and run configuration files.
- `runs` is reserved for generated run output and is ignored by git.
