# GameplaySimulator agent guidance

## Project purpose and safety

GameplaySimulator is a desktop-first, game-agnostic QA tool for controlled AI/player-bot testing. Work must remain suitable for games the user owns, controls, or has explicit permission to test.

- Do not add anti-cheat bypasses, stealth/evasion features, public multiplayer exploitation, credential theft, or other functionality that violates a game's rules.
- Keep the simulator game-agnostic. Engine-specific behavior belongs behind adapter boundaries rather than in shared core logic.
- Prefer instrumented adapters when structured game state is available. Treat desktop-window control as a lower-information fallback.
- Mock runtime behavior must remain an explicit debug/demo choice such as `useMockRuntime: true`; normal sessions must use the selected real adapter.

## Repository map

- `apps/desktop`: Electron main process, preload bridge, and React renderer.
- `apps/runner`: backend runner package.
- `packages/core`: game-agnostic simulator types and services.
- `packages/adapters`: instrumented, desktop, browser, Unity, Godot, Unreal, and custom adapter boundaries.
- `packages/ui-shared`: shared UI constants and helpers.
- `examples`: sample game profiles and run configurations.
- `runs`: generated output; do not commit it.

## Cloud setup

Install the exact locked dependencies before working:

```bash
npm ci
```

Do not add secrets to the repository. Configure any required secret or environment variable in the Codex cloud environment instead.

## Required validation

For implementation changes, run both commands before considering the task complete:

```bash
npm test
npm run build
```

If a command cannot run, state the exact blocker in the task summary and PR description. Do not claim a check passed unless it was actually executed successfully.

## Implementation rules

- Preserve strict TypeScript types and existing package boundaries.
- Add or update focused tests when behavior changes or a bug is fixed.
- Avoid unrelated refactors, dependency upgrades, and formatting churn.
- Do not commit generated build output, run evidence, local configuration, or secrets.
- Keep session, bot, adapter, evidence, issue, report, and coverage behavior compatible unless the task explicitly requires a migration.
- Every user-facing UI field must include an adjacent question-mark help control with clear hover/focus guidance explaining the field, valid input, and effect.
- Help controls must be keyboard accessible and must not block normal label or input interaction.
- Keep the UI as the primary workflow for profiles, sessions, bots, live monitoring, logs, issues, evidence, and reports.

## Pull request guidance

- Keep each task's diff focused on the requested outcome.
- Summarize what changed, why it changed, developer/user impact, and checks run.
- For fixes, include the root cause.
- Leave the pull request in draft while phone-requested changes are still being added.
