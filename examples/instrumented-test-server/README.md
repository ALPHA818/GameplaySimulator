# Instrumented Test Server

This is a fake local game server for testing `InstrumentedAdapter`.

It implements the GameplaySimulator instrumentation HTTP protocol and changes state when actions are posted. Use it when you want to prove the full adapter path works without opening a real game.

## Start The Server

```bash
npm run example:instrumented-server
```

Default endpoint:

```text
http://127.0.0.1:4317
```

Optional port and host:

```bash
npm run example:instrumented-server -- --port=4321 --host=127.0.0.1
```

## Routes

- `GET /gsi/v1/health`
- `GET /gsi/v1/state?instanceId=game-instance-001&botId=explorer-001`
- `GET /gsi/v1/actions?instanceId=game-instance-001&botId=explorer-001`
- `POST /gsi/v1/actions`
- `POST /gsi/v1/events`

## Create A Game Profile

In the desktop app, create a new game profile:

- Game name: `Fake Instrumented Game`
- Engine type: `Custom`
- Platform: `Linux`, `Windows`, or `macOS`
- Adapter type: `Instrumented`
- Instrumentation endpoint: `http://127.0.0.1:4317`
- Transport type: `Local HTTP`
- Supports multiple instances: on
- Supports state read: on
- Supports direct actions: on
- Supports screenshots: off
- Supports video: off
- Supports save isolation: on

The `Instrumentation endpoint ?` and `Transport type ?` fields in the UI explain what each value does.

## Run Bots Against It

1. Start the fake server.
2. Start the desktop app with `npm run desktop`.
3. Create the game profile above.
4. Open `New Session`.
5. Choose the fake instrumented profile.
6. Add one or more bot pools.
7. Start the session.

Bots will receive structured state through HTTP. Actions change the fake game state, including scene, position, inventory, quests, UI state, and logs.

## Supported Fake Actions

- `move-forward`: increases the player position.
- `open-menu`: opens the pause menu.
- `close-menu`: closes menus.
- `accept-quest`: makes the sample quest active.
- `turn-in-quest`: completes the active sample quest and grants a reward.
- `buy-item`: spends currency and adds a health potion.
- `trigger-crash`: sets a fake crash state for issue detector testing.
- `trigger-stuck`: sets a fake no-progress state for stuck testing.
- `enter-hidden-area`: moves to hidden content for coverage testing.

## Example Action Request

```bash
curl -X POST http://127.0.0.1:4317/gsi/v1/actions \
  -H 'content-type: application/json' \
  -d '{
    "requestId": "manual-action-001",
    "instanceId": "game-instance-001",
    "botId": "explorer-001",
    "actionType": "move-forward",
    "payload": {}
  }'
```
