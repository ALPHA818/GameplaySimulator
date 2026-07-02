import type {
  ActionResult,
  AdapterType,
  GameAction,
  GameInstanceConfig,
  GameStateSnapshot
} from '@core/types';
import type { LogEntry } from '@core/logging/LogEntry';

export interface AdapterCapabilities {
  supportsMultipleInstances: boolean;
  supportsMultipleBotsPerInstance: boolean;
  supportsStateRead: boolean;
  supportsDirectActions: boolean;
  supportsInputSimulation: boolean;
  supportsScreenshots: boolean;
  supportsVideo: boolean;
  supportsGameLogs: boolean;
  supportsSaveIsolation: boolean;
  supportsReset: boolean;
  supportsCheckpointReload: boolean;
}

export interface GameAdapterInstance {
  instanceId: string;
  adapterId: string;
  gameProfileId: string;
  launchConfig: GameInstanceConfig;
  startedAt: string;
  metadata: Record<string, unknown>;
}

export interface AvailableGameAction {
  actionType: string;
  label: string;
  description?: string;
  requiresStateRead?: boolean;
  requiresDirectAction?: boolean;
  requiresInputSimulation?: boolean;
  payloadSchema?: Record<string, unknown>;
}

export interface ScreenshotCapture {
  instanceId: string;
  botId: string;
  capturedAt: string;
  path?: string;
  mimeType?: string;
  data?: Uint8Array;
}

export interface VideoCaptureHandle {
  instanceId: string;
  botId: string;
  startedAt?: string;
  stoppedAt?: string;
  path?: string;
}

export type AdapterHealthStatus = 'idle' | 'ready' | 'running' | 'degraded' | 'failed' | 'stopped';

export interface AdapterHealth {
  instanceId: string;
  status: AdapterHealthStatus;
  checkedAt: string;
  message?: string;
  details: Record<string, unknown>;
}

export interface GameAdapter {
  id: string;
  name: string;
  adapterType: AdapterType;
  capabilities: AdapterCapabilities;
  launchInstance(config: GameInstanceConfig): Promise<GameAdapterInstance>;
  stopInstance(instanceId: string): Promise<void>;
  stopAll(): Promise<void>;
  getState(instanceId: string, botId: string): Promise<GameStateSnapshot | null>;
  getAvailableActions(instanceId: string, botId: string): Promise<AvailableGameAction[]>;
  performAction(instanceId: string, botId: string, action: GameAction): Promise<ActionResult>;
  captureScreenshot?(instanceId: string, botId: string): Promise<ScreenshotCapture>;
  startVideoCapture?(instanceId: string, botId: string): Promise<VideoCaptureHandle>;
  stopVideoCapture?(instanceId: string, botId: string): Promise<VideoCaptureHandle>;
  captureLogs?(instanceId: string): Promise<LogEntry[]>;
  isRunning(instanceId: string): Promise<boolean>;
  getHealth(instanceId: string): Promise<AdapterHealth>;
}
