import { DesktopWindowAdapter, type DesktopWindowAdapterOptions } from '../desktop/DesktopWindowAdapter';
import { EngineWrapperAdapter } from '../base/EngineWrapperAdapter';
import type { GameAdapter } from '../base/GameAdapter';
import { InstrumentedAdapter, type InstrumentedAdapterOptions } from '../instrumented/InstrumentedAdapter';

export interface UnityAdapterOptions {
  id?: string;
  name?: string;
  unityVersion?: string;
  instrumentationEndpoint?: string;
  delegate?: GameAdapter;
  desktopOptions?: DesktopWindowAdapterOptions;
  instrumentedOptions?: InstrumentedAdapterOptions;
}

export class UnityAdapter extends EngineWrapperAdapter {
  readonly unityVersion?: string;

  constructor(options: UnityAdapterOptions = {}) {
    const delegate =
      options.delegate ??
      (options.instrumentationEndpoint
        ? new InstrumentedAdapter({
            id: 'unity-instrumented',
            name: 'Unity Instrumented Adapter',
            ...options.instrumentedOptions,
            instrumentationEndpoint: options.instrumentationEndpoint
          })
        : new DesktopWindowAdapter({
            id: 'unity-desktop-window',
            name: 'Unity Desktop Window Adapter',
            adapterType: 'unity',
            ...options.desktopOptions
          }));

    super({
      id: options.id ?? 'unity',
      name: options.name ?? 'Unity Adapter',
      adapterType: 'unity',
      delegate
    });

    this.unityVersion = options.unityVersion;
  }
}
