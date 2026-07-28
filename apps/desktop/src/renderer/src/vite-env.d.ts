/// <reference types="vite/client" />

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
} from '../../main/services/simulationService';
import type { DesktopAdapterDependencyReport } from '../../../../../packages/adapters/src';
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

declare global {
  interface Window {
    gameplaySimulator: {
      app: {
        getVersion: () => Promise<string>;
        openApplicationLogs: () => Promise<{ opened: boolean; message: string }>;
        reportRendererError: (details: Record<string, unknown>) => Promise<void>;
      };
      sessions: {
        getStatus: () => Promise<SimulationSessionStatusSnapshot>;
      };
      resources: {
        estimateViability: (payload: SimulationSessionPayload) => Promise<RuntimeViabilityReport>;
      };
      workspace: {
        load: () => Promise<WorkspaceLoadResult>;
        save: (data: WorkspaceData) => Promise<WorkspaceData>;
        update: (patch: WorkspaceDataPatch) => Promise<WorkspaceData>;
        createBackup: () => Promise<string | null>;
        recoverFromBackup: () => Promise<WorkspaceData | null>;
      };
      simulation: {
        createSession: (payload: SimulationSessionPayload) => Promise<SimulationSessionCreateResult>;
        listSessions: () => Promise<PersistedSessionMetadata[]>;
        reloadSessions: () => Promise<PersistedSessionMetadata[]>;
        validateSessionConfig: (payload: SimulationSessionPayload) => Promise<SimulationValidationResult>;
        estimateViability: (payload: SimulationSessionPayload) => Promise<RuntimeViabilityReport>;
        getDesktopAdapterDependencies: () => Promise<DesktopAdapterDependencyReport>;
        testGameProfile: (payload: GameProfileTestRequest) => Promise<GameProfileTestResult>;
        testDesktopControl: (payload: DesktopControlTestRequest) => Promise<DesktopControlTestResult>;
        startSession: (sessionId: string) => Promise<SimulationSessionStatusSnapshot>;
        stopSession: (sessionId: string) => Promise<SimulationSessionStatusSnapshot>;
        pauseSession: (sessionId: string) => Promise<SimulationSessionStatusSnapshot>;
        resumeSession: (sessionId: string) => Promise<SimulationSessionStatusSnapshot>;
        getSessionStatus: (sessionId?: string) => Promise<SimulationSessionStatusSnapshot>;
        getBotStatuses: (sessionId: string) => Promise<SimulationBotStatus[]>;
        getDirectiveState: (sessionId: string) => Promise<BotDirectiveManagerSnapshot>;
        getBotAvailableActions: (sessionId: string, botId: string) => Promise<AvailableGameActionLike[]>;
        guideBot: (payload: GuideBotDirectiveRequest) => Promise<LiveDirectiveMutationResult>;
        cancelBotDirective: (sessionId: string, botId: string, directiveId: string) => Promise<LiveDirectiveMutationResult>;
        confirmBotDirectiveSuccess: (sessionId: string, botId: string, directiveId: string) => Promise<LiveDirectiveMutationResult>;
        reorderBotDirectives: (payload: ReorderBotDirectivesRequest) => Promise<LiveDirectiveMutationResult>;
        getLiveObservationState: (sessionId: string) => Promise<LiveObservationState>;
        followBot: (sessionId: string, botId: string) => Promise<LiveObservationState>;
        stopFollowingBot: (sessionId: string) => Promise<LiveObservationState>;
        showAdjacentBot: (sessionId: string, direction: 'next' | 'previous') => Promise<LiveObservationState>;
        focusObservedGameWindow: (sessionId: string) => Promise<LiveObservationState>;
        stopBot: (sessionId: string, botId: string) => Promise<SimulationBotStatus[]>;
        stopBotPool: (sessionId: string, profileId: string) => Promise<SimulationBotStatus[]>;
        getInstanceStatuses: (sessionId: string) => Promise<GameInstanceStatus[]>;
        getIssues: (sessionId: string) => Promise<DetectedIssue[]>;
        getLogs: (sessionId: string) => Promise<LogEntry[]>;
        getCoverage: (sessionId: string) => Promise<ContentCoverageSummary>;
        getStructuredLogs: (sessionId: string) => Promise<StructuredLogReadResult>;
	        openEvidence: (sessionId: string, evidencePath: string) => Promise<OpenEvidenceResult>;
	        openReport: (sessionId: string) => Promise<OpenReportResult>;
	        openLogs: (sessionId: string) => Promise<OpenLogsResult>;
	        openSessionFolder: (sessionId: string) => Promise<OpenSessionPathResult>;
	        openIssueFolder: (sessionId: string) => Promise<OpenSessionPathResult>;
	        openScreenshotsFolder: (sessionId: string) => Promise<OpenSessionPathResult>;
	        cleanupSessionBundle: (payload: SessionCleanupOptions) => Promise<SessionCleanupResult>;
	        compareSessions: (oldSessionId: string, newSessionId: string) => Promise<ComparisonReportResult>;
        previewGitHubIssueExport: (payload: GitHubIssueExportRequest) => Promise<GitHubIssueExportPreviewResult>;
        exportGitHubIssueMarkdown: (payload: GitHubIssueExportRequest) => Promise<GitHubIssueMarkdownExportResult>;
        postGitHubIssues: (payload: GitHubIssuePostRequest) => Promise<GitHubIssuePostResult>;
      };
    };
  }
}
