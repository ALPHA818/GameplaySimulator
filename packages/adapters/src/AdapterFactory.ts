import type { AdapterType } from '@core/types';
import { BrowserAdapter, type BrowserAdapterOptions } from './browser/BrowserAdapter';
import { CustomAdapter, type CustomAdapterOptions } from './custom/CustomAdapter';
import {
  DesktopWindowAdapter,
  type DesktopWindowAdapterOptions
} from './desktop/DesktopWindowAdapter';
import { GodotAdapter, type GodotAdapterOptions } from './godot/GodotAdapter';
import type { GameAdapter } from './base/GameAdapter';
import {
  InstrumentedAdapter,
  type InstrumentedAdapterOptions
} from './instrumented/InstrumentedAdapter';
import { UnityAdapter, type UnityAdapterOptions } from './unity/UnityAdapter';
import { UnrealAdapter, type UnrealAdapterOptions } from './unreal/UnrealAdapter';

export interface AdapterFactoryOptions {
  browser?: BrowserAdapterOptions;
  custom?: CustomAdapterOptions;
  desktop?: DesktopWindowAdapterOptions;
  godot?: GodotAdapterOptions;
  instrumented?: InstrumentedAdapterOptions;
  unity?: UnityAdapterOptions;
  unreal?: UnrealAdapterOptions;
}

export class AdapterFactory {
  createAdapter(adapterType: AdapterType, options: AdapterFactoryOptions = {}): GameAdapter {
    switch (adapterType) {
      case 'instrumented':
        return new InstrumentedAdapter(options.instrumented);
      case 'desktop':
        return new DesktopWindowAdapter(options.desktop);
      case 'browser':
        return new BrowserAdapter(options.browser);
      case 'unity':
        return new UnityAdapter(options.unity);
      case 'godot':
        return new GodotAdapter(options.godot);
      case 'unreal':
        return new UnrealAdapter(options.unreal);
      case 'rpg_maker':
        return new DesktopWindowAdapter({
          id: 'rpg-maker-desktop-window',
          name: 'RPG Maker Desktop Window Adapter',
          adapterType: 'rpg_maker',
          ...options.desktop
        });
      case 'gamemaker':
        return new DesktopWindowAdapter({
          id: 'gamemaker-desktop-window',
          name: 'GameMaker Desktop Window Adapter',
          adapterType: 'gamemaker',
          ...options.desktop
        });
      case 'custom':
        return new CustomAdapter(options.custom);
      default: {
        const exhaustive: never = adapterType;
        throw new Error(`Unsupported adapter type: ${exhaustive}`);
      }
    }
  }

  static createAdapter(adapterType: AdapterType, options: AdapterFactoryOptions = {}): GameAdapter {
    return new AdapterFactory().createAdapter(adapterType, options);
  }
}
