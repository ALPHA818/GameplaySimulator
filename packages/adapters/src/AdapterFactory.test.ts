import type { GameInstanceConfig } from '@core/types';
import { describe, expect, it } from 'vitest';
import { AdapterFactory } from './AdapterFactory';
import { BrowserAdapter } from './browser/BrowserAdapter';
import { DesktopWindowAdapter } from './desktop/DesktopWindowAdapter';
import { GodotAdapter } from './godot/GodotAdapter';
import { InstrumentedAdapter } from './instrumented/InstrumentedAdapter';
import { UnityAdapter } from './unity/UnityAdapter';
import { UnrealAdapter } from './unreal/UnrealAdapter';
import { CustomAdapter } from './custom/CustomAdapter';

const instanceConfig: GameInstanceConfig = {
  instanceId: 'game-instance-001',
  gameProfileId: 'sample-game',
  launch: {
    executablePath: process.execPath,
    arguments: ['-e', 'setInterval(() => {}, 1000)'],
    platform: 'linux',
  },
  maxBots: 2,
  environment: {}
};

describe('AdapterFactory', () => {
  it('creates adapters by type without treating browser as the default adapter', () => {
    expect(AdapterFactory.createAdapter('instrumented')).toBeInstanceOf(InstrumentedAdapter);
    expect(AdapterFactory.createAdapter('desktop')).toBeInstanceOf(DesktopWindowAdapter);
    expect(AdapterFactory.createAdapter('browser')).toBeInstanceOf(BrowserAdapter);
  });

  it('creates engine adapters as wrappers', () => {
    expect(AdapterFactory.createAdapter('unity')).toBeInstanceOf(UnityAdapter);
    expect(AdapterFactory.createAdapter('godot')).toBeInstanceOf(GodotAdapter);
    expect(AdapterFactory.createAdapter('unreal')).toBeInstanceOf(UnrealAdapter);
  });

  it('inherits desktop observation support through engine fallback wrappers', () => {
    const adapter = AdapterFactory.createAdapter('godot');

    expect(adapter.capabilities).toMatchObject({
      supportsLiveObservation: true,
      supportsWindowFocus: true,
      observationCapability: 'visible-window'
    });
    expect(adapter.focusWindow).toBeTypeOf('function');
  });

  it('requires custom adapters to advertise their observation capability explicitly', () => {
    const unavailable = new CustomAdapter();
    const preview = new CustomAdapter({ observationCapability: 'embedded-preview' });

    expect(unavailable.capabilities.supportsLiveObservation).toBe(false);
    expect(unavailable.capabilities.observationCapability).toBe('unavailable');
    expect(preview.capabilities).toMatchObject({
      supportsLiveObservation: true,
      observationCapability: 'embedded-preview'
    });
  });

  it('uses instrumented capabilities for engine adapters when an instrumentation endpoint is provided', () => {
    const adapter = AdapterFactory.createAdapter('unity', {
      unity: {
        instrumentationEndpoint: 'http://127.0.0.1:4555'
      }
    });

    expect(adapter.adapterType).toBe('unity');
    expect(adapter.capabilities.supportsStateRead).toBe(true);
    expect(adapter.capabilities.supportsDirectActions).toBe(true);
  });

  it('tracks placeholder lifecycle through the generic interface', async () => {
    const adapter = AdapterFactory.createAdapter('godot');
    const instance = await adapter.launchInstance(instanceConfig);

    expect(instance.adapterId).toBe('godot');
    expect(await adapter.isRunning(instance.instanceId)).toBe(true);
    expect((await adapter.getHealth(instance.instanceId)).status).toBe('running');

    await adapter.stopInstance(instance.instanceId);

    expect(await adapter.isRunning(instance.instanceId)).toBe(false);
  });
});
