import { ipcMain } from 'electron';
import { z } from 'zod';
import {
  DesktopControlTestRequestSchema,
  GameProfileTestRequestSchema,
  GitHubIssueExportRequestSchema,
  GitHubIssuePostRequestSchema,
  GuideBotDirectiveRequestSchema,
  ReorderBotDirectivesRequestSchema,
  SessionCleanupOptionsSchema,
  SimulationSessionRequestSchema,
  type SimulationService
} from '../services/simulationService';
import {
  IpcIdentifierSchema,
  IpcPathSchema,
  OptionalIpcIdentifierSchema
} from './validation';

const ObservationDirectionSchema = z.enum(['next', 'previous']);
const StructuredLogPageRequestSchema = z.object({
  before: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(500).optional()
}).default({});
const ValidationPayloadBoundarySchema = z
  .object({
    runConfig: z.unknown(),
    gameProfile: z.unknown(),
    botProfiles: z.unknown().optional(),
    runtimeObservation: z.unknown().optional()
  })
  .passthrough();

export function registerSimulationIpc(service: SimulationService): void {
  ipcMain.handle('simulation:createSession', (_event, payload: unknown) =>
    service.createSessionWithPreflight(SimulationSessionRequestSchema.parse(payload))
  );
  ipcMain.handle('simulation:listSessions', () => service.listSessions());
  ipcMain.handle('simulation:reloadSessions', () => service.reloadPersistedSessions());
  ipcMain.handle('simulation:validateSessionConfig', (_event, payload: unknown) =>
    service.validateSessionConfigWithDependencies(ValidationPayloadBoundarySchema.parse(payload))
  );
  ipcMain.handle('simulation:estimateViability', (_event, payload: unknown) =>
    service.estimateViability(SimulationSessionRequestSchema.parse(payload))
  );
  ipcMain.handle('simulation:getDesktopAdapterDependencies', () => service.getDesktopAdapterDependencies());
  ipcMain.handle('simulation:testGameProfile', (_event, payload: unknown) =>
    service.testGameProfile(GameProfileTestRequestSchema.parse(payload))
  );
  ipcMain.handle('simulation:testDesktopControl', (_event, payload: unknown) =>
    service.testDesktopControl(DesktopControlTestRequestSchema.parse(payload))
  );
  ipcMain.handle('simulation:startSession', (_event, sessionId: unknown) =>
    service.startSession(IpcIdentifierSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:stopSession', (_event, sessionId: unknown) =>
    service.stopSession(IpcIdentifierSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:pauseSession', (_event, sessionId: unknown) =>
    service.pauseSession(IpcIdentifierSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:resumeSession', (_event, sessionId: unknown) =>
    service.resumeSession(IpcIdentifierSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:getSessionStatus', (_event, sessionId?: unknown) =>
    service.getSessionStatus(OptionalIpcIdentifierSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:getBotStatuses', (_event, sessionId: unknown) =>
    service.getBotStatuses(IpcIdentifierSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:getDirectiveState', (_event, sessionId: unknown) =>
    service.getDirectiveState(IpcIdentifierSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:getBotAvailableActions', (_event, sessionId: unknown, botId: unknown) =>
    service.getBotAvailableActions(
      IpcIdentifierSchema.parse(sessionId),
      IpcIdentifierSchema.parse(botId)
    )
  );
  ipcMain.handle('simulation:guideBot', (_event, payload: unknown) =>
    service.guideBot(GuideBotDirectiveRequestSchema.parse(payload))
  );
  ipcMain.handle(
    'simulation:cancelBotDirective',
    (_event, sessionId: unknown, botId: unknown, directiveId: unknown) =>
      service.cancelBotDirective(
        IpcIdentifierSchema.parse(sessionId),
        IpcIdentifierSchema.parse(botId),
        IpcIdentifierSchema.parse(directiveId)
      )
  );
  ipcMain.handle(
    'simulation:confirmBotDirectiveSuccess',
    (_event, sessionId: unknown, botId: unknown, directiveId: unknown) =>
      service.confirmBotDirectiveSuccess(
        IpcIdentifierSchema.parse(sessionId),
        IpcIdentifierSchema.parse(botId),
        IpcIdentifierSchema.parse(directiveId)
      )
  );
  ipcMain.handle('simulation:reorderBotDirectives', (_event, payload: unknown) =>
    service.reorderBotDirectives(ReorderBotDirectivesRequestSchema.parse(payload))
  );
  ipcMain.handle('simulation:getLiveObservationState', (_event, sessionId: unknown) =>
    service.getLiveObservationState(IpcIdentifierSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:followBot', (_event, sessionId: unknown, botId: unknown) =>
    service.followBot(IpcIdentifierSchema.parse(sessionId), IpcIdentifierSchema.parse(botId))
  );
  ipcMain.handle('simulation:stopFollowingBot', (_event, sessionId: unknown) =>
    service.stopFollowingBot(IpcIdentifierSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:showAdjacentBot', (_event, sessionId: unknown, direction: unknown) =>
    service.showAdjacentBot(
      IpcIdentifierSchema.parse(sessionId),
      ObservationDirectionSchema.parse(direction)
    )
  );
  ipcMain.handle('simulation:focusObservedGameWindow', (_event, sessionId: unknown) =>
    service.focusObservedGameWindow(IpcIdentifierSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:stopBot', (_event, sessionId: unknown, botId: unknown) =>
    service.stopBot(IpcIdentifierSchema.parse(sessionId), IpcIdentifierSchema.parse(botId))
  );
  ipcMain.handle('simulation:stopBotPool', (_event, sessionId: unknown, profileId: unknown) =>
    service.stopBotPool(IpcIdentifierSchema.parse(sessionId), IpcIdentifierSchema.parse(profileId))
  );
  ipcMain.handle('simulation:getInstanceStatuses', (_event, sessionId: unknown) =>
    service.getInstanceStatuses(IpcIdentifierSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:getIssues', (_event, sessionId: unknown) =>
    service.getIssues(IpcIdentifierSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:getLogs', (_event, sessionId: unknown) =>
    service.getLogs(IpcIdentifierSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:getCoverage', (_event, sessionId: unknown) =>
    service.getCoverage(IpcIdentifierSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:getStructuredLogs', (_event, sessionId: unknown, page: unknown) =>
    service.getStructuredLogs(
      IpcIdentifierSchema.parse(sessionId),
      StructuredLogPageRequestSchema.parse(page)
    )
  );
  ipcMain.handle('simulation:openEvidence', (_event, sessionId: unknown, evidencePath: unknown) =>
    service.openEvidence(IpcIdentifierSchema.parse(sessionId), IpcPathSchema.parse(evidencePath))
  );
  ipcMain.handle('simulation:openReport', (_event, sessionId: unknown) =>
    service.openReport(IpcIdentifierSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:openLogs', (_event, sessionId: unknown) =>
    service.openLogs(IpcIdentifierSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:openSessionFolder', (_event, sessionId: unknown) =>
    service.openSessionFolder(IpcIdentifierSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:openIssueFolder', (_event, sessionId: unknown) =>
    service.openIssueFolder(IpcIdentifierSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:openScreenshotsFolder', (_event, sessionId: unknown) =>
    service.openScreenshotsFolder(IpcIdentifierSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:cleanupSessionBundle', (_event, payload: unknown) =>
    service.cleanupSessionBundle(SessionCleanupOptionsSchema.parse(payload))
  );
  ipcMain.handle('simulation:compareSessions', (_event, oldSessionId: unknown, newSessionId: unknown) =>
    service.compareSessions(
      IpcIdentifierSchema.parse(oldSessionId),
      IpcIdentifierSchema.parse(newSessionId)
    )
  );
  ipcMain.handle('simulation:previewGitHubIssueExport', (_event, payload: unknown) =>
    service.previewGitHubIssueExport(GitHubIssueExportRequestSchema.parse(payload))
  );
  ipcMain.handle('simulation:exportGitHubIssueMarkdown', (_event, payload: unknown) =>
    service.exportGitHubIssueMarkdown(GitHubIssueExportRequestSchema.parse(payload))
  );
  ipcMain.handle('simulation:postGitHubIssues', (_event, payload: unknown) =>
    service.postGitHubIssues(GitHubIssuePostRequestSchema.parse(payload))
  );
}
