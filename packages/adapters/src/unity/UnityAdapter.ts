import { DesktopWindowAdapter } from '../desktop/DesktopWindowAdapter';
import { EngineWrapperAdapter } from '../base/EngineWrapperAdapter';
import type { GameAdapter } from '../base/GameAdapter';
import { InstrumentedAdapter } from '../instrumented/InstrumentedAdapter';

export interface UnityAdapterOptions {
  id?: string;
  name?: string;
  unityVersion?: string;
  instrumentationEndpoint?: string;
  delegate?: GameAdapter;
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
            instrumentationEndpoint: options.instrumentationEndpoint
          })
        : new DesktopWindowAdapter({
            id: 'unity-desktop-window',
            name: 'Unity Desktop Window Adapter',
            adapterType: 'unity'
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
