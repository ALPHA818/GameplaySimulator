import { BaseGameAdapter } from '../base/BaseGameAdapter';
import type {
  AdapterCapabilities,
  AdapterHealth,
  ObservationCapability,
  WindowFocusResult
} from '../base/GameAdapter';

export interface CustomAdapterOptions {
  id?: string;
  name?: string;
  protocolName?: string;
  capabilities?: Partial<AdapterCapabilities>;
  observationCapability?: ObservationCapability;
  windowFocusHandler?: (instanceId: string) => Promise<WindowFocusResult>;
}

export class CustomAdapter extends BaseGameAdapter {
  readonly protocolName?: string;
  readonly observationCapability: ObservationCapability;
  private readonly windowFocusHandler?: (instanceId: string) => Promise<WindowFocusResult>;

  constructor(options: CustomAdapterOptions = {}) {
    const observationCapability =
      options.observationCapability ?? options.capabilities?.observationCapability ?? 'unavailable';
    super({
      id: options.id ?? 'custom',
      name: options.name ?? 'Custom Adapter',
      adapterType: 'custom',
      capabilities: {
        supportsMultipleInstances: false,
        supportsMultipleBotsPerInstance: false,
        supportsStateRead: false,
        supportsDirectActions: false,
        supportsInputSimulation: false,
        supportsScreenshots: false,
        supportsVideo: false,
        supportsGameLogs: false,
        supportsSaveIsolation: false,
        supportsReset: false,
        supportsCheckpointReload: false,
        supportsLiveObservation: observationCapability !== 'unavailable',
        supportsWindowFocus: Boolean(options.windowFocusHandler),
        supportsMultipleVisibleWindows: false,
        observationCapability,
        ...options.capabilities
      }
    });

    this.protocolName = options.protocolName;
    this.observationCapability = observationCapability;
    this.windowFocusHandler = options.windowFocusHandler;
  }

  async focusWindow(instanceId: string): Promise<WindowFocusResult> {
    if (this.windowFocusHandler) {
      return this.windowFocusHandler(instanceId);
    }

    return {
      instanceId,
      supported: false,
      visible: this.capabilities.supportsLiveObservation,
      focused: false,
      message: this.capabilities.supportsLiveObservation
        ? 'This custom adapter exposes a game window, but window focus is not supported by this adapter.'
        : 'The test is running, but only logs and screenshots can be viewed.'
    };
  }

  openOrFocusGameWindow(instanceId: string): Promise<WindowFocusResult> {
    return this.focusWindow(instanceId);
  }

  override async getHealth(instanceId: string): Promise<AdapterHealth> {
    const health = await super.getHealth(instanceId);

    return {
      ...health,
      details: {
        ...health.details,
        observationCapability: this.observationCapability,
        observationMessage: this.capabilities.supportsLiveObservation
          ? 'This custom adapter exposes a game window.'
          : 'The test is running, but only logs and screenshots can be viewed.'
      }
    };
  }
}
