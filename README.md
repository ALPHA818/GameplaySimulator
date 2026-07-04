# GameplaySimulator

GameplaySimulator is a desktop-first QA tool for running controlled AI/player-bot simulations against games you own, control, or have permission to test.

It is game-agnostic by design. The core simulator is intended to work through adapters for many game types and engines, including Unity, Godot, Unreal, browser games, custom engines, RPG Maker, GameMaker, desktop games, and future adapter types.

The UI is the main way to use GameplaySimulator. It will provide workflows for creating test sessions, selecting game profiles, choosing bot types, setting bot counts, starting and stopping simulations, watching live bot status, reviewing logs, inspecting issues, viewing screenshots or other evidence, and opening reports.

This project is for legitimate QA, regression testing, accessibility-style exploration, and reliability testing. It is not for cheating in public online games, bypassing anti-cheat, exploiting multiplayer systems, or violating a game's rules.

## Current Status

GameplaySimulator now has the desktop shell, shared data models, mock backend simulation service, bot pools, live session monitoring, issue/log viewers, readable reports, content coverage tracking, evidence capture, exploit detection, and placeholder adapter architecture. Real engine integrations are still expected to be connected through adapters and optional instrumentation.

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

## Project Layout

- `apps/desktop` contains the Electron main process, preload bridge, and React renderer UI.
- `apps/runner` contains the placeholder backend runner package.
- `packages/core` contains game-agnostic simulator types and future core services.
- `packages/adapters` contains adapter boundaries for instrumented, desktop, browser, Unity, Godot, Unreal, and custom games.
- `packages/ui-shared` contains shared UI constants and helpers.
- `examples` contains sample game profile and run configuration files.
- `runs` is reserved for generated run output and is ignored by git.
