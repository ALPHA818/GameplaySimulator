# Windows Release Validation

GameplaySimulator 0.1.0 distributes a portable Windows x64 executable. It does not currently distribute an installer.

## CI Validation

The Windows release job tests the produced `GameplaySimulator-<version>-windows-x64.exe`, not only source code or `win-unpacked`. The harness rejects any differently named executable, copies the portable artifact into a temporary path containing spaces, and launches it normally with the `asInvoker` execution level. It does not request administrator elevation.

GitHub-hosted Windows runners have administrator privileges, so the job also creates a temporary local standard account and launches the same portable artifact under that account. This check requires the renderer to load, proves the configured user-data directory is writable, waits for a clean exit, verifies that no owned application process remains, writes a validation record, and removes the temporary account and files. The normal background and visible runs separately record their CI launch identity and token elevation state so the two launch conditions are not confused.

Separate background and visible runs validate:

- application startup and writable user-data workspace
- game-profile persistence after restart
- bundled Chromium launch through the browser adapter
- browser actions and state changes
- screenshot, log, and report creation
- report reopening after restart
- invalid URL handling
- normal session stop
- application shutdown while a browser session is active
- cleanup of GameplaySimulator and packaged Chromium processes

Passing runs write `windows-validation-<version>-standard-user.json`, `windows-validation-<version>-background.json`, and `windows-validation-<version>-visible.json`. CI uploads these beside the portable executable and checksums. The records contain the Windows OS release/version, exact artifact filename, SHA256 digest, portable launch mode, identity details where applicable, Authenticode result, unsigned-warning explanation, and individual test results.

## Signing

Version 0.1.0 is not code-signed. Windows may show SmartScreen or unknown-publisher warnings. Validate the SHA256 sidecar before running the executable. The application is configured with `asInvoker` and should not request administrator elevation.

## Desktop Adapter Limitation

Windows desktop keyboard input, mouse input, game-window focus, and desktop screenshot automation are not implemented in 0.1.0. The Windows release validation covers browser and Local HTTP instrumented paths; it does not claim that desktop game controls work. This phase does not add Windows input automation.
