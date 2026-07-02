# Godot Integration Concept

Use an autoload singleton in QA builds to expose the GameplaySimulator protocol on localhost.

Recommended shape:

- Start a local HTTP or WebSocket bridge from an autoload script.
- Serialize current scene, node state, player position, UI focus, inventory resources, quest state, and performance data into `InstrumentedGameState`.
- Register direct actions as Godot callables that perform safe test operations.
- Emit content coverage events from scene transitions, signal handlers, quest steps, inventory changes, and important UI flows.
- Keep the bridge disabled in public builds unless intentionally shipped for internal testing.
