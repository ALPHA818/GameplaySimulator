import { DesktopWindowAdapter } from '../desktop/DesktopWindowAdapter';
import { EngineWrapperAdapter } from '../base/EngineWrapperAdapter';
import type { GameAdapter } from '../base/GameAdapter';
import { InstrumentedAdapter } from '../instrumented/InstrumentedAdapter';

export interface GodotAdapterOptions {
  id?: string;
  name?: string;
  godotVersion?: string;
  instrumentationEndpoint?: string;
  delegate?: GameAdapter;
}

export class GodotAdapter extends EngineWrapperAdapter {
  readonly godotVersion?: string;

  constructor(options: GodotAdapterOptions = {}) {
    const delegate =
      options.delegate ??
      (options.instrumentationEndpoint
        ? new InstrumentedAdapter({
            id: 'godot-instrumented',
            name: 'Godot Instrumented Adapter',
            instrumentationEndpoint: options.instrumentationEndpoint
          })
        : new DesktopWindowAdapter({
            id: 'godot-desktop-window',
            name: 'Godot Desktop Window Adapter',
            adapterType: 'godot'
          }));

    super({
      id: options.id ?? 'godot',
      name: options.name ?? 'Godot Adapter',
      adapterType: 'godot',
      delegate
    });

    this.godotVersion = options.godotVersion;
  }
}
