# Changelog

## 0.1.0 - Unreleased

Planned first public release of GameplaySimulator. This entry remains unreleased until the legal, clean-machine, Windows, and permitted Hexcraft gates pass.

### Desktop Application

- Added the Electron and React desktop workflow for game profiles, bot profiles, session setup, live monitoring, logs, issues, evidence, reports, comparisons, and settings.
- Added persistent workspace data, persisted sessions, atomic backups, interrupted-session recovery, and writable packaged data locations.
- Added accessible viewport-safe field help, responsive pages, independent sidebar scrolling, and application error recovery.

### Runtime

- Added real Chromium browser sessions with visible or background observation, browser hooks, DOM fallback, input, console/page errors, screenshots, and clean shutdown.
- Added Local HTTP instrumented sessions with structured state, available actions, direct actions, events, logs, and the controlled example server.
- Added desktop process launch, health monitoring, safe shutdown, Linux focus/input, Linux/macOS screenshot helpers, and dependency reporting.
- Added Unity, Godot, and Unreal wrappers that select instrumentation or desktop fallback.
- Added game-instance management, save isolation, bot pools, resource estimation, bot orchestration, startup flows, directives, recovery, and graceful shutdown.

### QA Results

- Added rule-based general and specialist bot profiles with compatibility checks and focused templates.
- Added progress, stuck, crash, freeze, issue, exploit, coverage, and evidence tracking.
- Added structured session bundles, searchable logs, issue timelines, readable Markdown/HTML reports, build comparison, and explicit GitHub Markdown export/posting.

### Release Engineering

- Standardized source builds on Node.js 22.13.0 or newer in the Node 22 LTS line.
- Added Linux AppImage and Windows portable packaging with bundled Chromium.
- Added Linux and Windows CI, real-adapter E2E tests, packaged lifecycle tests, Electron security hardening, path validation, and owned-process cleanup.

### Release Limitations

- macOS packages are not produced.
- Windows desktop keyboard/mouse input and desktop screenshot capture are not included.
- Instrumented transport is Local HTTP only.
- Firefox, WebKit, video recording, automated screenshot understanding, controller input, touch input, and the generic custom-adapter runtime are not included.
- Public multiplayer and anti-cheat-protected targets are out of scope.
