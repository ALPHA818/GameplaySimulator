# Phase 81 End-To-End Wiring Audit

Temporary internal release audit. Verified 2026-07-28.

Status meanings:

- **working**: validated data reaches the intended runtime and saved artifact.
- **fixed**: this audit found and repaired a missing or incorrect handoff.
- **read-only**: saved sessions can be inspected or exported but cannot resume or mutate runtime state.

## Complete Paths

| Path | Verified handoffs | Primary coverage | Status |
| --- | --- | --- | --- |
| Game profile | Editor schema validation, workspace persistence, session payload, adapter option builder, AdapterFactory | `configStore.persistence.test.ts`, `WorkspaceRepository.test.ts`, `ProfileAdapterOptions.test.ts`, `SimulationServiceRealAdapter.integration.test.ts` | working |
| Custom bot profile | Editor validation, custom-only workspace storage, New Session pool selection, exact session artifact, ActionPlanner preferences | `BotProfileEditorPage.test.tsx`, `CustomBotProfileValidator.test.ts`, `configStore.persistence.test.ts`, `simulationService.test.ts`, `ActionPlanner.test.ts` | fixed: exact used profiles are now stored in `config.json` |
| Session lifecycle | Config creation, viability, adapter instances, bot start, pause, resume, stop, metadata and reports | `simulationService.test.ts`, `SimulationServiceRealAdapter.integration.test.ts`, `ShutdownCoordinator.test.ts` | working |
| Startup flow | Profile selection, startup bot gate, step execution, normal-bot wait, failure screenshot, issue and summary timeline | startup-flow cases in `simulationService.test.ts` and `Bot.test.ts` | working |
| User directive | Pre-run/live creation, assignment, all planner modes, progress, evidence, terminal result and report | `BotDirectiveManager.test.ts`, `ActionPlanner.test.ts`, `LiveBotGuidancePanel.test.tsx`, `simulationService.test.ts`, `StructuredLoggers.test.ts` | fixed: guided steps, waits, runtime timeouts, limit failures, and manual confirmation now reach real outcomes |
| Specialized bot | Profile selection, compatibility validation, pool resolution, launch and named planner rule | `BotProfilesPage.test.tsx`, `BotCompatibilityEvaluator.test.ts`, `defaultBotProfiles.test.ts`, `ActionPlanner.test.ts` | working |
| Live observation | Workspace default, session override, adapter options, visible/headless browser runtime, desktop focus | `SettingsPage.observation.test.tsx`, `NewSessionPage.templates.test.tsx`, `ProfileAdapterOptions.test.ts`, `BrowserAdapter.test.ts`, `RuntimeObservationManager.test.ts` | working |
| Evidence | Detector/startup/directive event, adapter screenshot, fallback evidence, issue path, UI open and report | `EvidenceCaptureService.test.ts`, evidence cases in `simulationService.test.ts`, `IssuesPage.directives.test.tsx`, `StructuredLoggers.test.ts` | working |
| Logs | Runtime logger, JSONL/session bundle, persisted repository read, filters, details and old-session selection | `StructuredLoggers.test.ts`, `LogsPage.filters.test.tsx`, `simulationService.test.ts` | fixed: persisted fallback reads no longer create files |
| Reports | Finalized summary, metadata paths, repository scan after restart, path-checked open | persisted-session cases in `simulationService.test.ts`, `SessionRepository` coverage through service tests | working |
| GitHub markdown export | Issue selection, preview, markdown files, explicit-only post boundary | GitHub export/post cases in `simulationService.test.ts`, Issues page smoke coverage | working |
| Save isolation | Profile config, per-instance path, seed copy, launch argument/environment, cleanup and report fields | `GameInstanceManager.test.ts`, `ProfileAdapterOptions.test.ts`, `StructuredLoggers.test.ts` | working |

## Release Invariants

| Invariant | Verification | Status |
| --- | --- | --- |
| Every production Settings control affects runtime | Settings contains release guidance plus persisted Live Bot Observation controls; incomplete intelligence controls remain removed | working |
| Every template references an existing profile | Both first-test and focused-template suites compare IDs with `defaultBotProfiles` | working |
| Every specialized profile has planner behavior | The planner suite exercises every specialized profile and rejects the default rule key | working |
| Every directive mode has runtime handling | Influence, focus, force, repeat, and guided sequence are covered; unavailable actions are never fabricated | fixed |
| Reports use performed and saved data | Summaries use runtime manager snapshots, actual bot/instance states, detected issues, captured evidence and persisted config | working |
| Persisted sessions remain read-only | Runtime controls reject saved sessions; listing, polling, log reads, report reads and shutdown do not rewrite them | fixed |
| Reload cannot replace a live session | Persisted refresh skips every non-persisted in-memory record | fixed |

## Repairs Made

1. Added optional `botProfiles` to session config artifacts and backward-compatible loading for old artifacts.
2. Prevented metadata rewrites while listing or opening persisted sessions.
3. Blocked start, stop, pause, resume, bot, directive, observation and focus mutations on persisted sessions.
4. Excluded persisted records from graceful and forced runtime shutdown cleanup.
5. Made persisted structured-log fallback reads use existing paths without constructing file-writing loggers.
6. Connected directive runtime timeouts, guided step completion, next-step advancement, configured step waits and terminal limit failures.
7. Connected Manual Success Confirmation to an explicit Live Session command and persisted report state.
8. Added template/profile and specialized-profile/planner invariants.
