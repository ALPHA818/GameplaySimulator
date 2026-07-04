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
  ContentCoverageSummary,
  SimulationBotStatus,
  SimulationSessionCreateResult,
  SimulationSessionStatusSnapshot,
  StructuredLogReadResult,
  SimulationValidationResult
} from '../../main/services/simulationService';

interface SimulationSessionPayload {
  runConfig: SimulationRunConfig;
  gameProfile: GameProfile;
  botProfiles?: BotProfile[];
}

declare global {
  interface Window {
    gameplaySimulator: {
      app: {
        getVersion: () => Promise<string>;
      };
      sessions: {
        getStatus: () => Promise<SimulationSessionStatusSnapshot>;
      };
      resources: {
        estimateViability: (payload: SimulationSessionPayload) => Promise<RuntimeViabilityReport>;
      };
      simulation: {
        createSession: (payload: SimulationSessionPayload) => Promise<SimulationSessionCreateResult>;
        validateSessionConfig: (payload: SimulationSessionPayload) => Promise<SimulationValidationResult>;
        estimateViability: (payload: SimulationSessionPayload) => Promise<RuntimeViabilityReport>;
        startSession: (sessionId: string) => Promise<SimulationSessionStatusSnapshot>;
        stopSession: (sessionId: string) => Promise<SimulationSessionStatusSnapshot>;
        pauseSession: (sessionId: string) => Promise<SimulationSessionStatusSnapshot>;
        resumeSession: (sessionId: string) => Promise<SimulationSessionStatusSnapshot>;
        getSessionStatus: (sessionId?: string) => Promise<SimulationSessionStatusSnapshot>;
        getBotStatuses: (sessionId: string) => Promise<SimulationBotStatus[]>;
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
        compareSessions: (oldSessionId: string, newSessionId: string) => Promise<ComparisonReportResult>;
      };
    };
  }
}
