# Unreal Integration Concept

Use a QA-only plugin, subsystem, or debug module to expose the GameplaySimulator protocol on localhost.

Recommended shape:

- Implement a local HTTP bridge in an editor/development module.
- Map world, level, pawn, controller, UI, inventory, quest, and performance state into `InstrumentedGameState`.
- Expose direct actions through safe exec/debug commands or subsystem methods.
- Emit coverage events from level streaming, gameplay tags, quest systems, inventory systems, UI widgets, and error handlers.
- Keep the protocol endpoint unavailable in public online builds unless it is an intentional internal testing surface.
