import type { DetectedIssue, GameInstanceStatus } from '@core/types';
import type { LogEntry } from '@core/logging/LogEntry';
import type {
  ContentCoverageSummary,
  LiveObservationState,
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
  liveObservation: LiveObservationState | null;
  reviewSessionId: string | null;
  reviewIssueId: string | null;
  reviewedIssueIds: string[];
  falsePositiveIssueIds: string[];
  setSessionPreview: (label: string) => void;
  setReviewSessionId: (sessionId: string | null) => void;
  setReviewIssueId: (issueId: string | null) => void;
  applySessionSnapshot: (snapshot: SimulationSessionStatusSnapshot) => void;
  applyRuntimeDetails: (details: {
    botStatuses?: SimulationBotStatus[];
    instanceStatuses?: GameInstanceStatus[];
    issues?: DetectedIssue[];
    logs?: LogEntry[];
    coverage?: ContentCoverageSummary;
    liveObservation?: LiveObservationState;
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
  liveObservation: null,
  reviewSessionId: null,
  reviewIssueId: null,
  reviewedIssueIds: [],
  falsePositiveIssueIds: [],
  setSessionPreview: (statusLabel) => set({ statusLabel }),
  setReviewSessionId: (reviewSessionId) => set({ reviewSessionId }),
  setReviewIssueId: (reviewIssueId) => set({ reviewIssueId }),
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
      coverage: details.coverage ?? state.coverage,
      liveObservation: details.liveObservation ?? state.liveObservation
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
