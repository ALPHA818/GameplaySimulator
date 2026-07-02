import { DesktopWindowAdapter } from '../desktop/DesktopWindowAdapter';
import { EngineWrapperAdapter } from '../base/EngineWrapperAdapter';
import type { GameAdapter } from '../base/GameAdapter';
import { InstrumentedAdapter } from '../instrumented/InstrumentedAdapter';

export interface UnrealAdapterOptions {
  id?: string;
  name?: string;
  unrealVersion?: string;
  instrumentationEndpoint?: string;
  delegate?: GameAdapter;
}

export class UnrealAdapter extends EngineWrapperAdapter {
  readonly unrealVersion?: string;

  constructor(options: UnrealAdapterOptions = {}) {
    const delegate =
      options.delegate ??
      (options.instrumentationEndpoint
        ? new InstrumentedAdapter({
            id: 'unreal-instrumented',
            name: 'Unreal Instrumented Adapter',
            instrumentationEndpoint: options.instrumentationEndpoint
          })
        : new DesktopWindowAdapter({
            id: 'unreal-desktop-window',
            name: 'Unreal Desktop Window Adapter',
            adapterType: 'unreal'
          }));

    super({
      id: options.id ?? 'unreal',
      name: options.name ?? 'Unreal Adapter',
      adapterType: 'unreal',
      delegate
    });

    this.unrealVersion = options.unrealVersion;
  }
}
