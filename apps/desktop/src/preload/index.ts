import { contextBridge, ipcRenderer as electronIpcRenderer } from 'electron';
import type {
  BotProfile,
  DetectedIssue,
  GameInstanceStatus,
  GameProfile,
  RuntimeViabilityReport,
  SimulationRunConfig
} from '@core/types';
import type { LogEntry } from '@core/logging/LogEntry';
import type {
  OpenReportResult,
  OpenLogsResult,
  OpenEvidenceResult,
  ComparisonReportResult,
  GitHubIssueExportRequest,
  GitHubIssueExportPreviewResult,
  GitHubIssueMarkdownExportResult,
  GitHubIssuePostRequest,
  GitHubIssuePostResult,
  OpenSessionPathResult,
  SessionCleanupOptions,
  SessionCleanupResult,
  ContentCoverageSummary,
  DesktopControlTestRequest,
  DesktopControlTestResult,
  GameProfileTestRequest,
  GameProfileTestResult,
  GuideBotDirectiveRequest,
  LiveDirectiveMutationResult,
  LiveObservationState,
  PersistedSessionMetadata,
  ReorderBotDirectivesRequest,
  SimulationBotStatus,
  SimulationSessionCreateResult,
  SimulationSessionStatusSnapshot,
  StructuredLogReadResult,
  SimulationValidationResult
} from '../main/services/simulationService';
import type { DesktopAdapterDependencyReport } from '../../../../packages/adapters/src';
import type { RuntimeObservationConfig } from '@core/config/runtimeObservationConfig';
import type {
  WorkspaceData,
  WorkspaceDataPatch,
  WorkspaceLoadResult
} from '@core/config/workspaceData';
import type { BotDirectiveManagerSnapshot } from '@core/bot/BotDirectiveManager';
import type { AvailableGameActionLike } from '@core/bot/ActionPlanner';

interface SimulationSessionPayload {
  runConfig: SimulationRunConfig;
  gameProfile: GameProfile;
  botProfiles?: BotProfile[];
  runtimeObservation?: RuntimeObservationConfig;
}

function readableIpcMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim() || 'The application could not complete this request.';
}

const ipcRenderer = {
  async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    try {
      return await electronIpcRenderer.invoke(channel, ...args);
    } catch (error) {
      throw new Error(readableIpcMessage(error));
    }
  }
};

const api = {
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion') as Promise<string>,
    openApplicationLogs: () =>
      ipcRenderer.invoke('app:openApplicationLogs') as Promise<{ opened: boolean; message: string }>,
    reportRendererError: (details: Record<string, unknown>) =>
      ipcRenderer.invoke('app:reportRendererError', details) as Promise<void>
  },
  sessions: {
    getStatus: () =>
      ipcRenderer.invoke('sessions:getStatus') as Promise<SimulationSessionStatusSnapshot>
  },
  resources: {
    estimateViability: (payload: SimulationSessionPayload) =>
      ipcRenderer.invoke('resources:estimateViability', payload) as Promise<RuntimeViabilityReport>
  },
  workspace: {
    load: () =>
      ipcRenderer.invoke('workspace:load') as Promise<WorkspaceLoadResult>,
    save: (data: WorkspaceData) =>
      ipcRenderer.invoke('workspace:save', data) as Promise<WorkspaceData>,
    update: (patch: WorkspaceDataPatch) =>
      ipcRenderer.invoke('workspace:update', patch) as Promise<WorkspaceData>,
    createBackup: () =>
      ipcRenderer.invoke('workspace:createBackup') as Promise<string | null>,
    recoverFromBackup: () =>
      ipcRenderer.invoke('workspace:recoverFromBackup') as Promise<WorkspaceData | null>
  },
  simulation: {
    createSession: (payload: SimulationSessionPayload) =>
      ipcRenderer.invoke('simulation:createSession', payload) as Promise<SimulationSessionCreateResult>,
    listSessions: () =>
      ipcRenderer.invoke('simulation:listSessions') as Promise<PersistedSessionMetadata[]>,
    reloadSessions: () =>
      ipcRenderer.invoke('simulation:reloadSessions') as Promise<PersistedSessionMetadata[]>,
    validateSessionConfig: (payload: SimulationSessionPayload) =>
      ipcRenderer.invoke('simulation:validateSessionConfig', payload) as Promise<SimulationValidationResult>,
    estimateViability: (payload: SimulationSessionPayload) =>
      ipcRenderer.invoke('simulation:estimateViability', payload) as Promise<RuntimeViabilityReport>,
    getDesktopAdapterDependencies: () =>
      ipcRenderer.invoke('simulation:getDesktopAdapterDependencies') as Promise<DesktopAdapterDependencyReport>,
    testGameProfile: (payload: GameProfileTestRequest) =>
      ipcRenderer.invoke('simulation:testGameProfile', payload) as Promise<GameProfileTestResult>,
    testDesktopControl: (payload: DesktopControlTestRequest) =>
      ipcRenderer.invoke('simulation:testDesktopControl', payload) as Promise<DesktopControlTestResult>,
    startSession: (sessionId: string) =>
      ipcRenderer.invoke('simulation:startSession', sessionId) as Promise<SimulationSessionStatusSnapshot>,
    stopSession: (sessionId: string) =>
      ipcRenderer.invoke('simulation:stopSession', sessionId) as Promise<SimulationSessionStatusSnapshot>,
    pauseSession: (sessionId: string) =>
      ipcRenderer.invoke('simulation:pauseSession', sessionId) as Promise<SimulationSessionStatusSnapshot>,
    resumeSession: (sessionId: string) =>
      ipcRenderer.invoke('simulation:resumeSession', sessionId) as Promise<SimulationSessionStatusSnapshot>,
    getSessionStatus: (sessionId?: string) =>
      ipcRenderer.invoke('simulation:getSessionStatus', sessionId) as Promise<SimulationSessionStatusSnapshot>,
    getBotStatuses: (sessionId: string) =>
      ipcRenderer.invoke('simulation:getBotStatuses', sessionId) as Promise<SimulationBotStatus[]>,
    getDirectiveState: (sessionId: string) =>
      ipcRenderer.invoke('simulation:getDirectiveState', sessionId) as Promise<BotDirectiveManagerSnapshot>,
    getBotAvailableActions: (sessionId: string, botId: string) =>
      ipcRenderer.invoke('simulation:getBotAvailableActions', sessionId, botId) as Promise<AvailableGameActionLike[]>,
    guideBot: (payload: GuideBotDirectiveRequest) =>
      ipcRenderer.invoke('simulation:guideBot', payload) as Promise<LiveDirectiveMutationResult>,
    cancelBotDirective: (sessionId: string, botId: string, directiveId: string) =>
      ipcRenderer.invoke('simulation:cancelBotDirective', sessionId, botId, directiveId) as Promise<LiveDirectiveMutationResult>,
    confirmBotDirectiveSuccess: (sessionId: string, botId: string, directiveId: string) =>
      ipcRenderer.invoke('simulation:confirmBotDirectiveSuccess', sessionId, botId, directiveId) as Promise<LiveDirectiveMutationResult>,
    reorderBotDirectives: (payload: ReorderBotDirectivesRequest) =>
      ipcRenderer.invoke('simulation:reorderBotDirectives', payload) as Promise<LiveDirectiveMutationResult>,
    getLiveObservationState: (sessionId: string) =>
      ipcRenderer.invoke('simulation:getLiveObservationState', sessionId) as Promise<LiveObservationState>,
    followBot: (sessionId: string, botId: string) =>
      ipcRenderer.invoke('simulation:followBot', sessionId, botId) as Promise<LiveObservationState>,
    stopFollowingBot: (sessionId: string) =>
      ipcRenderer.invoke('simulation:stopFollowingBot', sessionId) as Promise<LiveObservationState>,
    showAdjacentBot: (sessionId: string, direction: 'next' | 'previous') =>
      ipcRenderer.invoke('simulation:showAdjacentBot', sessionId, direction) as Promise<LiveObservationState>,
    focusObservedGameWindow: (sessionId: string) =>
      ipcRenderer.invoke('simulation:focusObservedGameWindow', sessionId) as Promise<LiveObservationState>,
    stopBot: (sessionId: string, botId: string) =>
      ipcRenderer.invoke('simulation:stopBot', sessionId, botId) as Promise<SimulationBotStatus[]>,
    stopBotPool: (sessionId: string, profileId: string) =>
      ipcRenderer.invoke('simulation:stopBotPool', sessionId, profileId) as Promise<SimulationBotStatus[]>,
    getInstanceStatuses: (sessionId: string) =>
      ipcRenderer.invoke('simulation:getInstanceStatuses', sessionId) as Promise<GameInstanceStatus[]>,
    getIssues: (sessionId: string) =>
      ipcRenderer.invoke('simulation:getIssues', sessionId) as Promise<DetectedIssue[]>,
    getLogs: (sessionId: string) =>
      ipcRenderer.invoke('simulation:getLogs', sessionId) as Promise<LogEntry[]>,
    getCoverage: (sessionId: string) =>
      ipcRenderer.invoke('simulation:getCoverage', sessionId) as Promise<ContentCoverageSummary>,
    getStructuredLogs: (sessionId: string) =>
      ipcRenderer.invoke('simulation:getStructuredLogs', sessionId) as Promise<StructuredLogReadResult>,
    openEvidence: (sessionId: string, evidencePath: string) =>
      ipcRenderer.invoke('simulation:openEvidence', sessionId, evidencePath) as Promise<OpenEvidenceResult>,
    openReport: (sessionId: string) =>
      ipcRenderer.invoke('simulation:openReport', sessionId) as Promise<OpenReportResult>,
    openLogs: (sessionId: string) =>
      ipcRenderer.invoke('simulation:openLogs', sessionId) as Promise<OpenLogsResult>,
    openSessionFolder: (sessionId: string) =>
      ipcRenderer.invoke('simulation:openSessionFolder', sessionId) as Promise<OpenSessionPathResult>,
    openIssueFolder: (sessionId: string) =>
      ipcRenderer.invoke('simulation:openIssueFolder', sessionId) as Promise<OpenSessionPathResult>,
    openScreenshotsFolder: (sessionId: string) =>
      ipcRenderer.invoke('simulation:openScreenshotsFolder', sessionId) as Promise<OpenSessionPathResult>,
    cleanupSessionBundle: (payload: SessionCleanupOptions) =>
      ipcRenderer.invoke('simulation:cleanupSessionBundle', payload) as Promise<SessionCleanupResult>,
    compareSessions: (oldSessionId: string, newSessionId: string) =>
      ipcRenderer.invoke('simulation:compareSessions', oldSessionId, newSessionId) as Promise<ComparisonReportResult>,
    previewGitHubIssueExport: (payload: GitHubIssueExportRequest) =>
      ipcRenderer.invoke('simulation:previewGitHubIssueExport', payload) as Promise<GitHubIssueExportPreviewResult>,
    exportGitHubIssueMarkdown: (payload: GitHubIssueExportRequest) =>
      ipcRenderer.invoke('simulation:exportGitHubIssueMarkdown', payload) as Promise<GitHubIssueMarkdownExportResult>,
    postGitHubIssues: (payload: GitHubIssuePostRequest) =>
      ipcRenderer.invoke('simulation:postGitHubIssues', payload) as Promise<GitHubIssuePostResult>
  }
};

contextBridge.exposeInMainWorld('gameplaySimulator', api);

export type GameplaySimulatorApi = typeof api;
