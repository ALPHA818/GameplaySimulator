import { BaseGameAdapter } from '../base/BaseGameAdapter';
import type { AdapterCapabilities } from '../base/GameAdapter';

export interface CustomAdapterOptions {
  id?: string;
  name?: string;
  protocolName?: string;
  capabilities?: Partial<AdapterCapabilities>;
}

export class CustomAdapter extends BaseGameAdapter {
  readonly protocolName?: string;

  constructor(options: CustomAdapterOptions = {}) {
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
        ...options.capabilities
      }
    });

    this.protocolName = options.protocolName;
  }
}
