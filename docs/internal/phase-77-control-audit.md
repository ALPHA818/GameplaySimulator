# Phase 77 Production Control Audit

Temporary internal release-work document. Audited 2026-07-28.

Status meanings:

- **working**: the visible control reaches its intended application or runtime behavior.
- **partially working**: the control works within its stated scope, but a limitation is recorded below.
- **placeholder**: visible behavior claims work that is not implemented. There are no remaining production controls in this state.
- **dead**: unused code or a removed production control.

## Application Shell And Dashboard

| Control or feature | Source file | Runtime handler | Test coverage | Status |
| --- | --- | --- | --- | --- |
| Sidebar page navigation and compact layout | `apps/desktop/src/renderer/src/components/AppShell.tsx` | Zustand `navigate()` | `AppShell.layout.test.tsx` | working |
| Dashboard actions: New Session, Live Session, Game Profiles, Bot Profiles, Reports, Settings | `apps/desktop/src/renderer/src/pages/DashboardPage.tsx` | Zustand `navigate()` | `uiSmoke.test.tsx` | working |
| Help / First Test navigation and guidance | `AppShell.tsx`, `HelpFirstTestPage.tsx` | Zustand `navigate()` | `AppShell.layout.test.tsx`, `uiSmoke.test.tsx` | working |
| Hover/focus help and viewport-safe tooltip layer | `components/FormFields.tsx` | React portal and positioning handlers | `FormFields.tooltip.test.tsx` | working |

## Game Profiles

| Control or feature | Source file | Runtime handler | Test coverage | Status |
| --- | --- | --- | --- | --- |
| New Profile and Edit | `pages/GameProfilesPage.tsx` | `openGameProfileEditor()` | renderer smoke coverage | working |
| Wizard selection and profile fields | `pages/GameProfileEditorPage.tsx` | Local form state, `GameProfileSchema`, `saveGameProfile()`, workspace IPC | `uiSmoke.test.tsx`, `modelSchemas.test.ts`, workspace persistence tests | working |
| Desktop launch, working directory, arguments, controls, dependency display | `GameProfileEditorPage.tsx` | `simulation:testGameProfile`, `simulation:testDesktopControl` | desktop adapter and service tests | working on platforms reported as supported |
| Browser URL, browser type, DOM scan, visible profile test | `GameProfileEditorPage.tsx` | `simulation:testGameProfile` to `BrowserAdapter` | browser adapter integration and smoke tests | working |
| Instrumented endpoint health test | `GameProfileEditorPage.tsx` | `simulation:testGameProfile` to `InstrumentedAdapter` | `InstrumentedAdapter.test.ts`, real-adapter integration tests | working for Local HTTP |
| Instrumented WebSocket, file bridge, and plugin bridge options | `GameProfileEditorPage.tsx` | Disabled options plus backend validation | `ProfileAdapterOptions.test.ts` | partially working: clearly unavailable and cannot be selected |
| Unity, Godot, and Unreal instrumented/desktop fallback selection | `GameProfileEditorPage.tsx` | adapter option builder and engine wrappers | `ProfileAdapterOptions.test.ts`, `AdapterFactory.test.ts` | working |
| Custom engine instrumented/desktop fallback | `GameProfileEditorPage.tsx` | working adapter selected by wizard | adapter option tests | working |
| Generic custom adapter choice | `GameProfileEditorPage.tsx`, `CustomAdapter.ts` | Disabled UI, validation error, explicit launch error | `ProfileAdapterOptions.test.ts`, `AdapterFactory.test.ts` | partially working: explicitly unavailable rather than simulated |
| Save isolation, known content, capabilities, and UI flow editor | `GameProfileEditorPage.tsx` | schema-backed profile data consumed by session runtime | schema, instance manager, coverage, and startup-flow tests | working |
| Validate First Step / Validate Full Flow | `GameProfileEditorPage.tsx` | Local schema/readiness validation | renderer smoke coverage | working as validation only; labels do not claim to execute a game flow |
| Video support profile toggle | removed from production editor | Adapter validation rejects `saveVideo` | adapter/service validation tests | dead |

## Bot Profiles

| Control or feature | Source file | Runtime handler | Test coverage | Status |
| --- | --- | --- | --- | --- |
| General, specialized, and custom sections and filters | `pages/BotProfilesPage.tsx` | Renderer filtering and compatibility evaluation | `BotProfilesPage.test.tsx`, compatibility tests | working |
| Add To Session / Add Recommended Bots | `BotProfilesPage.tsx` | pending profile IDs in config store consumed by New Session | Bot Profiles and New Session template tests | working |
| Clone and create custom profile | `pages/BotProfileEditorPage.tsx` | schema validation, `saveBotProfile()`, workspace IPC | `BotProfileEditorPage.test.tsx`, custom profile validator and workspace persistence tests | working |
| Profile Group | `BotProfileEditorPage.tsx` | Static `Custom` value for user-created profiles | editor tests | working; no read-only select pretending to be editable |

## New Session

| Control or feature | Source file | Runtime handler | Test coverage | Status |
| --- | --- | --- | --- | --- |
| First-test and focused-test templates | `pages/NewSessionPage.tsx` | Template application to bot pool, directive, limits, evidence, and observation form state | `NewSessionPage.templates.test.tsx`, template tests | working |
| Game profile, run mode, limits, evidence, resource limits, and observation fields | `NewSessionPage.tsx` | `SimulationRunConfigSchema`, backend validation, resource manager | schema, resource, observation, and page tests | working |
| Bot pool add/remove/count/scaling controls | `NewSessionPage.tsx` | `BotPoolResolver` and `ResourceManager` | pool resolver, resource manager, and page tests | working |
| Pre-run directives and directive templates | `NewSessionPage.tsx` | `BotTestDirectiveSchema` saved with run config | directive schema/manager/planner and page tests | working |
| Check Startup Flow | `NewSessionPage.tsx` | Local readiness check for configured flow and timeout | startup-flow regression tests | working as a readiness check only |
| Startup flow execution during Start Session | `NewSessionPage.tsx` | `createSession` / `startSession`, backend flow runner | simulation service startup-flow tests | working |
| Validate, viability estimate, Run Anyway, and resolved bot counts | `NewSessionPage.tsx` | preload IPC to `SimulationService` and `ResourceManager` | service, resource, and page tests | working |
| Start, stop, pause, and resume current session | `NewSessionPage.tsx` | preload IPC to `SimulationService` | simulation service tests | working |
| Mock runtime choice | no production control | optional `useMockRuntime` config read by `SimulationService` | real/mock service tests | dead in beginner UI; retained only for explicit development/test configs |
| Save Video | no production control | backend adapter validation rejects it | adapter/service validation tests | dead until a production adapter implements capture |

## Live Session

| Control or feature | Source file | Runtime handler | Test coverage | Status |
| --- | --- | --- | --- | --- |
| Start, Stop, Pause, Resume | `pages/LiveSessionPage.tsx` | simulation IPC methods | service and smoke tests | working |
| Stop selected bot and bot pool | `LiveSessionPage.tsx` | `stopBot`, `stopBotPool` IPC | bot manager and service tests | working |
| Live bots, pools, instances, health, issues, coverage, and logs | `LiveSessionPage.tsx` | polled service status methods | service, observation, and smoke tests | working |
| Follow bot, stop following, next/previous bot, focus window | `LiveSessionPage.tsx` | `RuntimeObservationManager` IPC methods | `RuntimeObservationManager.test.ts`, service tests | working when adapter capability reports support |
| Guide This Bot, exact available action, queue/replace/cancel/reorder | `LiveBotGuidancePanel.tsx` | directive IPC methods | `LiveBotGuidancePanel.test.tsx`, directive manager tests | working |
| Open Logs | `LiveSessionPage.tsx` | selects active session and navigates to in-app Logs | renderer smoke/filter coverage | working |
| Open Report | `LiveSessionPage.tsx` | `simulation:openReport` | simulation service tests | working |

## Issues And Logs

| Control or feature | Source file | Runtime handler | Test coverage | Status |
| --- | --- | --- | --- | --- |
| Issue session selection, filters, search, and detail | `pages/IssuesPage.tsx` | persisted session service reads plus renderer filtering | issue directive and smoke tests | working |
| Open screenshot/evidence | `IssuesPage.tsx` | `simulation:openEvidence` with session-root path checks | evidence and service tests | working |
| Mark reviewed / false positive | `IssuesPage.tsx` | session store flags persisted by workspace IPC | renderer and workspace persistence tests | working |
| Ask Bot To Retest | `IssuesPage.tsx` | builds an issue-reproduction directive and opens New Session | `IssuesPage.directives.test.tsx` | working |
| GitHub preview/export/post | `IssuesPage.tsx` | explicit IPC preview/export/post handlers; posting requires confirmation | simulation service tests | working |
| Logs session selector, tabs, filters, chips, search, and noise controls | `pages/LogsPage.tsx` | `getStructuredLogs`, one `filteredLogs` pipeline | `LogsPage.filters.test.tsx`, responsive tests | working |
| Log details, issue links, evidence links, keyboard selection | `LogsPage.tsx` | filtered selection and navigation/open-evidence handlers | log filter and issue logger tests | working |
| Export Visible Logs | `LogsPage.tsx` | renderer-generated JSON download from `filteredLogs` | log filter tests | working |

## Reports And Settings

| Control or feature | Source file | Runtime handler | Test coverage | Status |
| --- | --- | --- | --- | --- |
| Reload and list saved sessions | `pages/ReportsPage.tsx` | SessionRepository IPC methods | service persistence and smoke tests | working |
| Open folder, summary, issue folder, screenshots | `ReportsPage.tsx` | path-checked open IPC methods | simulation service tests | working |
| View Issues / View Logs / Export Issues | `ReportsPage.tsx` | selects persisted session and navigates to the matching in-app page | renderer smoke/filter coverage | working |
| Compare Sessions | `ReportsPage.tsx` | `simulation:compareSessions` | simulation service comparison tests | working |
| Cleanup raw logs/screenshots/summaries | `ReportsPage.tsx` | `simulation:cleanupSessionBundle` | simulation service cleanup tests | working |
| Save bundle file list | `ReportsPage.tsx` | writes a JSON file inventory before cleanup | simulation service cleanup tests | working; label no longer claims a compressed archive |
| Runtime readiness and default cards | `pages/SettingsPage.tsx` | Static release guidance | responsive and smoke tests | working |
| Live Bot Observation settings | `SettingsPage.tsx` | config store with localStorage persistence, consumed by session runtime | observation and persistence tests | working |
| Advanced Intelligence controls | removed from Settings and config store | none | absence assertions in Settings/smoke tests | dead |

## Backend And Packaging

| Control or feature | Source file | Runtime handler | Test coverage | Status |
| --- | --- | --- | --- | --- |
| Electron preload simulation API | `apps/desktop/src/preload/index.ts` | validated IPC handlers in `apps/desktop/src/main/ipc/simulation.ts` | service and integration tests | working |
| Workspace profiles, settings, run configs, and issue review state | `WorkspaceRepository.ts`, `ipc/workspace.ts` | validated atomic userData storage with backup recovery | repository and store persistence tests | working |
| Adapter-backed sessions | `apps/desktop/src/main/services/simulationService.ts` | `AdapterFactory`, `GameInstanceManager`, `BotManager` | real adapter integration tests | working |
| Optional mock runtime | `simulationService.ts` | explicit `useMockRuntime: true` only | service tests | working for development/tests and not exposed to beginners |
| Standalone `apps/runner` package | removed | no imports or runtime callers existed | repository usage search | dead |
| Advanced intelligence config and simulator engine shell | removed | no runtime callers existed | repository usage search | dead |

## Search Notes

- `startRunner`, `getRunnerHealth`, `apps/runner`, `dist/runner`, and `build:runner`: no remaining repository references.
- Production renderer labels no longer contain phase labels, future-improvement labels, mock-session claims, or placeholder claims.
- Remaining “not implemented” strings are platform capability errors in `DesktopAdapterDependencyChecker` and `DesktopWindowAdapter`. They are shown as unsupported capability warnings and prevent silent success.
- Remaining uses of “temporary” describe actual temporary save directories or temporary browser profile-test windows.
