# GameplaySimulator

GameplaySimulator is a desktop QA application for running controlled player-bot tests against games you own, control, or have permission to test. The desktop UI is the primary workflow for creating game profiles, choosing bots, starting sessions, watching live status, reviewing issues and evidence, and opening saved reports.

The simulator is game-agnostic. Browser, instrumented, desktop-window, Unity, Godot, Unreal, RPG Maker, GameMaker, and custom-engine workflows remain separated behind adapter boundaries.

GameplaySimulator is for legitimate development and QA. It is not a cheating tool. It does not bypass anti-cheat, inject into protected processes, automate public matchmaking, exploit public multiplayer games, or evade a game's protections.

## Install

After the v0.1.0 release gate passes, download the package for your operating system from the published `v0.1.0` GitHub release. Do not use the current local tag or an unverified build as a release artifact.

### Linux

The Linux release is an AppImage:

```bash
chmod +x GameplaySimulator-0.1.0-linux-x86_64.AppImage
./GameplaySimulator-0.1.0-linux-x86_64.AppImage
```

Local packaging also creates `linux-unpacked` for debugging; the published release artifact is the AppImage. The installed application includes Electron and Chromium, so Node.js and Playwright are not required for normal use.

Verify the downloaded AppImage against its published checksum before running it:

```bash
sha256sum --check GameplaySimulator-0.1.0-linux-x86_64.AppImage.sha256
```

GameplaySimulator keeps the Electron renderer and bundled Chromium sandbox enabled. The Linux system must allow unprivileged user namespaces, which are enabled by default on supported desktop distributions. The AppImage runtime also requires FUSE 2 support, commonly provided by the `libfuse2` package. The application does not retry with sandbox-bypass arguments when sandbox initialization is blocked. In that case, enable user namespaces through the operating system's supported security policy before launching GameplaySimulator again.

### Windows

Run `GameplaySimulator-0.1.0-windows-x64.exe`. It is a portable application and does not require an installer. Local packaging also creates `win-unpacked` for debugging.

Version 0.1.0 Windows artifacts are not code-signed. Windows SmartScreen may show an unknown-publisher warning. Check the published `.sha256` file with `Get-FileHash -Algorithm SHA256` before choosing whether to run it. The project does not claim that this portable executable is signed.

The Windows CI job launches the produced portable executable itself in both background and visible browser modes. It publishes machine-readable validation records containing the Windows version, artifact checksum, launch mode, Authenticode status, and test results. See [Windows release validation](docs/windows-release-validation.md).

GameplaySimulator does not ship a macOS package in version `0.1.0`.

## License

GameplaySimulator is distributed under the [MIT License](LICENSE).

Copyright (c) 2026 Hanre Bornman

## Supported Systems

| Operating system | Packaged application | Browser adapter | Instrumented adapter | Desktop-window adapter |
| --- | --- | --- | --- | --- |
| Linux x64 | AppImage | Chromium, visible or background | Local HTTP | Launch, health, focus/input with `xdotool`, screenshots with a supported screenshot tool |
| Windows x64 | Portable executable | Chromium, visible or background | Local HTTP | Process launch, health, and safe stop only |
| macOS | Not shipped | Not release-tested | Not release-tested | Not release-supported |

Windows desktop keyboard input, mouse input, window focus, and screenshot capture are not included in this release. Use the browser or Local HTTP instrumented adapter on Windows when bots need to perform actions.

## Supported Adapters

- **Browser:** launches the bundled Chromium runtime through Playwright, reads optional game hooks or DOM clues, sends keyboard/mouse input, captures console and page errors, and takes screenshots. Firefox and WebKit are not included.
- **Instrumented:** connects to the GameplaySimulator protocol over Local HTTP. It reads structured state, retrieves available actions, performs actions exposed by the game, and reads game logs. Local WebSocket, file/socket, and plugin transports are not included.
- **Desktop window:** launches a local executable, monitors its process, stops it safely, and uses supported operating-system tools for focus, input, and screenshots. State awareness is limited without instrumentation.
- **Unity, Godot, and Unreal:** use Local HTTP instrumentation when an endpoint is configured; otherwise they use the desktop-window adapter.
- **RPG Maker and GameMaker:** use the desktop-window adapter.
- **Custom engines:** use Local HTTP instrumentation when possible or desktop-window fallback. The generic custom-adapter runtime is not included.

Browser games use Chromium only in packaged builds. Users do not need to run `npx playwright install`.

## Linux Desktop Dependencies

Desktop-window testing on Linux checks dependencies before a session:

- Install `xdotool` for window focus, keyboard input, and mouse input.
- Install one of `gnome-screenshot`, `scrot`, or ImageMagick's `import` command for screenshots.

The application can still launch and monitor a desktop process when these tools are missing, but it reports the missing capability and does not pretend input or screenshots succeeded.

## First Browser Test

1. Start the browser game on a local or permitted test URL.
2. Open **Game Profiles**, create a Browser profile, and enter the HTTP or HTTPS game URL.
3. Keep the browser type set to Chromium. Add control mappings when the game does not expose browser instrumentation hooks.
4. Use **Test Profile** to verify the page opens.
5. Open **New Session** and apply **Browser Smoke Test**.
6. Keep one bot, 20 actions, screenshots on, and video off.
7. Enable **Show Bot Gameplay** to watch the first test, then start the session.
8. Stop the session from **Live Session** if needed, then open the saved report from **Reports**.

Browser instrumentation hooks are documented in [Browser Instrumentation Hooks](docs/adapters/browser-instrumentation.md).

## First Desktop Test

1. Use a local development or QA executable that you are allowed to test.
2. Open **Game Profiles**, choose Desktop, and enter an absolute executable path and working directory.
3. Add mappings for the controls the bot may use.
4. Read the dependency report in the profile editor.
5. On Linux, use **Test Profile**, then **Test Control** with a harmless control such as Menu.
6. Open **New Session**, apply **Desktop Smoke Test**, and run one bot.
7. Review process health, logs, screenshots when supported, and the final report.

Desktop fallback has limited game-state awareness. For reliable scene, inventory, quest, UI, and progress data, use instrumentation instead.

## First Instrumented Test

The repository includes a controlled Local HTTP game server for integration testing:

```bash
npm run example:instrumented-server
```

Then:

1. Create a Custom-engine profile with adapter type Instrumented.
2. Set the endpoint to `http://127.0.0.1:4317`.
3. Keep the transport set to Local HTTP.
4. Use **Test Profile** and confirm the health response and available actions.
5. Create a one-bot smoke session and start it.
6. Confirm actions change the structured state, then stop the session and open its report.

Starting the included example server requires the source repository and Node.js. Games can implement the same protocol directly; see [Instrumented Test Server](examples/instrumented-test-server/README.md).

## Application Data

Packaged builds store generated data under Electron's per-user `userData` directory:

| Data | Linux default | Windows default |
| --- | --- | --- |
| Workspace | `~/.config/GameplaySimulator/workspace/` | `%APPDATA%\GameplaySimulator\workspace\` |
| Runs and reports | `~/.config/GameplaySimulator/runs/` | `%APPDATA%\GameplaySimulator\runs\` |
| Application logs | `~/.config/GameplaySimulator/logs/` | `%APPDATA%\GameplaySimulator\logs\` |

Linux honors `XDG_CONFIG_HOME` when it is set. The exact root can differ when the operating system redirects application data.

Workspace data includes user-created game profiles, custom bot profiles, profile overrides, saved run configurations, observation settings, and issue review state. Workspace writes are validated and backed up. Packaged builds never write generated data into the installation directory, application resources, or the ASAR archive.

Development sessions use the repository `runs/` folder. On first packaged launch, valid sessions found in known development run locations are copied into the packaged runs directory without deleting the originals. Duplicate session IDs are skipped.

## Sessions And Results

The simulator supports bot pools, resource viability estimates, parallel/sequential/hybrid instance planning, startup UI flows, user directives, live observation, stuck recovery, structured issue detection, content coverage, screenshots, logs, session comparison, and Markdown/HTML reports.

Issues are automated findings, not guaranteed bugs. Review their confidence, last actions, state, logs, and screenshots before filing them. GitHub export creates a preview and Markdown by default; posting requires an explicit confirmation and token.

Sessions loaded after an application crash are marked interrupted or failed. Their existing logs, evidence, and reports remain available and read-only.

## Known Limitations

- Automated screenshot understanding, video recording, and controller/touch input simulation are not included.
- Browser canvas and WebGL state is limited unless the game exposes the documented browser hooks.
- Desktop fallback cannot reliably infer scene, inventory, quests, flags, or UI state.
- Linux desktop focus/input depends on `xdotool`; screenshots depend on one supported screenshot command.
- Windows desktop testing cannot send input or capture desktop screenshots in this release.
- Some games cannot safely run multiple instances because they share saves, devices, launchers, or other resources.
- Instrumented transport is Local HTTP only.
- The generic custom-adapter runtime is unavailable; custom engines must use instrumentation or desktop fallback.
- Video fields may exist in old saved data, but production session validation rejects video recording.
- Public multiplayer and anti-cheat-protected games are out of scope.

## Safety

Only test local, development, staging, private, or otherwise permitted game builds. Keep instrumentation endpoints bound to localhost and disabled in public builds. Do not use GameplaySimulator to bypass protections, inject code, manipulate unrelated processes, automate public matchmaking, or violate a game's terms.

## Build From Source

Source builds require Node.js `22.13.0` or newer in the Node 22 LTS line and npm 10 or newer:

```bash
nvm use
npm ci
npm test
npm run test:e2e
npm run build
```

Packaging commands:

- `npm run package`: native unpacked application.
- `npm run dist:linux`: Linux AppImage and unpacked directory; run on Linux.
- `npm run dist:windows`: Windows portable executable and unpacked directory; run on Windows.
- `npm run test:packaged`: packaged workspace, browser session, persistence, and report smoke test.

Linux package validation launches the AppImage normally and rejects AppImage, Electron, or Chromium launch configuration containing sandbox-bypass arguments.

Other development commands:

- `npm run dev` or `npm run desktop`: desktop development mode.
- `npm run example:instrumented-server`: controlled Local HTTP instrumented target.

Release output is written to `release/`. Packaging cleans old release output first, reads the version from `package.json`, and writes a `.sha256` sidecar plus a platform checksum manifest for each distributable. Native packaging commands reject the wrong host operating system so the bundled Chromium runtime matches the package. Unpacked directories remain local debugging output and are not published as release downloads.

## Documentation

- [Adapter overview](docs/adapters/overview.md)
- [Browser](docs/adapters/browser.md)
- [Desktop window](docs/adapters/desktop-window.md)
- [Unity](docs/adapters/unity.md)
- [Godot](docs/adapters/godot.md)
- [Unreal](docs/adapters/unreal.md)
- [Custom engines](docs/adapters/custom-engine.md)
- [Instrumentation SDK](packages/instrumentation-sdk/README.md)
- [Windows release validation](docs/windows-release-validation.md)

## Repository Layout

- `apps/desktop`: Electron main process, preload bridge, and React renderer.
- `packages/core`: game-agnostic types, bot runtime, detection, logging, reports, resources, and session services.
- `packages/adapters`: the supported adapter implementations and engine wrappers.
- `packages/instrumentation-sdk`: Local HTTP protocol types and client.
- `packages/ui-shared`: shared UI helpers.
- `examples`: sample profiles, configurations, and the controlled instrumented server.
- `tests/e2e`: release-level real-adapter and persistence tests.
- `runs`: ignored development run output.
