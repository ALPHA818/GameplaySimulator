# Unity Integration Concept

Use a development-only MonoBehaviour or service that exposes the GameplaySimulator protocol on localhost.

Recommended shape:

- Register a small local HTTP listener during QA builds only.
- Map Unity scene, GameObject, quest, inventory, UI, and player controller data into `InstrumentedGameState`.
- Expose direct actions as safe debug commands such as move, interact, open menu, select dialogue option, equip item, teleport to test marker, or reload checkpoint.
- Emit coverage events when scenes, quests, NPCs, items, mechanics, or dialogue branches are reached.
- Emit performance data from Unity frame timing and memory APIs.

Keep this out of public builds unless it is explicitly protected and intended for internal QA.
