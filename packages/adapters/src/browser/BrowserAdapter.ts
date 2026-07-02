import { BaseGameAdapter } from '../base/BaseGameAdapter';
import type { AdapterCapabilities } from '../base/GameAdapter';

export interface BrowserAdapterOptions {
  id?: string;
  name?: string;
  browserName?: string;
  targetUrl?: string;
  capabilities?: Partial<AdapterCapabilities>;
}

export class BrowserAdapter extends BaseGameAdapter {
  readonly browserName?: string;
  readonly targetUrl?: string;

  constructor(options: BrowserAdapterOptions = {}) {
    super({
      id: options.id ?? 'browser',
      name: options.name ?? 'Browser Adapter',
      adapterType: 'browser',
      capabilities: {
        supportsMultipleInstances: true,
        supportsMultipleBotsPerInstance: true,
        supportsStateRead: false,
        supportsDirectActions: false,
        supportsInputSimulation: true,
        supportsScreenshots: true,
        supportsVideo: true,
        supportsGameLogs: true,
        supportsSaveIsolation: true,
        supportsReset: true,
        supportsCheckpointReload: false,
        ...options.capabilities
      }
    });

    this.browserName = options.browserName;
    this.targetUrl = options.targetUrl;
  }
}
