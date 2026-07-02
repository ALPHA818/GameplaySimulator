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

export interface EngineWrapperAdapterOptions {
  id: string;
  name: string;
  adapterType: AdapterType;
  delegate: GameAdapter;
}

export abstract class EngineWrapperAdapter implements GameAdapter {
  readonly id: string;
  readonly name: string;
  readonly adapterType: AdapterType;
  readonly capabilities: AdapterCapabilities;
  protected readonly delegate: GameAdapter;

  protected constructor(options: EngineWrapperAdapterOptions) {
    this.id = options.id;
    this.name = options.name;
    this.adapterType = options.adapterType;
    this.delegate = options.delegate;
    this.capabilities = options.delegate.capabilities;
  }

  async launchInstance(config: GameInstanceConfig): Promise<GameAdapterInstance> {
    const instance = await this.delegate.launchInstance(config);

    return {
      ...instance,
      adapterId: this.id,
      metadata: {
        ...instance.metadata,
        engineAdapterId: this.id,
        delegateAdapterId: this.delegate.id
      }
    };
  }

  stopInstance(instanceId: string): Promise<void> {
    return this.delegate.stopInstance(instanceId);
  }

  stopAll(): Promise<void> {
    return this.delegate.stopAll();
  }

  getState(instanceId: string, botId: string): Promise<GameStateSnapshot | null> {
    return this.delegate.getState(instanceId, botId);
  }

  getAvailableActions(instanceId: string, botId: string): Promise<AvailableGameAction[]> {
    return this.delegate.getAvailableActions(instanceId, botId);
  }

  performAction(instanceId: string, botId: string, action: GameAction): Promise<ActionResult> {
    return this.delegate.performAction(instanceId, botId, action);
  }

  captureScreenshot(instanceId: string, botId: string): Promise<ScreenshotCapture> {
    if (!this.delegate.captureScreenshot) {
      throw new Error(`${this.name} delegate does not support screenshots.`);
    }

    return this.delegate.captureScreenshot(instanceId, botId);
  }

  startVideoCapture(instanceId: string, botId: string): Promise<VideoCaptureHandle> {
    if (!this.delegate.startVideoCapture) {
      throw new Error(`${this.name} delegate does not support video capture.`);
    }

    return this.delegate.startVideoCapture(instanceId, botId);
  }

  stopVideoCapture(instanceId: string, botId: string): Promise<VideoCaptureHandle> {
    if (!this.delegate.stopVideoCapture) {
      throw new Error(`${this.name} delegate does not support video capture.`);
    }

    return this.delegate.stopVideoCapture(instanceId, botId);
  }

  captureLogs(instanceId: string): Promise<LogEntry[]> {
    if (!this.delegate.captureLogs) {
      return Promise.resolve([]);
    }

    return this.delegate.captureLogs(instanceId);
  }

  isRunning(instanceId: string): Promise<boolean> {
    return this.delegate.isRunning(instanceId);
  }

  async getHealth(instanceId: string): Promise<AdapterHealth> {
    const health = await this.delegate.getHealth(instanceId);

    return {
      ...health,
      details: {
        ...health.details,
        engineAdapterId: this.id,
        delegateAdapterId: this.delegate.id
      }
    };
  }
}
