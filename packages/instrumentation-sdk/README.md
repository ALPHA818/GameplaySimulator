# GameplaySimulator Instrumentation SDK

The instrumentation SDK is an optional protocol for games you control. It lets a game expose structured state, available actions, direct action execution, events, logs, coverage, quest updates, inventory updates, player position, UI state, and performance data to GameplaySimulator.

Games that do not implement this SDK can still be tested through `DesktopWindowAdapter`, with weaker state awareness and input/screenshot-based observation.

## Local HTTP Protocol

Default base path: `/gsi/v1`.

- `GET /gsi/v1/health` returns protocol, game, engine, and capability information.
- `GET /gsi/v1/state?instanceId=...&botId=...` returns the current structured game state.
- `GET /gsi/v1/actions?instanceId=...&botId=...` returns direct actions currently available to the bot.
- `POST /gsi/v1/actions` performs a direct action.
- `POST /gsi/v1/events` emits game events, warnings, errors, content coverage, quest updates, inventory updates, player position, UI state, or performance samples.

Supported transport descriptors also include local WebSocket, local file/socket bridge, and future plugin bridge. The first implemented client is local HTTP.
