# Custom Engine Integration Concept

Any engine can implement the protocol by exposing a local bridge that GameplaySimulator can reach.

Minimum useful implementation:

- `GET /gsi/v1/health`
- `GET /gsi/v1/state`
- `GET /gsi/v1/actions`
- `POST /gsi/v1/actions`
- `POST /gsi/v1/events`

The state payload should include whatever the engine can safely expose: world identifier, tick/frame number, player position, UI state, inventory, quests, logs, performance, and custom structured fields.

If direct actions are not safe or practical, expose read-only state and events. GameplaySimulator can still combine that stronger state awareness with desktop input simulation.
