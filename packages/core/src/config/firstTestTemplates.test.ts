import { describe, expect, it } from 'vitest';
import { GameProfileSchema } from '../types/gameProfile';
import {
  firstTestProfileKind,
  firstTestTemplates,
  isFirstTestTemplateCompatible,
  recommendedFirstTestTemplate
} from './firstTestTemplates';

function profile(input: {
  adapterType: 'browser' | 'desktop' | 'instrumented' | 'unity' | 'godot' | 'unreal';
  engineType: 'browser' | 'custom' | 'godot' | 'unity' | 'unknown' | 'unreal';
  endpoint?: string;
}) {
  return GameProfileSchema.parse({
    gameId: `${input.engineType}-${input.adapterType}`,
    gameName: 'Template Test Game',
    version: '1.0.0',
    engine: { type: input.engineType },
    launch: {
      executablePath: input.adapterType === 'browser' || input.adapterType === 'instrumented' ? undefined : '/games/test-game',
      url: input.adapterType === 'browser' ? 'http://127.0.0.1:4173' : undefined,
      platform: input.adapterType === 'browser' ? 'browser' : 'linux'
    },
    adapter: {
      type: input.adapterType,
      supportsMultipleInstances: false,
      supportsStateRead: Boolean(input.endpoint),
      supportsDirectActions: Boolean(input.endpoint),
      supportsScreenshots: true,
      supportsVideo: false,
      supportsSaveIsolation: false,
      instrumentationEndpoint: input.endpoint
    },
    controls: [],
    testingTargets: [],
    progressSignals: [],
    failureSignals: [],
    uiFlows: [],
    knownContent: {}
  });
}

describe('first test templates', () => {
  it('provides all ten beginner templates with hard first-run limits', () => {
    expect(firstTestTemplates).toHaveLength(10);
    expect(new Set(firstTestTemplates.map((template) => template.id)).size).toBe(10);

    for (const template of firstTestTemplates) {
      expect(template.actionCount).toBeLessThanOrEqual(20);
      expect(template.actionDelayMs).toBeGreaterThanOrEqual(500);
      expect(template.actionDelayMs).toBeLessThanOrEqual(750);
      expect(template.whatItDoes.length).toBeGreaterThan(20);
      expect(template.whenToUse.length).toBeGreaterThan(20);
      expect(template.limitations.length).toBeGreaterThan(20);
      expect(template.expectedResult.length).toBeGreaterThan(20);
      expect(template.beginnerRecommendation.length).toBeGreaterThan(20);
      expect(template.observationPreference).not.toBe('background');
    }

    expect(firstTestTemplates.find((template) => template.id === 'browser-smoke-test')?.observationPreference).toBe('visible');
    expect(firstTestTemplates.find((template) => template.id === 'desktop-smoke-test')?.observationPreference).toBe('visible');
    expect(firstTestTemplates.find((template) => template.id === 'unity-instrumented-smoke-test')?.observationPreference).toBe('visible-if-supported');
  });

  it('distinguishes instrumented engine profiles from desktop fallbacks', () => {
    const unityInstrumented = profile({
      adapterType: 'unity',
      engineType: 'unity',
      endpoint: 'http://127.0.0.1:4555'
    });
    const unityFallback = profile({ adapterType: 'unity', engineType: 'unity' });

    expect(firstTestProfileKind(unityInstrumented)).toBe('unity-instrumented');
    expect(firstTestProfileKind(unityFallback)).toBe('unity-desktop-fallback');
    expect(recommendedFirstTestTemplate(unityInstrumented)?.id).toBe('unity-instrumented-smoke-test');
    expect(recommendedFirstTestTemplate(unityFallback)?.id).toBe('unity-desktop-fallback-smoke-test');
  });

  it('recommends only the matching profile template', () => {
    const browserProfile = profile({ adapterType: 'browser', engineType: 'browser' });
    const recommended = recommendedFirstTestTemplate(browserProfile);

    expect(recommended?.id).toBe('browser-smoke-test');
    expect(recommended && isFirstTestTemplateCompatible(recommended, browserProfile)).toBe(true);
    expect(
      isFirstTestTemplateCompatible(
        firstTestTemplates.find((template) => template.id === 'desktop-smoke-test')!,
        browserProfile
      )
    ).toBe(false);
  });

  it('recognizes custom engine instrumented and fallback profiles', () => {
    expect(
      firstTestProfileKind(
        profile({
          adapterType: 'instrumented',
          engineType: 'custom',
          endpoint: 'http://127.0.0.1:4555'
        })
      )
    ).toBe('custom-instrumented');
    expect(firstTestProfileKind(profile({ adapterType: 'desktop', engineType: 'custom' }))).toBe(
      'custom-desktop-fallback'
    );
  });
});
