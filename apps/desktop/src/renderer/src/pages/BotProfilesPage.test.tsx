// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultBotProfiles } from '@core/bot/defaultBotProfiles';
import type { BotProfile } from '@core/types';
import { useConfigStore } from '../store/configStore';
import { BotProfilesPage } from './BotProfilesPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function selectValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

beforeEach(() => {
  useConfigStore.setState({
    currentPage: 'botProfiles',
    botProfiles: defaultBotProfiles,
    pendingSessionBotProfileId: null,
    pendingSessionBotProfileIds: [],
    editingBotProfileId: null,
    cloningBotProfileId: null
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

describe('Bot Profiles grouped catalog', () => {
  it('separates general, specialized, and custom profiles', () => {
    const customProfile: BotProfile = {
      ...defaultBotProfiles[0],
      profileId: 'studio-custom-bot',
      displayName: 'Studio Custom Bot',
      profileGroup: 'custom',
      defaultEnabled: false
    };
    useConfigStore.setState({ botProfiles: [...defaultBotProfiles, customProfile] });

    act(() => root?.render(<BotProfilesPage />));

    expect(container?.textContent).toContain('General-Purpose Bots');
    expect(container?.textContent).toContain('Specialized Test Bots');
    expect(container?.textContent).toContain('Custom Bot Profiles');
    expect(container?.querySelectorAll('[data-profile-group="general"]')).toHaveLength(6);
    expect(container?.querySelectorAll('[data-profile-group="specialized"]')).toHaveLength(39);
    expect(container?.querySelectorAll('[data-profile-group="custom"]')).toHaveLength(1);
    expect(container?.textContent).toContain('Studio Custom Bot');
  });

  it('shows controls, display, accessibility, and UX testers under Specialized Test Bots', () => {
    act(() => root?.render(<BotProfilesPage />));
    const specializedText = Array.from(
      container?.querySelectorAll('[data-profile-group="specialized"]') ?? []
    ).map((card) => card.textContent).join(' ');

    for (const name of [
      'Keyboard And Input Mapping Tester Bot',
      'Controller And Gamepad Tester Bot',
      'Touch And Mobile Controls Tester Bot',
      'Display And Resolution Tester Bot',
      'Localization And Text Overflow Tester Bot',
      'Audio And Subtitle Tester Bot',
      'Accessibility Tester Bot',
      'Settings And Configuration Tester Bot'
    ]) {
      expect(specializedText).toContain(name);
    }
  });

  it('shows accurate compatibility limits and prevents unsupported profiles from being added', () => {
    act(() => root?.render(<BotProfilesPage />));
    const cards = Array.from(container?.querySelectorAll('[data-profile-group="specialized"]') ?? []);
    const controllerCard = cards.find((card) => card.textContent?.includes('Controller And Gamepad Tester Bot'));
    const touchCard = cards.find((card) => card.textContent?.includes('Touch And Mobile Controls Tester Bot'));
    const audioCard = cards.find((card) => card.textContent?.includes('Audio And Subtitle Tester Bot'));
    const accessibilityCard = cards.find((card) => card.textContent?.includes('Accessibility Tester Bot'));

    expect(container?.querySelector('[aria-label="Help for Compatibility Game Profile"]')).toBeTruthy();
    expect(controllerCard?.textContent).toContain('Gamepad input is unavailable');
    expect((controllerCard?.querySelector('.primary-button') as HTMLButtonElement).disabled).toBe(true);
    expect(touchCard?.textContent).toContain('Touch simulation is unavailable');
    expect(touchCard?.getAttribute('data-compatibility-status')).toBe('limited');
    expect((touchCard?.querySelector('.primary-button') as HTMLButtonElement).disabled).toBe(false);
    expect(audioCard?.textContent).toContain('Audio cannot be automatically verified');
    expect(accessibilityCard?.textContent).toContain('not accessibility certification');
  });

  it('shows all long-running and technical testers in specialized sections', () => {
    act(() => root?.render(<BotProfilesPage />));
    const specializedText = Array.from(
      container?.querySelectorAll('[data-profile-group="specialized"]') ?? []
    ).map((card) => card.textContent).join(' ');

    for (const name of [
      'Loading And Transition Tester Bot',
      'Network Resilience Tester Bot',
      'Multiplayer Session Tester Bot',
      'Memory Leak And Endurance Tester Bot',
      'Save Migration Tester Bot',
      'World Persistence Tester Bot',
      'Achievement And Unlock Tester Bot',
      'File And Permission Tester Bot'
    ]) {
      expect(specializedText).toContain(name);
    }
    expect(specializedText).toContain('Controlled network test confirmation is required');
    expect(specializedText).toContain('Endurance testing can substantially increase CPU, RAM, disk use, and total runtime');
  });

  it('shows all focused gameplay-system testers under Specialized Test Bots', () => {
    act(() => root?.render(<BotProfilesPage />));
    const specializedText = Array.from(
      container?.querySelectorAll('[data-profile-group="specialized"]') ?? []
    ).map((card) => card.textContent).join(' ');

    for (const name of [
      'Crafting And Recipe Tester Bot',
      'Building And Destruction Tester Bot',
      'Physics Interaction Tester Bot',
      'Camera And View Tester Bot',
      'Loot And Random Drop Tester Bot',
      'Death And Respawn Tester Bot',
      'NPC Behaviour Tester Bot',
      'Boss Encounter Tester Bot',
      'Procedural Generation Tester Bot',
      'Environment Cycle Tester Bot'
    ]) {
      expect(specializedText).toContain(name);
    }
  });

  it('filters specialized profiles without mixing in general bots', () => {
    act(() => root?.render(<BotProfilesPage />));
    const filter = container?.querySelector('#specialized-bot-category') as HTMLSelectElement;

    expect(filter).toBeInstanceOf(HTMLSelectElement);
    expect(container?.querySelector('[aria-label="Help for Specialized Category"]')).toBeTruthy();

    act(() => selectValue(filter, 'persistence'));

    const specializedCards = container?.querySelectorAll('[data-profile-group="specialized"]');
    expect(specializedCards).toHaveLength(3);
    const specializedText = Array.from(specializedCards ?? []).map((card) => card.textContent).join(' ');
    expect(specializedText).toContain('Save Load Tester Bot');
    expect(specializedText).toContain('Save Migration Tester Bot');
    expect(specializedText).toContain('World Persistence Tester Bot');
    expect(specializedText).not.toContain('Explorer Bot');
  });

  it('carries Add To Session into the New Session workflow', () => {
    act(() => root?.render(<BotProfilesPage />));
    const explorerCard = Array.from(container?.querySelectorAll('[data-profile-group="general"]') ?? [])
      .find((card) => card.textContent?.includes('Explorer Bot'));
    const addButton = Array.from(explorerCard?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent?.trim() === 'Add To Session');

    expect(addButton).toBeInstanceOf(HTMLButtonElement);
    act(() => (addButton as HTMLButtonElement).click());

    expect(useConfigStore.getState().currentPage).toBe('newSession');
    expect(useConfigStore.getState().pendingSessionBotProfileId).toBe('explorer-bot');
  });

  it('shows user-created specialists in Custom Bot Profiles and makes them selectable', () => {
    const source = defaultBotProfiles.find((profile) => profile.profileId === 'explorer-bot');
    expect(source).toBeDefined();
    useConfigStore.setState({
      botProfiles: [
        ...defaultBotProfiles,
        {
          ...source!,
          profileId: 'farming-system-tester',
          displayName: 'Farming System Tester',
          botType: 'farming-system-tester',
          profileGroup: 'custom',
          specializationCategory: 'gameplay-systems',
          defaultEnabled: false
        }
      ]
    });

    act(() => root?.render(<BotProfilesPage />));

    const customSection = container?.querySelector(
      '[aria-labelledby="profile-group-custom-bot-profiles"]'
    );
    const customCard = Array.from(
      customSection?.querySelectorAll('[data-profile-group="custom"]') ?? []
    ).find((card) => card.textContent?.includes('Farming System Tester'));
    const editButton = Array.from(customCard?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent?.trim() === 'Edit Profile');
    const addButton = Array.from(customCard?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent?.trim() === 'Add To Session');

    expect(customSection?.textContent).toContain('Custom Bot Profiles');
    expect(customCard).toBeDefined();
    expect(editButton).toBeInstanceOf(HTMLButtonElement);
    expect(addButton).toBeInstanceOf(HTMLButtonElement);

    act(() => (addButton as HTMLButtonElement).click());
    expect(useConfigStore.getState().currentPage).toBe('newSession');
    expect(useConfigStore.getState().pendingSessionBotProfileId).toBe(
      'farming-system-tester'
    );
  });

  it('opens the custom editor for new and cloned profiles', () => {
    act(() => root?.render(<BotProfilesPage />));
    const newButton = Array.from(container?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent?.trim() === 'New Custom Profile');

    expect(newButton).toBeInstanceOf(HTMLButtonElement);
    act(() => (newButton as HTMLButtonElement).click());
    expect(useConfigStore.getState().currentPage).toBe('botProfileEditor');
    expect(useConfigStore.getState().editingBotProfileId).toBeNull();

    useConfigStore.setState({ currentPage: 'botProfiles' });
    const explorerCard = Array.from(container?.querySelectorAll('[data-profile-group="general"]') ?? [])
      .find((card) => card.textContent?.includes('Explorer Bot'));
    const cloneButton = Array.from(explorerCard?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent?.trim() === 'Clone Profile');

    expect(cloneButton).toBeInstanceOf(HTMLButtonElement);
    act(() => (cloneButton as HTMLButtonElement).click());
    expect(useConfigStore.getState().currentPage).toBe('botProfileEditor');
    expect(useConfigStore.getState().cloningBotProfileId).toBe('explorer-bot');
  });

  it('explains recommendations and explicitly queues all recommended specialists in one action', () => {
    const baseProfile = useConfigStore.getState().gameProfiles[0];
    useConfigStore.setState({
      gameProfiles: [{
        ...baseProfile,
        gameId: 'hexcraft-like',
        gameName: 'Hexcraft Test Build',
        adapter: {
          ...baseProfile.adapter,
          supportsStateRead: true,
          supportsDirectActions: true
        },
        controls: [
          {
            controlId: 'open-crafting',
            label: 'Open Crafting',
            inputType: 'keyboard',
            action: 'open-crafting',
            metadata: {}
          }
        ],
        testingTargets: [{
          targetId: 'world-generation',
          name: 'Procedural world generation',
          priority: 10,
          tags: ['generated-world', 'world-seed']
        }],
        progressSignals: [{
          signalId: 'environment',
          name: 'Day night weather cycle',
          source: 'state',
          metadata: {}
        }],
        knownContent: {
          ...baseProfile.knownContent,
          mechanics: ['crafting recipes', 'building and destruction', 'procedural generation', 'day night weather']
        }
      }]
    });

    act(() => root?.render(<BotProfilesPage />));

    const craftingCard = Array.from(container?.querySelectorAll('[data-profile-group="specialized"]') ?? [])
      .find((card) => card.textContent?.includes('Crafting And Recipe Tester Bot'));
    const multiplayerCard = Array.from(container?.querySelectorAll('[data-profile-group="specialized"]') ?? [])
      .find((card) => card.textContent?.includes('Multiplayer Session Tester Bot'));
    const addRecommended = Array.from(container?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent?.trim() === 'Add Recommended Bots To Session');

    expect(craftingCard?.getAttribute('data-compatibility-status')).toBe('recommended');
    expect(craftingCard?.textContent).toContain('Why Recommended');
    expect(craftingCard?.textContent).toContain('Crafting, recipes, or ingredients appear in the profile');
    expect(multiplayerCard?.getAttribute('data-compatibility-status')).toBe('unsupported');
    for (const label of [
      'Recommended Specialist Bots',
      'Compatible With Selected Game',
      'Why Recommended',
      'Missing Requirements',
      'Expected Limitations'
    ]) {
      expect(document.querySelector(`[aria-label="Help for ${label}"]`)).not.toBeNull();
    }

    expect(addRecommended).toBeInstanceOf(HTMLButtonElement);
    act(() => (addRecommended as HTMLButtonElement).click());

    const pending = useConfigStore.getState().pendingSessionBotProfileIds;
    expect(useConfigStore.getState().currentPage).toBe('newSession');
    expect(pending).toContain('crafting-recipe-tester-bot');
    expect(pending).toContain('building-destruction-tester-bot');
    expect(pending).toContain('procedural-generation-tester-bot');
    expect(pending).toContain('environment-cycle-tester-bot');
    expect(pending).not.toContain('multiplayer-session-tester-bot');
    expect(pending).not.toContain('touch-mobile-controls-tester-bot');
  });
});
