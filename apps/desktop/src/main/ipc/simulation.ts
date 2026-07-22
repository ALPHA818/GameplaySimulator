import { ipcMain } from 'electron';
import { z } from 'zod';
import type { SimulationService } from '../services/simulationService';

const SessionIdSchema = z.string().min(1);
const ObservationDirectionSchema = z.enum(['next', 'previous']);
const SessionCleanupOptionsSchema = z.object({
  sessionId: SessionIdSchema,
  deleteRawStateLogs: z.boolean().default(false),
  keepScreenshots: z.boolean().default(true),
  keepSummaries: z.boolean().default(true),
  archiveSessionBundle: z.boolean().default(false)
});

export function registerSimulationIpc(service: SimulationService): void {
  ipcMain.handle('simulation:createSession', (_event, payload: unknown) => service.createSession(payload));
  ipcMain.handle('simulation:listSessions', () => service.listSessions());
  ipcMain.handle('simulation:reloadSessions', () => service.reloadPersistedSessions());
  ipcMain.handle('simulation:validateSessionConfig', (_event, payload: unknown) =>
    service.validateSessionConfig(payload)
  );
  ipcMain.handle('simulation:estimateViability', (_event, payload: unknown) => service.estimateViability(payload));
  ipcMain.handle('simulation:getDesktopAdapterDependencies', () => service.getDesktopAdapterDependencies());
  ipcMain.handle('simulation:testGameProfile', (_event, payload: unknown) => service.testGameProfile(payload));
  ipcMain.handle('simulation:testDesktopControl', (_event, payload: unknown) => service.testDesktopControl(payload));
  ipcMain.handle('simulation:startSession', (_event, sessionId: unknown) =>
    service.startSession(SessionIdSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:stopSession', (_event, sessionId: unknown) =>
    service.stopSession(SessionIdSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:pauseSession', (_event, sessionId: unknown) =>
    service.pauseSession(SessionIdSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:resumeSession', (_event, sessionId: unknown) =>
    service.resumeSession(SessionIdSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:getSessionStatus', (_event, sessionId?: unknown) =>
    service.getSessionStatus(typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : undefined)
  );
  ipcMain.handle('simulation:getBotStatuses', (_event, sessionId: unknown) =>
    service.getBotStatuses(SessionIdSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:getLiveObservationState', (_event, sessionId: unknown) =>
    service.getLiveObservationState(SessionIdSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:followBot', (_event, sessionId: unknown, botId: unknown) =>
    service.followBot(SessionIdSchema.parse(sessionId), SessionIdSchema.parse(botId))
  );
  ipcMain.handle('simulation:stopFollowingBot', (_event, sessionId: unknown) =>
    service.stopFollowingBot(SessionIdSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:showAdjacentBot', (_event, sessionId: unknown, direction: unknown) =>
    service.showAdjacentBot(
      SessionIdSchema.parse(sessionId),
      ObservationDirectionSchema.parse(direction)
    )
  );
  ipcMain.handle('simulation:focusObservedGameWindow', (_event, sessionId: unknown) =>
    service.focusObservedGameWindow(SessionIdSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:stopBot', (_event, sessionId: unknown, botId: unknown) =>
    service.stopBot(SessionIdSchema.parse(sessionId), SessionIdSchema.parse(botId))
  );
  ipcMain.handle('simulation:stopBotPool', (_event, sessionId: unknown, profileId: unknown) =>
    service.stopBotPool(SessionIdSchema.parse(sessionId), SessionIdSchema.parse(profileId))
  );
  ipcMain.handle('simulation:getInstanceStatuses', (_event, sessionId: unknown) =>
    service.getInstanceStatuses(SessionIdSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:getIssues', (_event, sessionId: unknown) =>
    service.getIssues(SessionIdSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:getLogs', (_event, sessionId: unknown) =>
    service.getLogs(SessionIdSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:getCoverage', (_event, sessionId: unknown) =>
    service.getCoverage(SessionIdSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:getStructuredLogs', (_event, sessionId: unknown) =>
    service.getStructuredLogs(SessionIdSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:openEvidence', (_event, sessionId: unknown, evidencePath: unknown) =>
    service.openEvidence(SessionIdSchema.parse(sessionId), SessionIdSchema.parse(evidencePath))
  );
  ipcMain.handle('simulation:openReport', (_event, sessionId: unknown) =>
    service.openReport(SessionIdSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:openLogs', (_event, sessionId: unknown) =>
    service.openLogs(SessionIdSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:openSessionFolder', (_event, sessionId: unknown) =>
    service.openSessionFolder(SessionIdSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:openIssueFolder', (_event, sessionId: unknown) =>
    service.openIssueFolder(SessionIdSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:openScreenshotsFolder', (_event, sessionId: unknown) =>
    service.openScreenshotsFolder(SessionIdSchema.parse(sessionId))
  );
  ipcMain.handle('simulation:cleanupSessionBundle', (_event, payload: unknown) =>
    service.cleanupSessionBundle(SessionCleanupOptionsSchema.parse(payload))
  );
  ipcMain.handle('simulation:compareSessions', (_event, oldSessionId: unknown, newSessionId: unknown) =>
    service.compareSessions(SessionIdSchema.parse(oldSessionId), SessionIdSchema.parse(newSessionId))
  );
  ipcMain.handle('simulation:previewGitHubIssueExport', (_event, payload: unknown) =>
    service.previewGitHubIssueExport(payload)
  );
  ipcMain.handle('simulation:exportGitHubIssueMarkdown', (_event, payload: unknown) =>
    service.exportGitHubIssueMarkdown(payload)
  );
  ipcMain.handle('simulation:postGitHubIssues', (_event, payload: unknown) =>
    service.postGitHubIssues(payload)
  );
}
