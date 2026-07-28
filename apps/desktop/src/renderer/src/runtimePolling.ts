import type { DetectedIssue, GameInstanceStatus } from '@core/types';
import type { LogEntry } from '@core/logging/LogEntry';
import type {
  ContentCoverageSummary,
  LiveObservationState,
  SimulationBotStatus
} from '../../main/services/simulationService';

export interface RuntimePollingApi {
  getBotStatuses(sessionId: string): Promise<SimulationBotStatus[]>;
  getInstanceStatuses(sessionId: string): Promise<GameInstanceStatus[]>;
  getIssues(sessionId: string): Promise<DetectedIssue[]>;
  getLogs(sessionId: string): Promise<LogEntry[]>;
  getCoverage(sessionId: string): Promise<ContentCoverageSummary>;
  getLiveObservationState(sessionId: string): Promise<LiveObservationState>;
}

export interface RuntimePollingDetails {
  botStatuses?: SimulationBotStatus[];
  instanceStatuses?: GameInstanceStatus[];
  issues?: DetectedIssue[];
  logs?: LogEntry[];
  coverage?: ContentCoverageSummary;
  liveObservation?: LiveObservationState;
}

export interface RuntimePollingResult {
  details: RuntimePollingDetails;
  warnings: string[];
}

export function readableError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim() || 'The application could not complete this request.';
}

export async function pollRuntimeDetails(
  api: RuntimePollingApi,
  sessionId: string
): Promise<RuntimePollingResult> {
  const requests = [
    ['Bot statuses', 'botStatuses', api.getBotStatuses(sessionId)],
    ['Game instances', 'instanceStatuses', api.getInstanceStatuses(sessionId)],
    ['Issues', 'issues', api.getIssues(sessionId)],
    ['Logs', 'logs', api.getLogs(sessionId)],
    ['Coverage', 'coverage', api.getCoverage(sessionId)],
    ['Observation', 'liveObservation', api.getLiveObservationState(sessionId)]
  ] as const;
  const settled = await Promise.allSettled(requests.map((request) => request[2]));
  const details: RuntimePollingDetails = {};
  const warnings: string[] = [];

  settled.forEach((result, index) => {
    const [label, key] = requests[index];

    if (result.status === 'fulfilled') {
      Object.assign(details, { [key]: result.value });
    } else {
      warnings.push(`${label}: ${readableError(result.reason)}`);
    }
  });

  return { details, warnings };
}
