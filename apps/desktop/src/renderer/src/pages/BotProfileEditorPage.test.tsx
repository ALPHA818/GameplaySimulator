// @vitest-environment jsdom

import { defaultBotProfiles } from '@core/bot/defaultBotProfiles';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useConfigStore } from '../store/configStore';
import { BotProfileEditorPage } from './BotProfileEditorPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function fieldControl(label: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const control = Array.from(
    container?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      'input, textarea, select'
    ) ?? []
  ).find((candidate) => candidate.labels?.[0]?.textContent?.includes(label));

  if (!control) throw new Error(`Missing field ${label}`);
  return control;
}

function setValue(
  control: HTMLInputElement | HTMLTextAreaElement,
  value: string
) {
  const prototype = control instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(control, value);
  control.dispatchEvent(new Event('input', { bubbles: true }));
}

function selectMultiple(control: HTMLSelectElement, values: string[]) {
  for (const option of Array.from(control.options)) {
    option.selected = values.includes(option.value);
  }
  control.dispatchEvent(new Event('change', { bubbles: true }));
}

function saveButton(): HTMLButtonElement {
  const button = Array.from(container?.querySelectorAll('button') ?? [])
    .find((candidate) => candidate.textContent?.trim() === 'Save Profile');
  if (!button) throw new Error('Missing Save Profile button');
  return button;
}

beforeEach(() => {
  useConfigStore.setState({
    currentPage: 'botProfileEditor',
    botProfiles: defaultBotProfiles,
    editingBotProfileId: null,
    cloningBotProfileId: null,
    pendingSessionBotProfileId: null,
    pendingSessionBotProfileIds: []
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

describe('BotProfileEditorPage', () => {
  it('creates a custom specialist profile without editing JSON', () => {
    act(() => root?.render(<BotProfileEditorPage />));

    act(() => {
      setValue(fieldControl('Profile Name') as HTMLInputElement, 'Hexcraft Material Combination Tester');
      setValue(
        fieldControl('What This Bot Tests') as HTMLTextAreaElement,
        'Combines Hexcraft materials and verifies valid, invalid, and duplicate results.'
      );
      setValue(
        fieldControl('Preferred Actions') as HTMLTextAreaElement,
        'open-crafting\ncombine-materials\ninspect-result'
      );
      setValue(
        fieldControl('Avoided Actions') as HTMLTextAreaElement,
        'delete-world'
      );
      setValue(fieldControl('Target Scenes') as HTMLTextAreaElement, 'Workshop');
      setValue(
        fieldControl('Target Features') as HTMLTextAreaElement,
        'material-combination\ncrafting'
      );
      setValue(
        fieldControl('Success Criteria') as HTMLTextAreaElement,
        'Every valid pair creates the expected item.\nInvalid pairs preserve input materials.'
      );
      selectMultiple(
        fieldControl('Target Issue Categories') as HTMLSelectElement,
        ['gameplay', 'inventory', 'exploit']
      );
      selectMultiple(
        fieldControl('Required Capabilities') as HTMLSelectElement,
        ['state-read', 'direct-actions']
      );
      selectMultiple(
        fieldControl('Recommended Game Types') as HTMLSelectElement,
        ['browser', 'instrumented']
      );
    });

    act(() => saveButton().click());

    const created = useConfigStore.getState().botProfiles.find(
      (profile) => profile.profileId === 'hexcraft-material-combination-tester'
    );
    expect(useConfigStore.getState().currentPage).toBe('botProfiles');
    expect(created).toMatchObject({
      displayName: 'Hexcraft Material Combination Tester',
      profileGroup: 'custom',
      specializationCategory: 'gameplay-systems',
      requiredCapabilities: ['state-read', 'direct-actions'],
      recommendedGameTypes: ['browser', 'instrumented'],
      preferredActions: ['open-crafting', 'combine-materials', 'inspect-result'],
      targetScenes: ['Workshop'],
      targetFeatures: ['material-combination', 'crafting'],
      targetIssueCategories: ['gameplay', 'inventory', 'exploit'],
      defaultEnabled: false
    });
    expect(created?.goals[0].successCriteria).toHaveLength(2);
  });

  it('clones an existing profile into a new custom profile without changing the source', () => {
    useConfigStore.setState({ cloningBotProfileId: 'crafting-recipe-tester-bot' });
    const original = defaultBotProfiles.find(
      (profile) => profile.profileId === 'crafting-recipe-tester-bot'
    );

    act(() => root?.render(<BotProfileEditorPage />));

    expect((fieldControl('Profile Name') as HTMLInputElement).value).toBe(
      'Crafting And Recipe Tester Bot Copy'
    );
    expect((fieldControl('Profile ID') as HTMLInputElement).value).not.toBe(
      'crafting-recipe-tester-bot'
    );

    act(() => saveButton().click());

    const profiles = useConfigStore.getState().botProfiles;
    expect(profiles.find((profile) => profile.profileId === original?.profileId)).toEqual(original);
    expect(profiles.some(
      (profile) =>
        profile.profileGroup === 'custom' &&
        profile.displayName === 'Crafting And Recipe Tester Bot Copy'
    )).toBe(true);
  });

  it('rejects duplicate IDs and invalid recommended count ranges', () => {
    act(() => root?.render(<BotProfileEditorPage />));

    act(() => {
      setValue(fieldControl('Profile Name') as HTMLInputElement, 'Farming System Tester');
      setValue(fieldControl('Profile ID') as HTMLInputElement, 'explorer-bot');
      setValue(
        fieldControl('What This Bot Tests') as HTMLTextAreaElement,
        'Tests planting and harvesting.'
      );
      setValue(fieldControl('Preferred Actions') as HTMLTextAreaElement, 'plant-crop');
      setValue(fieldControl('Recommended Minimum Count') as HTMLInputElement, '4');
      setValue(fieldControl('Recommended Maximum Count') as HTMLInputElement, '2');
    });

    act(() => saveButton().click());
    expect(container?.textContent).toContain(
      'Recommended maximum count cannot be below the recommended minimum count.'
    );

    act(() => {
      setValue(fieldControl('Recommended Maximum Count') as HTMLInputElement, '4');
    });
    act(() => saveButton().click());
    expect(container?.textContent).toContain('Profile ID must be unique.');
    expect(useConfigStore.getState().currentPage).toBe('botProfileEditor');
  });

  it('warns before saving a profile with no preferred actions', () => {
    act(() => root?.render(<BotProfileEditorPage />));
    act(() => {
      setValue(fieldControl('Profile Name') as HTMLInputElement, 'Character Customization Tester');
      setValue(
        fieldControl('What This Bot Tests') as HTMLTextAreaElement,
        'Tests character appearance and customization choices.'
      );
    });

    act(() => saveButton().click());

    expect(container?.textContent).toContain('has no preferred actions');
    expect(useConfigStore.getState().currentPage).toBe('botProfileEditor');

    act(() => saveButton().click());
    expect(useConfigStore.getState().currentPage).toBe('botProfiles');
  });

  it('provides hover help for every requested editor field', () => {
    act(() => root?.render(<BotProfileEditorPage />));

    for (const label of [
      'Profile Name',
      'Profile Group',
      'Specialization Category',
      'What This Bot Tests',
      'Preferred Actions',
      'Avoided Actions',
      'Target Scenes',
      'Target Features',
      'Target Issue Categories',
      'Aggression',
      'Curiosity',
      'Risk Tolerance',
      'Repetition Tolerance',
      'Bug Hunting Bias',
      'Required Capabilities',
      'Recommended Game Types',
      'Resource Weight',
      'Recommended Minimum Count',
      'Recommended Maximum Count',
      'Limitations',
      'Success Criteria',
      'Clone Existing Profile'
    ]) {
      expect(document.querySelector(`[aria-label="Help for ${label}"]`), label).not.toBeNull();
    }
  });
});
