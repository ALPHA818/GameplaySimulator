import type { DetectedIssue, GameInstanceStatus } from '@core/types';
import type { LogEntry } from '@core/logging/LogEntry';
import type {
  ContentCoverageSummary,
  SimulationBotStatus,
  SimulationSessionStatusSnapshot
} from '../../../main/services/simulationService';
import { create } from 'zustand';

type SessionRuntimeStatus =
  | 'idle'
  | 'created'
  | 'starting'
  | 'running'
  | 'paused'
  | 'stopping'
  | 'stopped'
  | 'failed';

interface SessionState {
  status: SessionRuntimeStatus;
  statusLabel: string;
  activeSessionId: string | null;
  lastSnapshot: SimulationSessionStatusSnapshot | null;
  botStatuses: SimulationBotStatus[];
  instanceStatuses: GameInstanceStatus[];
  issues: DetectedIssue[];
  logs: LogEntry[];
  coverage: ContentCoverageSummary | null;
  reviewSessionId: string | null;
  reviewedIssueIds: string[];
  falsePositiveIssueIds: string[];
  setSessionPreview: (label: string) => void;
  setReviewSessionId: (sessionId: string | null) => void;
  applySessionSnapshot: (snapshot: SimulationSessionStatusSnapshot) => void;
  applyRuntimeDetails: (details: {
    botStatuses?: SimulationBotStatus[];
    instanceStatuses?: GameInstanceStatus[];
    issues?: DetectedIssue[];
    logs?: LogEntry[];
    coverage?: ContentCoverageSummary;
  }) => void;
  markIssueReviewed: (issueId: string) => void;
  markIssueFalsePositive: (issueId: string) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  status: 'idle',
  statusLabel: 'No session running',
  activeSessionId: null,
  lastSnapshot: null,
  botStatuses: [],
  instanceStatuses: [],
  issues: [],
  logs: [],
  coverage: null,
  reviewSessionId: null,
  reviewedIssueIds: [],
  falsePositiveIssueIds: [],
  setSessionPreview: (statusLabel) => set({ statusLabel }),
  setReviewSessionId: (reviewSessionId) => set({ reviewSessionId }),
  applySessionSnapshot: (snapshot) =>
    set({
      status: snapshot.status,
      statusLabel: snapshot.label,
      activeSessionId: snapshot.activeSessionId,
      lastSnapshot: snapshot
    }),
  applyRuntimeDetails: (details) =>
    set((state) => ({
      botStatuses: details.botStatuses ?? state.botStatuses,
      instanceStatuses: details.instanceStatuses ?? state.instanceStatuses,
      issues: details.issues ?? state.issues,
      logs: details.logs ?? state.logs,
      coverage: details.coverage ?? state.coverage
    })),
  markIssueReviewed: (issueId) =>
    set((state) => ({
      reviewedIssueIds: state.reviewedIssueIds.includes(issueId)
        ? state.reviewedIssueIds
        : [...state.reviewedIssueIds, issueId]
    })),
  markIssueFalsePositive: (issueId) =>
    set((state) => ({
      falsePositiveIssueIds: state.falsePositiveIssueIds.includes(issueId)
        ? state.falsePositiveIssueIds
        : [...state.falsePositiveIssueIds, issueId],
      reviewedIssueIds: state.reviewedIssueIds.includes(issueId)
        ? state.reviewedIssueIds
        : [...state.reviewedIssueIds, issueId]
    }))
}));
