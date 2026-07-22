import { DesktopWindowAdapter, type DesktopWindowAdapterOptions } from '../desktop/DesktopWindowAdapter';
import { EngineWrapperAdapter } from '../base/EngineWrapperAdapter';
import type { GameAdapter } from '../base/GameAdapter';
import { InstrumentedAdapter, type InstrumentedAdapterOptions } from '../instrumented/InstrumentedAdapter';

export interface UnrealAdapterOptions {
  id?: string;
  name?: string;
  unrealVersion?: string;
  instrumentationEndpoint?: string;
  delegate?: GameAdapter;
  desktopOptions?: DesktopWindowAdapterOptions;
  instrumentedOptions?: InstrumentedAdapterOptions;
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
            ...options.instrumentedOptions,
            instrumentationEndpoint: options.instrumentationEndpoint
          })
        : new DesktopWindowAdapter({
            id: 'unreal-desktop-window',
            name: 'Unreal Desktop Window Adapter',
            adapterType: 'unreal',
            ...options.desktopOptions
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
