import { z } from 'zod';
import type { GameProfile } from '../types/gameProfile';
import { ResourceWeightSchema } from '../types/bot';

export const FirstTestProfileKindSchema = z.enum([
  'browser',
  'desktop',
  'unity-instrumented',
  'unity-desktop-fallback',
  'godot-instrumented',
  'godot-desktop-fallback',
  'unreal-instrumented',
  'unreal-desktop-fallback',
  'custom-instrumented',
  'custom-desktop-fallback'
]);

export const FirstTestTemplateIdSchema = z.enum([
  'browser-smoke-test',
  'desktop-smoke-test',
  'unity-instrumented-smoke-test',
  'unity-desktop-fallback-smoke-test',
  'godot-instrumented-smoke-test',
  'godot-desktop-fallback-smoke-test',
  'unreal-instrumented-smoke-test',
  'unreal-desktop-fallback-smoke-test',
  'custom-engine-instrumented-smoke-test',
  'custom-engine-desktop-fallback-smoke-test'
]);

export const FirstTestTemplateSchema = z.object({
  id: FirstTestTemplateIdSchema,
  name: z.string().min(1),
  profileKind: FirstTestProfileKindSchema,
  botProfileId: z.string().min(1),
  actionCount: z.number().int().min(1).max(20),
  actionDelayMs: z.number().int().min(500).max(750),
  saveScreenshots: z.enum(['on', 'if-supported']),
  saveStateSnapshots: z.boolean(),
  resourceWeight: ResourceWeightSchema,
  recommendStartupFlow: z.boolean(),
  observationPreference: z.enum(['visible', 'visible-if-supported', 'background']),
  whatItDoes: z.string().min(1),
  whenToUse: z.string().min(1),
  limitations: z.string().min(1),
  expectedResult: z.string().min(1),
  beginnerRecommendation: z.string().min(1),
  beforeStarting: z.array(z.string().min(1)).min(1)
});

export type FirstTestProfileKind = z.infer<typeof FirstTestProfileKindSchema>;
export type FirstTestTemplateId = z.infer<typeof FirstTestTemplateIdSchema>;
export type FirstTestTemplate = z.infer<typeof FirstTestTemplateSchema>;

export const firstTestTemplates: FirstTestTemplate[] = FirstTestTemplateSchema.array()
  .length(10)
  .parse([
    {
      id: 'browser-smoke-test',
      name: 'Browser Smoke Test',
      profileKind: 'browser',
      botProfileId: 'ui-tester-bot',
      actionCount: 20,
      actionDelayMs: 650,
      saveScreenshots: 'on',
      saveStateSnapshots: false,
      resourceWeight: 'light',
      recommendStartupFlow: false,
      observationPreference: 'visible',
      whatItDoes: 'Runs one UI Tester Bot for 20 careful actions and saves screenshots while it checks a browser game.',
      whenToUse: 'Use it for a browser game after its page opens successfully in the profile test.',
      limitations: 'It does not prove every level works, and it cannot understand private game state unless the page shares it.',
      expectedResult: 'The page should open, the bot should try a few menu or input actions, and the run should finish with logs and screenshots.',
      beginnerRecommendation: 'Use this as the first browser run. Keep video off and review the first report before adding more bots.',
      beforeStarting: ['Check that the Game URL opens.', 'Add keyboard or mouse mappings when the game does not expose actions.']
    },
    {
      id: 'desktop-smoke-test',
      name: 'Desktop Smoke Test',
      profileKind: 'desktop',
      botProfileId: 'ui-tester-bot',
      actionCount: 20,
      actionDelayMs: 650,
      saveScreenshots: 'if-supported',
      saveStateSnapshots: false,
      resourceWeight: 'medium',
      recommendStartupFlow: false,
      observationPreference: 'visible',
      whatItDoes: 'Launches one desktop game and lets one UI Tester Bot perform 20 slow mapped inputs.',
      whenToUse: 'Use it for a normal desktop executable after the launch and dependency checks pass.',
      limitations: 'It sees less game detail than instrumentation and cannot use controls that were not mapped.',
      expectedResult: 'The game should launch, receive a small number of inputs, and stop cleanly with process logs and screenshots when supported.',
      beginnerRecommendation: 'Test one harmless menu control before applying this template, then watch the first run.',
      beforeStarting: ['Test launch from the game profile.', 'Test one control such as Menu or Escape.', 'Check that the input driver is available.']
    },
    {
      id: 'unity-instrumented-smoke-test',
      name: 'Unity Instrumented Smoke Test',
      profileKind: 'unity-instrumented',
      botProfileId: 'main-story-bot',
      actionCount: 20,
      actionDelayMs: 600,
      saveScreenshots: 'on',
      saveStateSnapshots: true,
      resourceWeight: 'medium',
      recommendStartupFlow: false,
      observationPreference: 'visible-if-supported',
      whatItDoes: 'Runs one Main Story Bot against a Unity test endpoint and saves structured state snapshots and screenshots.',
      whenToUse: 'Use it when a Unity development build exposes the GameplaySimulator instrumentation protocol.',
      limitations: 'It only knows the state and actions the Unity integration exposes, so missing hooks leave gaps.',
      expectedResult: 'The endpoint should report changing state while the bot completes up to 20 actions and writes a detailed report.',
      beginnerRecommendation: 'Run the endpoint health check first. Use a UI Journey Bot later if the game begins behind layered menus.',
      beforeStarting: ['Check the instrumentation endpoint health.', 'Confirm the available actions include a safe gameplay action.']
    },
    {
      id: 'unity-desktop-fallback-smoke-test',
      name: 'Unity Desktop Fallback Smoke Test',
      profileKind: 'unity-desktop-fallback',
      botProfileId: 'ui-journey-bot',
      actionCount: 20,
      actionDelayMs: 700,
      saveScreenshots: 'if-supported',
      saveStateSnapshots: false,
      resourceWeight: 'medium',
      recommendStartupFlow: true,
      observationPreference: 'visible',
      whatItDoes: 'Controls one Unity game window with one UI Journey Bot and a small set of mapped inputs.',
      whenToUse: 'Use it when the Unity build has no instrumentation endpoint but can be launched and controlled as a desktop game.',
      limitations: 'It cannot read full Unity state and may need waits or screenshots to understand menu changes.',
      expectedResult: 'The game should launch and the bot should follow the configured menu flow or try 20 cautious UI actions.',
      beginnerRecommendation: 'Add control mappings and a startup flow before the first run. Keep the first flow short.',
      beforeStarting: ['Map menu controls.', 'Test one control.', 'Add and test a startup flow when gameplay starts behind menus.']
    },
    {
      id: 'godot-instrumented-smoke-test',
      name: 'Godot Instrumented Smoke Test',
      profileKind: 'godot-instrumented',
      botProfileId: 'main-story-bot',
      actionCount: 20,
      actionDelayMs: 600,
      saveScreenshots: 'on',
      saveStateSnapshots: true,
      resourceWeight: 'medium',
      recommendStartupFlow: false,
      observationPreference: 'visible-if-supported',
      whatItDoes: 'Runs one Main Story Bot against a Godot test endpoint and records structured state plus screenshots.',
      whenToUse: 'Use it when a Godot development build exposes the GameplaySimulator instrumentation protocol.',
      limitations: 'It cannot inspect state or perform actions that the Godot integration does not publish.',
      expectedResult: 'The endpoint should stay healthy, state should change after actions, and the run should produce a short report.',
      beginnerRecommendation: 'Start with the health check and 20 actions. Add wider content tests only after this run is clean.',
      beforeStarting: ['Check the instrumentation endpoint health.', 'Confirm the game reports useful state and actions.']
    },
    {
      id: 'godot-desktop-fallback-smoke-test',
      name: 'Godot Desktop Fallback Smoke Test',
      profileKind: 'godot-desktop-fallback',
      botProfileId: 'ui-journey-bot',
      actionCount: 20,
      actionDelayMs: 700,
      saveScreenshots: 'if-supported',
      saveStateSnapshots: false,
      resourceWeight: 'medium',
      recommendStartupFlow: true,
      observationPreference: 'visible',
      whatItDoes: 'Controls one Godot game window with one UI Journey Bot and mapped keyboard or mouse input.',
      whenToUse: 'Use it when the Godot build has no instrumentation endpoint.',
      limitations: 'It has weak game awareness and cannot use actions that have no control mapping.',
      expectedResult: 'The executable should open and the bot should complete a short menu journey or 20 careful inputs.',
      beginnerRecommendation: 'Test launch and one control first. Add a startup flow if the game opens on a menu.',
      beforeStarting: ['Map menu controls.', 'Test one control.', 'Add and test a startup flow when needed.']
    },
    {
      id: 'unreal-instrumented-smoke-test',
      name: 'Unreal Instrumented Smoke Test',
      profileKind: 'unreal-instrumented',
      botProfileId: 'main-story-bot',
      actionCount: 20,
      actionDelayMs: 600,
      saveScreenshots: 'on',
      saveStateSnapshots: true,
      resourceWeight: 'heavy',
      recommendStartupFlow: false,
      observationPreference: 'visible-if-supported',
      whatItDoes: 'Runs one Main Story Bot against an Unreal test endpoint and records structured state and screenshots.',
      whenToUse: 'Use it when an Unreal development build exposes the GameplaySimulator instrumentation protocol.',
      limitations: 'It only tests the actions and state exposed by the Unreal integration and is not a full game pass.',
      expectedResult: 'The endpoint should report live state, the bot should perform up to 20 actions, and reports should contain detailed evidence.',
      beginnerRecommendation: 'Use one bot even on a powerful PC. Confirm the endpoint and build name before starting.',
      beforeStarting: ['Check the instrumentation endpoint health.', 'Confirm the returned build is the build you meant to test.']
    },
    {
      id: 'unreal-desktop-fallback-smoke-test',
      name: 'Unreal Desktop Fallback Smoke Test',
      profileKind: 'unreal-desktop-fallback',
      botProfileId: 'ui-journey-bot',
      actionCount: 20,
      actionDelayMs: 700,
      saveScreenshots: 'if-supported',
      saveStateSnapshots: false,
      resourceWeight: 'heavy',
      recommendStartupFlow: true,
      observationPreference: 'visible',
      whatItDoes: 'Controls one Unreal game window with one UI Journey Bot and only 20 mapped inputs.',
      whenToUse: 'Use it when the Unreal build has no instrumentation endpoint but desktop input works.',
      limitations: 'It cannot read full Unreal state and screenshots may not explain every loading or focus problem.',
      expectedResult: 'The game should launch, receive a short menu flow or input sequence, and stop with process and evidence logs.',
      beginnerRecommendation: 'Keep one game instance. Test focus and one control before starting the bot.',
      beforeStarting: ['Test launch.', 'Test window focus and one control.', 'Add a startup flow for layered menus.']
    },
    {
      id: 'custom-engine-instrumented-smoke-test',
      name: 'Custom Engine Instrumented Smoke Test',
      profileKind: 'custom-instrumented',
      botProfileId: 'main-story-bot',
      actionCount: 20,
      actionDelayMs: 600,
      saveScreenshots: 'on',
      saveStateSnapshots: true,
      resourceWeight: 'medium',
      recommendStartupFlow: false,
      observationPreference: 'visible-if-supported',
      whatItDoes: 'Runs one Main Story Bot through a custom engine instrumentation endpoint and saves structured state.',
      whenToUse: 'Use it when your custom engine implements the local GameplaySimulator protocol.',
      limitations: 'It cannot test engine features that your bridge does not expose.',
      expectedResult: 'Health, state, and action calls should work together for a short 20-action run with readable evidence.',
      beginnerRecommendation: 'Prove the health, state, and action endpoints with the profile test before running bots.',
      beforeStarting: ['Check endpoint health.', 'Confirm state changes when a test action is performed.']
    },
    {
      id: 'custom-engine-desktop-fallback-smoke-test',
      name: 'Custom Engine Desktop Fallback Smoke Test',
      profileKind: 'custom-desktop-fallback',
      botProfileId: 'ui-journey-bot',
      actionCount: 20,
      actionDelayMs: 700,
      saveScreenshots: 'if-supported',
      saveStateSnapshots: false,
      resourceWeight: 'medium',
      recommendStartupFlow: true,
      observationPreference: 'visible',
      whatItDoes: 'Launches one custom-engine desktop build and runs one UI Journey Bot through mapped controls.',
      whenToUse: 'Use it when the custom engine has no instrumentation bridge but behaves like a normal desktop game.',
      limitations: 'It has limited state awareness and depends on correct focus, controls, waits, and screenshots.',
      expectedResult: 'The executable should open and complete a short startup flow or 20 careful actions without overloading the PC.',
      beginnerRecommendation: 'Map only the controls needed for the first menu journey, test one, then watch the run.',
      beforeStarting: ['Test launch.', 'Map and test one control.', 'Add a startup flow when the game is not immediately playable.']
    }
  ]);

function hasInstrumentationEndpoint(gameProfile: GameProfile): boolean {
  return Boolean(gameProfile.adapter.instrumentationEndpoint?.trim());
}

export function firstTestProfileKind(gameProfile: GameProfile): FirstTestProfileKind | null {
  const engineType = gameProfile.engine.type;
  const adapterType = gameProfile.adapter.type;
  const instrumented = hasInstrumentationEndpoint(gameProfile);

  if (adapterType === 'browser' || engineType === 'browser') {
    return 'browser';
  }

  if (engineType === 'unity' || adapterType === 'unity') {
    return instrumented ? 'unity-instrumented' : 'unity-desktop-fallback';
  }

  if (engineType === 'godot' || adapterType === 'godot') {
    return instrumented ? 'godot-instrumented' : 'godot-desktop-fallback';
  }

  if (engineType === 'unreal' || adapterType === 'unreal') {
    return instrumented ? 'unreal-instrumented' : 'unreal-desktop-fallback';
  }

  if (engineType === 'custom') {
    if (adapterType === 'instrumented') {
      return 'custom-instrumented';
    }

    return adapterType === 'desktop' ? 'custom-desktop-fallback' : null;
  }

  if (adapterType === 'desktop' || adapterType === 'rpg_maker' || adapterType === 'gamemaker') {
    return 'desktop';
  }

  return null;
}

export function isFirstTestTemplateCompatible(
  template: FirstTestTemplate,
  gameProfile: GameProfile
): boolean {
  return template.profileKind === firstTestProfileKind(gameProfile);
}

export function recommendedFirstTestTemplate(gameProfile: GameProfile): FirstTestTemplate | undefined {
  const profileKind = firstTestProfileKind(gameProfile);
  return firstTestTemplates.find((template) => template.profileKind === profileKind);
}
