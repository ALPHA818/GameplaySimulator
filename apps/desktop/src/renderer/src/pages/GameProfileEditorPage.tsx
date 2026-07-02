import type { AdapterType, EngineType, GameProfile, LaunchPlatform } from '@core/types';
import { GameProfileSchema } from '@core/types';
import { ArrowLeft, Save } from 'lucide-react';
import type { FormEvent } from 'react';
import { useMemo, useState } from 'react';
import { SelectInput, TextareaInput, TextInput, ToggleInput } from '../components/FormFields';
import { useConfigStore } from '../store/configStore';
import type { FieldErrors } from '../utils/forms';
import { optionalText, slugify, splitArguments, zodFieldErrors } from '../utils/forms';

const engineOptions: Array<{ value: EngineType; label: string }> = [
  { value: 'unity', label: 'Unity' },
  { value: 'godot', label: 'Godot' },
  { value: 'unreal', label: 'Unreal' },
  { value: 'browser', label: 'Browser' },
  { value: 'custom', label: 'Custom' },
  { value: 'unknown', label: 'Unknown' }
];

const adapterOptions: Array<{ value: AdapterType; label: string }> = [
  { value: 'instrumented', label: 'Instrumented' },
  { value: 'desktop', label: 'Desktop' },
  { value: 'browser', label: 'Browser' },
  { value: 'unity', label: 'Unity' },
  { value: 'godot', label: 'Godot' },
  { value: 'unreal', label: 'Unreal' },
  { value: 'rpg_maker', label: 'RPG Maker' },
  { value: 'gamemaker', label: 'GameMaker' },
  { value: 'custom', label: 'Custom' }
];

const platformOptions: Array<{ value: LaunchPlatform; label: string }> = [
  { value: 'windows', label: 'Windows' },
  { value: 'linux', label: 'Linux' },
  { value: 'mac', label: 'macOS' },
  { value: 'browser', label: 'Browser' }
];

interface GameProfileFormState {
  gameId: string;
  gameName: string;
  version: string;
  buildId: string;
  engineType: EngineType;
  engineVersion: string;
  executablePath: string;
  workingDirectory: string;
  launchArguments: string;
  url: string;
  platform: LaunchPlatform;
  adapterType: AdapterType;
  supportsMultipleInstances: boolean;
  supportsStateRead: boolean;
  supportsDirectActions: boolean;
  supportsScreenshots: boolean;
  supportsVideo: boolean;
  supportsSaveIsolation: boolean;
}

function formFromProfile(profile?: GameProfile): GameProfileFormState {
  return {
    gameId: profile?.gameId ?? '',
    gameName: profile?.gameName ?? '',
    version: profile?.version ?? '',
    buildId: profile?.buildId ?? '',
    engineType: profile?.engine.type ?? 'unknown',
    engineVersion: profile?.engine.version ?? '',
    executablePath: profile?.launch.executablePath ?? '',
    workingDirectory: profile?.launch.workingDirectory ?? '',
    launchArguments: profile?.launch.arguments?.join('\n') ?? '',
    url: profile?.launch.url ?? '',
    platform: profile?.launch.platform ?? 'windows',
    adapterType: profile?.adapter.type ?? 'desktop',
    supportsMultipleInstances: profile?.adapter.supportsMultipleInstances ?? false,
    supportsStateRead: profile?.adapter.supportsStateRead ?? false,
    supportsDirectActions: profile?.adapter.supportsDirectActions ?? false,
    supportsScreenshots: profile?.adapter.supportsScreenshots ?? true,
    supportsVideo: profile?.adapter.supportsVideo ?? false,
    supportsSaveIsolation: profile?.adapter.supportsSaveIsolation ?? false
  };
}

function buildProfile(form: GameProfileFormState): GameProfile {
  const gameId = optionalText(form.gameId) ?? slugify(form.gameName);

  return {
    gameId,
    gameName: form.gameName.trim(),
    version: form.version.trim(),
    buildId: optionalText(form.buildId),
    engine: {
      type: form.engineType,
      version: optionalText(form.engineVersion)
    },
    launch: {
      executablePath: optionalText(form.executablePath),
      workingDirectory: optionalText(form.workingDirectory),
      arguments: splitArguments(form.launchArguments),
      url: optionalText(form.url),
      platform: form.platform
    },
    adapter: {
      type: form.adapterType,
      supportsMultipleInstances: form.supportsMultipleInstances,
      supportsStateRead: form.supportsStateRead,
      supportsDirectActions: form.supportsDirectActions,
      supportsScreenshots: form.supportsScreenshots,
      supportsVideo: form.supportsVideo,
      supportsSaveIsolation: form.supportsSaveIsolation
    },
    controls: [],
    testingTargets: [],
    progressSignals: [],
    failureSignals: [],
    knownContent: {
      locations: [],
      characters: [],
      items: [],
      quests: [],
      mechanics: [],
      notes: []
    }
  };
}

export function GameProfileEditorPage() {
  const editingGameId = useConfigStore((state) => state.editingGameId);
  const existingProfile = useConfigStore((state) =>
    state.gameProfiles.find((profile) => profile.gameId === editingGameId)
  );
  const saveGameProfile = useConfigStore((state) => state.saveGameProfile);
  const navigate = useConfigStore((state) => state.navigate);
  const [form, setForm] = useState<GameProfileFormState>(() => formFromProfile(existingProfile));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [validatedProfile, setValidatedProfile] = useState<GameProfile | null>(null);
  const title = existingProfile ? 'Edit Game Profile' : 'New Game Profile';

  const preview = useMemo(() => {
    try {
      return buildProfile(form);
    } catch {
      return null;
    }
  }, [form]);

  function update<K extends keyof GameProfileFormState>(key: K, value: GameProfileFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = GameProfileSchema.safeParse(buildProfile(form));

    if (!result.success) {
      setErrors(zodFieldErrors(result.error));
      setValidatedProfile(null);
      return;
    }

    setErrors({});
    setValidatedProfile(result.data);
    saveGameProfile(result.data);
  }

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Configuration</p>
          <h1>{title}</h1>
        </div>
        <button className="secondary-button" type="button" onClick={() => navigate('gameProfiles')}>
          <ArrowLeft size={18} aria-hidden="true" />
          <span>Back</span>
        </button>
      </div>

      <form className="form-grid" onSubmit={onSubmit}>
        {errors.form ? <div className="form-error">{errors.form}</div> : null}

        <section className="form-section">
          <h2>Identity</h2>
          <div className="field-grid">
            <TextInput
              label="Profile ID"
              name="gameId"
              value={form.gameId}
              error={errors.gameId}
              onChange={(event) => update('gameId', event.target.value)}
            />
            <TextInput
              label="Game Name"
              name="gameName"
              value={form.gameName}
              error={errors.gameName}
              onChange={(event) => update('gameName', event.target.value)}
            />
            <TextInput
              label="Version"
              name="version"
              value={form.version}
              error={errors.version}
              onChange={(event) => update('version', event.target.value)}
            />
            <TextInput
              label="Build"
              name="buildId"
              value={form.buildId}
              onChange={(event) => update('buildId', event.target.value)}
            />
            <SelectInput
              label="Engine Type"
              name="engineType"
              value={form.engineType}
              error={errors['engine.type']}
              onChange={(event) => update('engineType', event.target.value as EngineType)}
            >
              {engineOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectInput>
            <TextInput
              label="Engine Version"
              name="engineVersion"
              value={form.engineVersion}
              onChange={(event) => update('engineVersion', event.target.value)}
            />
          </div>
        </section>

        <section className="form-section">
          <h2>Launch</h2>
          <div className="field-grid">
            <SelectInput
              label="Platform"
              name="platform"
              value={form.platform}
              error={errors['launch.platform']}
              onChange={(event) => update('platform', event.target.value as LaunchPlatform)}
            >
              {platformOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectInput>
            <TextInput
              label="Executable Path"
              name="executablePath"
              value={form.executablePath}
              onChange={(event) => update('executablePath', event.target.value)}
            />
            <TextInput
              label="Working Directory"
              name="workingDirectory"
              value={form.workingDirectory}
              onChange={(event) => update('workingDirectory', event.target.value)}
            />
            <TextInput
              label="URL"
              name="url"
              value={form.url}
              error={errors['launch.url']}
              onChange={(event) => update('url', event.target.value)}
            />
            <TextareaInput
              label="Launch Arguments"
              name="launchArguments"
              value={form.launchArguments}
              onChange={(event) => update('launchArguments', event.target.value)}
            />
          </div>
        </section>

        <section className="form-section">
          <h2>Adapter</h2>
          <div className="field-grid">
            <SelectInput
              label="Adapter Type"
              name="adapterType"
              value={form.adapterType}
              error={errors['adapter.type']}
              onChange={(event) => update('adapterType', event.target.value as AdapterType)}
            >
              {adapterOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectInput>
            <div className="toggle-grid">
              <ToggleInput
                label="Multiple Instances"
                checked={form.supportsMultipleInstances}
                onChange={(event) => update('supportsMultipleInstances', event.target.checked)}
              />
              <ToggleInput
                label="Direct State Read"
                checked={form.supportsStateRead}
                onChange={(event) => update('supportsStateRead', event.target.checked)}
              />
              <ToggleInput
                label="Direct Actions"
                checked={form.supportsDirectActions}
                onChange={(event) => update('supportsDirectActions', event.target.checked)}
              />
              <ToggleInput
                label="Screenshots"
                checked={form.supportsScreenshots}
                onChange={(event) => update('supportsScreenshots', event.target.checked)}
              />
              <ToggleInput
                label="Video"
                checked={form.supportsVideo}
                onChange={(event) => update('supportsVideo', event.target.checked)}
              />
              <ToggleInput
                label="Save Isolation"
                checked={form.supportsSaveIsolation}
                onChange={(event) => update('supportsSaveIsolation', event.target.checked)}
              />
            </div>
          </div>
        </section>

        <div className="form-actions">
          <button className="primary-button" type="submit">
            <Save size={18} aria-hidden="true" />
            <span>Save Profile</span>
          </button>
          {validatedProfile ? <span className="success-text">Profile saved</span> : null}
        </div>
      </form>

      <section className="json-panel" aria-label="Game profile preview">
        <pre>{JSON.stringify(validatedProfile ?? preview, null, 2)}</pre>
      </section>
    </section>
  );
}
