import type {
  ActionResult,
  AdapterType,
  GameAction,
  GameInstanceConfig,
  GameStateSnapshot
} from '@core/types';
import type { LogEntry } from '@core/logging/LogEntry';
import type {
  AdapterCapabilities,
  AdapterHealth,
  AvailableGameAction,
  GameAdapter,
  GameAdapterInstance,
  ScreenshotCapture,
  VideoCaptureHandle
} from './GameAdapter';

export interface BaseGameAdapterOptions {
  id: string;
  name: string;
  adapterType: AdapterType;
  capabilities: AdapterCapabilities;
}

interface TrackedInstance {
  instance: GameAdapterInstance;
  running: boolean;
  stoppedAt?: string;
}

export abstract class BaseGameAdapter implements GameAdapter {
  readonly id: string;
  readonly name: string;
  readonly adapterType: AdapterType;
  readonly capabilities: AdapterCapabilities;
  protected readonly instances = new Map<string, TrackedInstance>();

  protected constructor(options: BaseGameAdapterOptions) {
    this.id = options.id;
    this.name = options.name;
    this.adapterType = options.adapterType;
    this.capabilities = options.capabilities;
  }

  async launchInstance(config: GameInstanceConfig): Promise<GameAdapterInstance> {
    const instance: GameAdapterInstance = {
      instanceId: config.instanceId,
      adapterId: this.id,
      gameProfileId: config.gameProfileId,
      launchConfig: config,
      startedAt: new Date().toISOString(),
      metadata: {
        placeholder: true,
        adapterType: this.adapterType
      }
    };

    this.instances.set(config.instanceId, { instance, running: true });
    return instance;
  }

  async stopInstance(instanceId: string): Promise<void> {
    const tracked = this.instances.get(instanceId);

    if (tracked) {
      tracked.running = false;
      tracked.stoppedAt = new Date().toISOString();
    }
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.instances.keys()].map((instanceId) => this.stopInstance(instanceId)));
  }

  async getState(instanceId: string, botId: string): Promise<GameStateSnapshot | null> {
    if (!this.capabilities.supportsStateRead || !(await this.isRunning(instanceId))) {
      return null;
    }

    const tracked = this.instances.get(instanceId);

    return {
      snapshotId: `${instanceId}-${botId}-${Date.now()}`,
      sessionId: 'placeholder-session',
      gameId: tracked?.instance.gameProfileId ?? 'unknown-game',
      gameInstanceId: instanceId,
      botId,
      capturedAt: new Date().toISOString(),
      state: {
        adapterId: this.id,
        placeholder: true
      },
      metrics: {}
    };
  }

  async getAvailableActions(_instanceId: string, _botId: string): Promise<AvailableGameAction[]> {
    const actions: AvailableGameAction[] = [];

    if (this.capabilities.supportsDirectActions) {
      actions.push({
        actionType: 'direct-command',
        label: 'Direct Command',
        requiresDirectAction: true
      });
    }

    if (this.capabilities.supportsInputSimulation) {
      actions.push({
        actionType: 'input',
        label: 'Input Simulation',
        requiresInputSimulation: true
      });
    }

    return actions;
  }

  async performAction(instanceId: string, botId: string, action: GameAction): Promise<ActionResult> {
    const running = await this.isRunning(instanceId);
    const canAct = this.capabilities.supportsDirectActions || this.capabilities.supportsInputSimulation;
    const completedAt = new Date().toISOString();

    return {
      actionId: action.actionId,
      botId,
      status: running && canAct ? 'skipped' : 'failed',
      startedAt: action.requestedAt,
      completedAt,
      durationMs: 0,
      message:
        running && canAct
          ? 'Placeholder adapter accepted the action but did not execute real game input.'
          : 'Adapter cannot perform actions for this instance.',
      issueIds: []
    };
  }

  async captureScreenshot(instanceId: string, botId: string): Promise<ScreenshotCapture> {
    if (!this.capabilities.supportsScreenshots) {
      throw new Error(`${this.name} does not support screenshots.`);
    }

    return {
      instanceId,
      botId,
      capturedAt: new Date().toISOString(),
      mimeType: 'image/png'
    };
  }

  async startVideoCapture(instanceId: string, botId: string): Promise<VideoCaptureHandle> {
    if (!this.capabilities.supportsVideo) {
      throw new Error(`${this.name} does not support video capture.`);
    }

    return {
      instanceId,
      botId,
      startedAt: new Date().toISOString()
    };
  }

  async stopVideoCapture(instanceId: string, botId: string): Promise<VideoCaptureHandle> {
    if (!this.capabilities.supportsVideo) {
      throw new Error(`${this.name} does not support video capture.`);
    }

    return {
      instanceId,
      botId,
      stoppedAt: new Date().toISOString()
    };
  }

  async captureLogs(instanceId: string): Promise<LogEntry[]> {
    if (!this.capabilities.supportsGameLogs) {
      return [];
    }

    return [
      {
        id: `${instanceId}-placeholder-log`,
        level: 'info',
        message: `${this.name} placeholder log capture.`,
        timestamp: new Date().toISOString(),
        source: this.id
      }
    ];
  }

  async isRunning(instanceId: string): Promise<boolean> {
    return this.instances.get(instanceId)?.running ?? false;
  }

  async getHealth(instanceId: string): Promise<AdapterHealth> {
    const tracked = this.instances.get(instanceId);

    if (!tracked) {
      return {
        instanceId,
        status: 'idle',
        checkedAt: new Date().toISOString(),
        message: 'Instance has not been launched by this adapter.',
        details: {
          adapterId: this.id,
          adapterType: this.adapterType
        }
      };
    }

    return {
      instanceId,
      status: tracked.running ? 'running' : 'stopped',
      checkedAt: new Date().toISOString(),
      message: tracked.running ? 'Placeholder instance is marked running.' : 'Instance is stopped.',
      details: {
        adapterId: this.id,
        adapterType: this.adapterType,
        stoppedAt: tracked.stoppedAt
      }
    };
  }
}
