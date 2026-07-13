import type {
  AdapterType,
  ControlBinding,
  EngineType,
  GameProfile,
  InstrumentationTransportType,
  KnownContent,
  LaunchPlatform,
  SaveIsolationMode
} from '@core/types';
import { GameProfileSchema } from '@core/types';
import { Activity, ArrowLeft, Play, Save } from 'lucide-react';
import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { GameProfileTestResult } from '../../../main/services/simulationService';
import type { DesktopAdapterDependencyReport } from '../../../../../../packages/adapters/src';
import { FieldLabel, SelectInput, TextareaInput, TextInput, ToggleInput } from '../components/FormFields';
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

const transportOptions: Array<{ value: InstrumentationTransportType; label: string }> = [
  { value: 'local-http', label: 'Local HTTP' },
  { value: 'local-websocket', label: 'Local WebSocket' },
  { value: 'local-file-bridge', label: 'Local file/socket bridge' },
  { value: 'plugin-bridge', label: 'Plugin bridge' }
];

const saveIsolationModeOptions: Array<{ value: SaveIsolationMode; label: string }> = [
  { value: 'none', label: 'No isolation' },
  { value: 'copy-directory', label: 'Copy seed save directory' },
  { value: 'temp-directory', label: 'Temporary directory' },
  { value: 'launch-argument-profile', label: 'Launch argument profile' },
  { value: 'environment-variable', label: 'Environment variable' },
  { value: 'adapter-managed', label: 'Adapter managed' }
];

type KnownContentEditorKey = keyof Pick<
  KnownContent,
  | 'scenes'
  | 'levels'
  | 'quests'
  | 'mainQuests'
  | 'sideQuests'
  | 'optionalStories'
  | 'npcs'
  | 'shops'
  | 'bosses'
  | 'items'
  | 'menus'
  | 'dialogueBranches'
  | 'minigames'
  | 'endings'
  | 'hiddenAreas'
  | 'postGameContent'
  | 'collectibles'
  | 'achievements'
  | 'notes'
>;

const knownContentFields: Array<{ key: KnownContentEditorKey; label: string }> = [
  { key: 'scenes', label: 'Scenes' },
  { key: 'levels', label: 'Levels' },
  { key: 'quests', label: 'Quests' },
  { key: 'mainQuests', label: 'Main Quests' },
  { key: 'sideQuests', label: 'Side Quests' },
  { key: 'optionalStories', label: 'Optional Stories' },
  { key: 'npcs', label: 'NPCs' },
  { key: 'shops', label: 'Shops' },
  { key: 'bosses', label: 'Bosses' },
  { key: 'items', label: 'Items' },
  { key: 'menus', label: 'Menus' },
  { key: 'dialogueBranches', label: 'Dialogue Branches' },
  { key: 'minigames', label: 'Minigames' },
  { key: 'endings', label: 'Endings' },
  { key: 'hiddenAreas', label: 'Hidden Areas' },
  { key: 'postGameContent', label: 'Post-Game Content' },
  { key: 'collectibles', label: 'Collectibles' },
  { key: 'achievements', label: 'Achievements' },
  { key: 'notes', label: 'Notes' }
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
  instrumentationEndpoint: string;
  instrumentationTransport: InstrumentationTransportType;
  browserName: string;
  controlMappings: string;
  supportsMultipleInstances: boolean;
  supportsStateRead: boolean;
  supportsDirectActions: boolean;
  supportsScreenshots: boolean;
  supportsVideo: boolean;
  supportsSaveIsolation: boolean;
  saveIsolationMode: SaveIsolationMode;
  sourceSavePath: string;
  workingSaveRoot: string;
  profileArgumentTemplate: string;
  environmentVariableName: string;
  cleanupTempSaves: boolean;
  preserveBotSaves: boolean;
  knownContent: Record<KnownContentEditorKey, string>;
}

interface ControlTestViewResult {
  status: string;
  message: string;
  launched: boolean;
  stopped: boolean;
  binding?: string;
}

type ProfileWizardKind = 'desktop' | 'instrumented' | 'engine' | 'browser' | 'custom';
type EngineWizardMode = 'instrumented' | 'desktop-fallback';
type CustomWizardMode = 'instrumented' | 'desktop-fallback' | 'custom-adapter';

const desktopAdapterTypes = new Set<AdapterType>(['desktop', 'rpg_maker', 'gamemaker']);
const engineAdapterTypes = new Set<AdapterType>(['unity', 'godot', 'unreal']);

const wizardOptions: Array<{ value: ProfileWizardKind; label: string }> = [
  { value: 'desktop', label: 'Desktop Game Wizard' },
  { value: 'instrumented', label: 'Instrumented Game Wizard' },
  { value: 'engine', label: 'Unity / Godot / Unreal Wizard' },
  { value: 'browser', label: 'Browser Game Wizard' },
  { value: 'custom', label: 'Custom Engine Wizard' }
];

const engineModeOptions: Array<{ value: EngineWizardMode; label: string }> = [
  { value: 'instrumented', label: 'Instrumented SDK' },
  { value: 'desktop-fallback', label: 'Desktop fallback' }
];

const customModeOptions: Array<{ value: CustomWizardMode; label: string }> = [
  { value: 'instrumented', label: 'Instrumented endpoint' },
  { value: 'desktop-fallback', label: 'Desktop fallback' },
  { value: 'custom-adapter', label: 'Custom adapter placeholder' }
];

function controlBindingText(binding: ControlBinding): string {
  const label = binding.label || binding.action || binding.controlId;

  return binding.binding ? `${label} = ${binding.binding}` : label;
}

function inputTypeForBinding(binding: string | undefined): ControlBinding['inputType'] {
  const normalized = binding?.trim().toLowerCase() ?? '';

  if (normalized.startsWith('mouse')) {
    return 'mouse';
  }

  if (normalized.startsWith('gamepad') || normalized.startsWith('controller')) {
    return 'gamepad';
  }

  if (normalized.startsWith('touch')) {
    return 'touch';
  }

  return 'keyboard';
}

function parseControlMappings(value: string): ControlBinding[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parts = line.split(/\s*(?:=|->|:)\s*/);
      const label = (parts[0] ?? '').trim();
      const binding = parts.slice(1).join(' ').trim() || undefined;
      const action = slugify(label) || `action-${index + 1}`;

      return {
        controlId: action,
        label: label || action,
        inputType: inputTypeForBinding(binding),
        binding,
        action,
        metadata: {}
      };
    });
}

function contentText(profile: GameProfile | undefined, key: KnownContentEditorKey): string {
  return (profile?.knownContent[key] ?? []).join('\n');
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
    instrumentationEndpoint: profile?.adapter.instrumentationEndpoint ?? '',
    instrumentationTransport: profile?.adapter.instrumentationTransport ?? 'local-http',
    browserName: profile?.adapter.browserName ?? '',
    controlMappings: profile?.controls.map(controlBindingText).join('\n') ?? '',
    supportsMultipleInstances: profile?.adapter.supportsMultipleInstances ?? false,
    supportsStateRead: profile?.adapter.supportsStateRead ?? false,
    supportsDirectActions: profile?.adapter.supportsDirectActions ?? false,
    supportsScreenshots: profile?.adapter.supportsScreenshots ?? true,
    supportsVideo: profile?.adapter.supportsVideo ?? false,
    supportsSaveIsolation: profile?.adapter.supportsSaveIsolation ?? false,
    saveIsolationMode: profile?.saveIsolation?.mode ?? 'none',
    sourceSavePath: profile?.saveIsolation?.sourceSavePath ?? '',
    workingSaveRoot: profile?.saveIsolation?.workingSaveRoot ?? '',
    profileArgumentTemplate: profile?.saveIsolation?.profileArgumentTemplate ?? '',
    environmentVariableName: profile?.saveIsolation?.environmentVariableName ?? '',
    cleanupTempSaves: profile?.saveIsolation?.cleanupTempSaves ?? false,
    preserveBotSaves: profile?.saveIsolation?.preserveBotSaves ?? true,
    knownContent: knownContentFields.reduce<Record<KnownContentEditorKey, string>>((content, field) => {
      content[field.key] = contentText(profile, field.key);
      return content;
    }, {} as Record<KnownContentEditorKey, string>)
  };
}

function wizardKindForForm(form: GameProfileFormState): ProfileWizardKind {
  if (form.adapterType === 'browser' || form.platform === 'browser' || form.engineType === 'browser') {
    return 'browser';
  }

  if (form.adapterType === 'instrumented') {
    return 'instrumented';
  }

  if (engineAdapterTypes.has(form.adapterType) || ['unity', 'godot', 'unreal'].includes(form.engineType)) {
    return 'engine';
  }

  if (form.adapterType === 'custom' || form.engineType === 'custom') {
    return 'custom';
  }

  return 'desktop';
}

function engineAdapterFromEngine(engineType: EngineType): AdapterType {
  return engineType === 'godot' || engineType === 'unreal' || engineType === 'unity' ? engineType : 'unity';
}

function recommendedDocsFor(form: GameProfileFormState): string {
  if (form.engineType === 'unity' || form.adapterType === 'unity') {
    return 'docs/adapters/unity.md';
  }

  if (form.engineType === 'godot' || form.adapterType === 'godot') {
    return 'docs/adapters/godot.md';
  }

  if (form.engineType === 'unreal' || form.adapterType === 'unreal') {
    return 'docs/adapters/unreal.md';
  }

  if (form.adapterType === 'browser') {
    return 'docs/adapters/browser.md';
  }

  if (desktopAdapterTypes.has(form.adapterType)) {
    return 'docs/adapters/desktop-window.md';
  }

  return 'docs/adapters/custom-engine.md';
}

function missingWizardFields(
  form: GameProfileFormState,
  wizardKind: ProfileWizardKind,
  engineMode: EngineWizardMode,
  customMode: CustomWizardMode,
  parsedControls: ControlBinding[]
): string[] {
  const missing: string[] = [];
  const needsDesktop =
    wizardKind === 'desktop' ||
    (wizardKind === 'engine' && engineMode === 'desktop-fallback') ||
    (wizardKind === 'custom' && customMode === 'desktop-fallback');
  const needsInstrumentation =
    wizardKind === 'instrumented' ||
    (wizardKind === 'engine' && engineMode === 'instrumented') ||
    (wizardKind === 'custom' && customMode === 'instrumented');

  if (!form.gameName.trim()) {
    missing.push('Add a game name so reports are easy to recognize.');
  }

  if (!form.version.trim()) {
    missing.push('Add a version, even if it is something simple like local-dev.');
  }

  if (needsDesktop && !optionalText(form.executablePath)) {
    missing.push('Add the executable path so the simulator can open the game.');
  }

  if (needsDesktop && parsedControls.length === 0) {
    missing.push('Add at least one control mapping, such as Jump = Space.');
  }

  if (needsInstrumentation && !optionalText(form.instrumentationEndpoint)) {
    missing.push('Add the instrumentation endpoint, such as http://127.0.0.1:4555.');
  }

  if (wizardKind === 'browser' && !optionalText(form.url)) {
    missing.push('Add the browser game URL so Playwright can open the page.');
  }

  if (wizardKind === 'custom' && customMode === 'custom-adapter') {
    missing.push('Custom adapters are placeholders. Use instrumentation or desktop fallback for real testing today.');
  }

  return missing;
}

function buildProfile(form: GameProfileFormState): GameProfile {
  const gameId = optionalText(form.gameId) ?? slugify(form.gameName);
  const knownContent = knownContentFields.reduce<Record<KnownContentEditorKey, string[]>>((content, field) => {
    content[field.key] = splitArguments(form.knownContent[field.key]);
    return content;
  }, {} as Record<KnownContentEditorKey, string[]>);

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
      supportsSaveIsolation: form.supportsSaveIsolation,
      instrumentationEndpoint: optionalText(form.instrumentationEndpoint),
      instrumentationTransport: form.instrumentationTransport,
      browserName: optionalText(form.browserName)
    },
    controls: parseControlMappings(form.controlMappings),
    testingTargets: [],
    progressSignals: [],
    failureSignals: [],
    saveIsolation: {
      mode: form.saveIsolationMode,
      sourceSavePath: optionalText(form.sourceSavePath),
      workingSaveRoot: optionalText(form.workingSaveRoot),
      profileArgumentTemplate: optionalText(form.profileArgumentTemplate),
      environmentVariableName: optionalText(form.environmentVariableName),
      cleanupTempSaves: form.cleanupTempSaves,
      preserveBotSaves: form.preserveBotSaves
    },
    knownContent: {
      ...knownContent,
      locations: knownContent.scenes,
      characters: knownContent.npcs,
      quests: [...new Set([...knownContent.quests, ...knownContent.mainQuests, ...knownContent.sideQuests])],
      mechanics: []
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
  const [desktopDependencies, setDesktopDependencies] = useState<DesktopAdapterDependencyReport | null>(null);
  const [desktopDependencyError, setDesktopDependencyError] = useState<string | null>(null);
  const [controlToTest, setControlToTest] = useState('');
  const [controlTestResult, setControlTestResult] = useState<ControlTestViewResult | null>(null);
  const [wizardKind, setWizardKind] = useState<ProfileWizardKind>(() => wizardKindForForm(form));
  const [engineMode, setEngineModeState] = useState<EngineWizardMode>(() =>
    optionalText(form.instrumentationEndpoint) ? 'instrumented' : 'desktop-fallback'
  );
  const [customMode, setCustomModeState] = useState<CustomWizardMode>(() =>
    form.adapterType === 'instrumented'
      ? 'instrumented'
      : desktopAdapterTypes.has(form.adapterType)
        ? 'desktop-fallback'
        : 'custom-adapter'
  );
  const [profileTestResult, setProfileTestResult] = useState<GameProfileTestResult | null>(null);
  const [profileTestError, setProfileTestError] = useState<string | null>(null);
  const [profileTestRunning, setProfileTestRunning] = useState(false);
  const title = existingProfile ? 'Edit Game Profile' : 'New Game Profile';

  const preview = useMemo(() => {
    try {
      return buildProfile(form);
    } catch {
      return null;
    }
  }, [form]);
  const parsedControls = useMemo(() => parseControlMappings(form.controlMappings), [form.controlMappings]);
  const usesDesktopRuntime =
    desktopAdapterTypes.has(form.adapterType) ||
    (engineAdapterTypes.has(form.adapterType) && !optionalText(form.instrumentationEndpoint));
  const usesBrowserRuntime = form.adapterType === 'browser';
  const wizardMissingFields = useMemo(
    () => missingWizardFields(form, wizardKind, engineMode, customMode, parsedControls),
    [customMode, engineMode, form, parsedControls, wizardKind]
  );

  useEffect(() => {
    let cancelled = false;

    if (!usesDesktopRuntime) {
      setDesktopDependencies(null);
      setDesktopDependencyError(null);
      return;
    }

    window.gameplaySimulator.simulation
      .getDesktopAdapterDependencies()
      .then((report) => {
        if (!cancelled) {
          setDesktopDependencies(report);
          setDesktopDependencyError(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDesktopDependencies(null);
          setDesktopDependencyError('Desktop dependency check is unavailable.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [usesDesktopRuntime]);

  useEffect(() => {
    if (!controlToTest && parsedControls[0]) {
      setControlToTest(parsedControls[0].controlId);
    }
  }, [controlToTest, parsedControls]);

  function update<K extends keyof GameProfileFormState>(key: K, value: GameProfileFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setProfileTestResult(null);
    setProfileTestError(null);
  }

  function applyWizard(kind: ProfileWizardKind) {
    setWizardKind(kind);
    setProfileTestResult(null);
    setProfileTestError(null);
    setForm((current) => {
      if (kind === 'desktop') {
        return {
          ...current,
          adapterType: 'desktop',
          platform: current.platform === 'browser' ? 'windows' : current.platform,
          engineType: current.engineType === 'browser' ? 'unknown' : current.engineType,
          supportsStateRead: false,
          supportsDirectActions: false,
          supportsScreenshots: true
        };
      }

      if (kind === 'instrumented') {
        return {
          ...current,
          adapterType: 'instrumented',
          supportsStateRead: true,
          supportsDirectActions: true,
          supportsScreenshots: true,
          supportsVideo: true,
          supportsSaveIsolation: true
        };
      }

      if (kind === 'engine') {
        const engineType: EngineType = ['unity', 'godot', 'unreal'].includes(current.engineType)
          ? current.engineType
          : 'unity';
        const adapterType = engineAdapterFromEngine(engineType);

        return {
          ...current,
          engineType,
          adapterType,
          platform: current.platform === 'browser' ? 'windows' : current.platform,
          supportsStateRead: engineMode === 'instrumented',
          supportsDirectActions: engineMode === 'instrumented',
          supportsScreenshots: true
        };
      }

      if (kind === 'browser') {
        return {
          ...current,
          engineType: 'browser',
          adapterType: 'browser',
          platform: 'browser',
          supportsMultipleInstances: true,
          supportsStateRead: current.supportsStateRead,
          supportsDirectActions: current.supportsDirectActions,
          supportsScreenshots: true,
          supportsVideo: false,
          supportsSaveIsolation: true
        };
      }

      return {
        ...current,
        engineType: 'custom',
        adapterType: customMode === 'instrumented' ? 'instrumented' : customMode === 'desktop-fallback' ? 'desktop' : 'custom',
        supportsStateRead: customMode === 'instrumented',
        supportsDirectActions: customMode === 'instrumented',
        supportsScreenshots: customMode !== 'custom-adapter'
      };
    });
  }

  function updateEngineMode(mode: EngineWizardMode) {
    setEngineModeState(mode);
    setProfileTestResult(null);
    setProfileTestError(null);
    setForm((current) => {
      const engineType: EngineType = ['unity', 'godot', 'unreal'].includes(current.engineType)
        ? current.engineType
        : 'unity';

      return {
        ...current,
        engineType,
        adapterType: engineAdapterFromEngine(engineType),
        supportsStateRead: mode === 'instrumented',
        supportsDirectActions: mode === 'instrumented',
        supportsScreenshots: true
      };
    });
  }

  function updateCustomMode(mode: CustomWizardMode) {
    setCustomModeState(mode);
    setProfileTestResult(null);
    setProfileTestError(null);
    setForm((current) => ({
      ...current,
      adapterType: mode === 'instrumented' ? 'instrumented' : mode === 'desktop-fallback' ? 'desktop' : 'custom',
      supportsStateRead: mode === 'instrumented',
      supportsDirectActions: mode === 'instrumented',
      supportsScreenshots: mode !== 'custom-adapter'
    }));
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

  async function testControl() {
    const profileResult = GameProfileSchema.safeParse(buildProfile(form));

    if (!profileResult.success) {
      setErrors(zodFieldErrors(profileResult.error));
      setControlTestResult({
        status: 'failed',
        message: 'Fix the game profile fields before testing a control.',
        launched: false,
        stopped: false
      });
      return;
    }

    const selectedControlId = controlToTest || parsedControls[0]?.controlId;

    try {
      const result = await window.gameplaySimulator.simulation.testDesktopControl({
        gameProfile: profileResult.data,
        controlId: selectedControlId
      });

      setControlTestResult({
        status: result.actionResult.status,
        message: result.actionResult.message ?? 'Control test finished.',
        launched: result.launched,
        stopped: result.stopped,
        binding: result.binding
      });
      setDesktopDependencies(result.dependencyReport);
    } catch (error) {
      setControlTestResult({
        status: 'failed',
        message: error instanceof Error ? error.message : 'Control test failed.',
        launched: false,
        stopped: false
      });
    }
  }

  async function testGameProfile() {
    const profileResult = GameProfileSchema.safeParse(buildProfile(form));

    if (!profileResult.success) {
      setErrors(zodFieldErrors(profileResult.error));
      setProfileTestResult(null);
      setProfileTestError('Fix the highlighted game profile fields before testing.');
      return;
    }

    setProfileTestRunning(true);
    setProfileTestResult(null);
    setProfileTestError(null);
    setErrors({});

    try {
      const result = await window.gameplaySimulator.simulation.testGameProfile({
        gameProfile: profileResult.data
      });
      setProfileTestResult(result);

      if (result.desktopDependencies) {
        setDesktopDependencies(result.desktopDependencies);
      }
    } catch (error) {
      setProfileTestError(error instanceof Error ? error.message : 'Profile test failed.');
    } finally {
      setProfileTestRunning(false);
    }
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
          <div className="section-header-row">
            <div>
              <h2>Guided Setup</h2>
              <p className="form-hint">Choose the flow that matches how this game can be tested.</p>
            </div>
            <div className="wizard-status">
              <FieldLabel label="Profile Readiness" />
              <strong>{wizardMissingFields.length === 0 ? 'Ready to test' : `${wizardMissingFields.length} item${wizardMissingFields.length === 1 ? '' : 's'} left`}</strong>
            </div>
          </div>

          <div className="field-grid">
            <SelectInput
              label="Setup Wizard"
              name="setupWizard"
              value={wizardKind}
              onChange={(event) => applyWizard(event.target.value as ProfileWizardKind)}
            >
              {wizardOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectInput>
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
          </div>

          {wizardMissingFields.length > 0 ? (
            <div className="notice-list notice-list--warning">
              <FieldLabel label="Missing Fields" />
              {wizardMissingFields.map((message) => (
                <span key={message}>{message}</span>
              ))}
            </div>
          ) : null}

          {wizardKind === 'desktop' ? (
            <div className="wizard-panel">
              <h3>Desktop Game Wizard</h3>
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
                <TextareaInput
                  label="Launch Arguments"
                  name="launchArguments"
                  value={form.launchArguments}
                  onChange={(event) => update('launchArguments', event.target.value)}
                />
                <TextareaInput
                  label="Control Mappings"
                  name="controlMappings"
                  value={form.controlMappings}
                  onChange={(event) => update('controlMappings', event.target.value)}
                />
              </div>
            </div>
          ) : null}

          {wizardKind === 'instrumented' ? (
            <div className="wizard-panel">
              <h3>Instrumented Game Wizard</h3>
              <div className="field-grid">
                <TextInput
                  label="Instrumentation Endpoint"
                  name="instrumentationEndpoint"
                  value={form.instrumentationEndpoint}
                  error={errors['adapter.instrumentationEndpoint']}
                  onChange={(event) => update('instrumentationEndpoint', event.target.value)}
                />
                <SelectInput
                  label="Transport Type"
                  name="instrumentationTransport"
                  value={form.instrumentationTransport}
                  onChange={(event) =>
                    update('instrumentationTransport', event.target.value as InstrumentationTransportType)
                  }
                >
                  {transportOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </SelectInput>
              </div>
            </div>
          ) : null}

          {wizardKind === 'engine' ? (
            <div className="wizard-panel">
              <h3>Unity / Godot / Unreal Wizard</h3>
              <div className="field-grid">
                <SelectInput
                  label="Engine Type"
                  name="engineTypeWizard"
                  value={form.engineType}
                  onChange={(event) => {
                    const engineType = event.target.value as EngineType;
                    update('engineType', engineType);
                    update('adapterType', engineAdapterFromEngine(engineType));
                  }}
                >
                  {engineOptions
                    .filter((option) => ['unity', 'godot', 'unreal'].includes(option.value))
                    .map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                </SelectInput>
                <TextInput
                  label="Engine Version"
                  name="engineVersionWizard"
                  value={form.engineVersion}
                  onChange={(event) => update('engineVersion', event.target.value)}
                />
                <SelectInput
                  label="Engine Test Mode"
                  name="engineMode"
                  value={engineMode}
                  onChange={(event) => updateEngineMode(event.target.value as EngineWizardMode)}
                >
                  {engineModeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </SelectInput>
                {engineMode === 'instrumented' ? (
                  <TextInput
                    label="Instrumentation Endpoint"
                    name="engineInstrumentationEndpoint"
                    value={form.instrumentationEndpoint}
                    error={errors['adapter.instrumentationEndpoint']}
                    onChange={(event) => update('instrumentationEndpoint', event.target.value)}
                  />
                ) : (
                  <>
                    <TextInput
                      label="Executable Path"
                      name="engineExecutablePath"
                      value={form.executablePath}
                      onChange={(event) => update('executablePath', event.target.value)}
                    />
                    <TextareaInput
                      label="Control Mappings"
                      name="engineControlMappings"
                      value={form.controlMappings}
                      onChange={(event) => update('controlMappings', event.target.value)}
                    />
                  </>
                )}
              </div>
              <div className="notice-list">
                <FieldLabel label="Recommended Integration Docs" />
                <span>{recommendedDocsFor(form)}</span>
              </div>
            </div>
          ) : null}

          {wizardKind === 'browser' ? (
            <div className="wizard-panel">
              <h3>Browser Game Wizard</h3>
              <div className="field-grid">
                <TextInput
                  label="Game URL"
                  name="url"
                  value={form.url}
                  error={errors['launch.url']}
                  onChange={(event) => update('url', event.target.value)}
                />
                <TextInput
                  label="Browser Type"
                  name="browserName"
                  value={form.browserName}
                  onChange={(event) => update('browserName', event.target.value)}
                />
                <TextareaInput
                  label="Control Mappings"
                  name="browserControlMappings"
                  value={form.controlMappings}
                  onChange={(event) => update('controlMappings', event.target.value)}
                />
              </div>
              <div className="adapter-readiness">
                <h3>Browser Adapter Readiness</h3>
                <div className="metric-grid">
                  <div className="metric-card">
                    <FieldLabel label="Browser Context" />
                    <strong>One per instance</strong>
                  </div>
                  <div className="metric-card">
                    <FieldLabel label="Read Browser Game State" />
                    <strong>Hook first</strong>
                  </div>
                  <div className="metric-card">
                    <FieldLabel label="Capture Console Errors" />
                    <strong>On</strong>
                  </div>
                  <div className="metric-card">
                    <FieldLabel label="Capture Page Errors" />
                    <strong>On</strong>
                  </div>
                  <div className="metric-card">
                    <FieldLabel label="Use Keyboard Input" />
                    <strong>Mapped or generic</strong>
                  </div>
                  <div className="metric-card">
                    <FieldLabel label="Use Mouse Input" />
                    <strong>Mapped or generic</strong>
                  </div>
                  <div className="metric-card">
                    <FieldLabel label="Reload Page" />
                    <strong>Available</strong>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {wizardKind === 'custom' ? (
            <div className="wizard-panel">
              <h3>Custom Engine Wizard</h3>
              <div className="field-grid">
                <SelectInput
                  label="Custom Test Method"
                  name="customMode"
                  value={customMode}
                  onChange={(event) => updateCustomMode(event.target.value as CustomWizardMode)}
                >
                  {customModeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </SelectInput>
                {customMode === 'instrumented' ? (
                  <TextInput
                    label="Instrumentation Endpoint"
                    name="customInstrumentationEndpoint"
                    value={form.instrumentationEndpoint}
                    error={errors['adapter.instrumentationEndpoint']}
                    onChange={(event) => update('instrumentationEndpoint', event.target.value)}
                  />
                ) : null}
                {customMode === 'desktop-fallback' ? (
                  <>
                    <TextInput
                      label="Executable Path"
                      name="customExecutablePath"
                      value={form.executablePath}
                      onChange={(event) => update('executablePath', event.target.value)}
                    />
                    <TextareaInput
                      label="Control Mappings"
                      name="customControlMappings"
                      value={form.controlMappings}
                      onChange={(event) => update('controlMappings', event.target.value)}
                    />
                  </>
                ) : null}
              </div>
              <div className="notice-list notice-list--warning">
                <FieldLabel label="Adapter Limitations" />
                <span>Custom adapter plugins are placeholders in this build. Instrumentation or desktop fallback is the safest real setup today.</span>
              </div>
            </div>
          ) : null}

          {usesDesktopRuntime ? (
            <div className="adapter-readiness desktop-readiness">
              <h3>Desktop Adapter Readiness</h3>
              {desktopDependencyError ? <div className="form-error">{desktopDependencyError}</div> : null}
              {desktopDependencies ? (
                <>
                  <div className="metric-grid">
                    <div className="metric-card">
                      <FieldLabel label="Input Support Check" />
                      <strong>{desktopDependencies.inputDriverAvailable ? 'Available' : 'Missing'}</strong>
                    </div>
                    <div className="metric-card">
                      <FieldLabel label="Screenshot Support Check" />
                      <strong>{desktopDependencies.screenshotTool ?? 'Missing'}</strong>
                    </div>
                    <div className="metric-card">
                      <FieldLabel label="Focus Window" />
                      <strong>{desktopDependencies.canFocusWindow ? 'Available' : 'Unavailable'}</strong>
                    </div>
                    <div className="metric-card">
                      <FieldLabel label="Keyboard Input" />
                      <strong>{desktopDependencies.canSendKeyboardInput ? 'Available' : 'Unavailable'}</strong>
                    </div>
                    <div className="metric-card">
                      <FieldLabel label="Mouse Input" />
                      <strong>{desktopDependencies.canSendMouseInput ? 'Available' : 'Unavailable'}</strong>
                    </div>
                  </div>
                  {desktopDependencies.warnings.length > 0 ? (
                    <div className="notice-list notice-list--warning">
                      <strong>Desktop warnings</strong>
                      {desktopDependencies.warnings.map((warning) => (
                        <span key={warning}>{warning}</span>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}
              <div className="field-grid">
                <SelectInput
                  label="Test Control"
                  name="testControl"
                  value={controlToTest}
                  disabled={parsedControls.length === 0}
                  onChange={(event) => setControlToTest(event.target.value)}
                >
                  {parsedControls.length === 0 ? <option value="">No controls mapped</option> : null}
                  {parsedControls.map((control) => (
                    <option key={control.controlId} value={control.controlId}>
                      {control.label} {control.binding ? `(${control.binding})` : ''}
                    </option>
                  ))}
                </SelectInput>
              </div>
              <div className="form-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={parsedControls.length === 0}
                  onClick={testControl}
                >
                  <Activity size={18} aria-hidden="true" />
                  <span>Test Control</span>
                </button>
                {controlTestResult ? (
                  <span className={controlTestResult.status === 'succeeded' ? 'success-text' : 'form-hint'}>
                    {controlTestResult.status}: {controlTestResult.message}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="wizard-test-card">
            <div>
              <FieldLabel
                label={wizardKind === 'browser' ? 'Page Launch Test' : wizardKind === 'instrumented' ? 'Health Check' : 'Test Launch'}
              />
              <p className="form-hint">
                {wizardKind === 'browser'
                  ? 'Open the page with Playwright, capture console/page errors, then close it.'
                  : wizardKind === 'instrumented'
                    ? 'Ask the local game endpoint if it is alive and what it supports.'
                    : 'Launch or connect through the selected adapter, read health, then clean up.'}
              </p>
            </div>
            <button className="primary-button" type="button" disabled={profileTestRunning} onClick={testGameProfile}>
              <Play size={18} aria-hidden="true" />
              <span>{profileTestRunning ? 'Testing...' : 'Test Profile'}</span>
            </button>
          </div>

          {profileTestError ? <div className="form-error">{profileTestError}</div> : null}
          {profileTestResult ? (
            <div className={profileTestResult.ok ? 'profile-test-result profile-test-result--ok' : 'profile-test-result profile-test-result--failed'}>
              <div className="metric-grid metric-grid--session">
                <div className="metric-card">
                  <FieldLabel label="Test Result" />
                  <strong>{profileTestResult.status}</strong>
                </div>
                <div className="metric-card">
                  <FieldLabel label="Adapter Runtime" />
                  <strong>{profileTestResult.runtimeMode}</strong>
                </div>
                <div className="metric-card">
                  <FieldLabel label="Game/Engine/Build" />
                  <strong>{profileTestResult.detectedGame?.gameName ?? (form.gameName || 'Unknown')}</strong>
                </div>
                <div className="metric-card">
                  <FieldLabel label="Instance health check" />
                  <strong>{profileTestResult.health?.status ?? (profileTestResult.ok ? 'ready' : 'failed')}</strong>
                </div>
              </div>
              <p className={profileTestResult.ok ? 'success-text' : 'form-error'}>{profileTestResult.message}</p>
              {profileTestResult.errors.length > 0 ? (
                <div className="notice-list notice-list--blocker">
                  <FieldLabel label="Missing Fields" />
                  {profileTestResult.errors.map((error) => (
                    <span key={`${error.path}-${error.message}`}>{error.path}: {error.message}</span>
                  ))}
                </div>
              ) : null}
              {profileTestResult.warnings.length > 0 ? (
                <div className="notice-list notice-list--warning">
                  <FieldLabel label="Adapter Limitations" />
                  {profileTestResult.warnings.map((warning) => (
                    <span key={`${warning.path}-${warning.message}`}>{warning.path}: {warning.message}</span>
                  ))}
                </div>
              ) : null}
              <div className="wizard-result-grid">
                <div className="notice-list">
                  <FieldLabel label="Supported Capabilities" />
                  {profileTestResult.capabilities.map((capability) => (
                    <span key={capability.label}>{capability.supported ? 'Yes' : 'No'}: {capability.label}</span>
                  ))}
                </div>
                <div className="notice-list">
                  <FieldLabel label="Available Actions Preview" />
                  {profileTestResult.availableActions.length > 0 ? (
                    profileTestResult.availableActions.map((actionName) => <span key={actionName}>{actionName}</span>)
                  ) : (
                    <span>No actions were reported yet.</span>
                  )}
                </div>
                {usesBrowserRuntime ? (
                  <div className="notice-list">
                    <FieldLabel label="Console Error Capture Preview" />
                    {profileTestResult.logs.length > 0 ? (
                      profileTestResult.logs.map((log, index) => (
                        <span key={`${log.level}-${index}`}>{log.level}: {log.message}</span>
                      ))
                    ) : (
                      <span>No console or page errors were captured during the test.</span>
                    )}
                  </div>
                ) : null}
                {profileTestResult.screenshotPath ? (
                  <div className="notice-list">
                    <FieldLabel label="Screenshot Evidence" />
                    <span>{profileTestResult.screenshotPath}</span>
                  </div>
                ) : null}
              </div>
              {profileTestResult.stateSummary ? (
                <section className="json-panel" aria-label="Profile test state preview">
                  <FieldLabel label="State Preview" />
                  <pre>{profileTestResult.stateSummary}</pre>
                </section>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="form-section">
          <h2>Adapter Capabilities</h2>
          <div className="toggle-grid">
            <ToggleInput
              label="Supports Multiple Instances"
              checked={form.supportsMultipleInstances}
              onChange={(event) => update('supportsMultipleInstances', event.target.checked)}
            />
            <ToggleInput
              label="Supports State Read"
              checked={form.supportsStateRead}
              onChange={(event) => update('supportsStateRead', event.target.checked)}
            />
            <ToggleInput
              label="Supports Direct Actions"
              checked={form.supportsDirectActions}
              onChange={(event) => update('supportsDirectActions', event.target.checked)}
            />
            <ToggleInput
              label="Supports Screenshots"
              helpText="This says the adapter can take pictures of the game. The simulator uses it to attach proof when bots find issues. For example, a desktop adapter may capture the game window. If this is wrong, screenshot evidence may fail. Beginners should turn it on only if screenshots work for this game."
              checked={form.supportsScreenshots}
              onChange={(event) => update('supportsScreenshots', event.target.checked)}
            />
            <ToggleInput
              label="Supports Video"
              helpText="This says the adapter can record video of the game. The simulator uses it when you ask for video evidence. For example, an instrumented or browser adapter may support recording. If this is wrong, video capture may fail. Beginners can leave it off."
              checked={form.supportsVideo}
              onChange={(event) => update('supportsVideo', event.target.checked)}
            />
            <ToggleInput
              label="Supports Save Isolation"
              checked={form.supportsSaveIsolation}
              onChange={(event) => {
                const enabled = event.target.checked;
                update('supportsSaveIsolation', enabled);
                if (!enabled) {
                  update('saveIsolationMode', 'none');
                } else if (form.saveIsolationMode === 'none') {
                  update('saveIsolationMode', 'temp-directory');
                }
              }}
            />
          </div>
        </section>

        <section className="form-section">
          <h2>Save Isolation</h2>
          <div className="field-grid">
            <SelectInput
              label="Save Isolation Mode"
              name="saveIsolationMode"
              value={form.saveIsolationMode}
              error={errors['saveIsolation.mode']}
              onChange={(event) => {
                const mode = event.target.value as SaveIsolationMode;
                update('saveIsolationMode', mode);
                update('supportsSaveIsolation', mode !== 'none');
              }}
            >
              {saveIsolationModeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectInput>
            <TextInput
              label="Source Save Path"
              name="sourceSavePath"
              value={form.sourceSavePath}
              error={errors['saveIsolation.sourceSavePath']}
              disabled={form.saveIsolationMode !== 'copy-directory'}
              onChange={(event) => update('sourceSavePath', event.target.value)}
            />
            <TextInput
              label="Working Save Root"
              name="workingSaveRoot"
              value={form.workingSaveRoot}
              error={errors['saveIsolation.workingSaveRoot']}
              disabled={form.saveIsolationMode === 'none' || form.saveIsolationMode === 'adapter-managed'}
              onChange={(event) => update('workingSaveRoot', event.target.value)}
            />
            <TextInput
              label="Profile Argument Template"
              name="profileArgumentTemplate"
              value={form.profileArgumentTemplate}
              error={errors['saveIsolation.profileArgumentTemplate']}
              disabled={form.saveIsolationMode !== 'launch-argument-profile'}
              onChange={(event) => update('profileArgumentTemplate', event.target.value)}
            />
            <TextInput
              label="Environment Variable Name"
              name="environmentVariableName"
              value={form.environmentVariableName}
              error={errors['saveIsolation.environmentVariableName']}
              disabled={form.saveIsolationMode !== 'environment-variable'}
              onChange={(event) => update('environmentVariableName', event.target.value)}
            />
          </div>
          <div className="toggle-grid">
            <ToggleInput
              label="Cleanup Temp Saves"
              checked={form.cleanupTempSaves}
              disabled={form.saveIsolationMode !== 'temp-directory' || form.preserveBotSaves}
              onChange={(event) => update('cleanupTempSaves', event.target.checked)}
            />
            <ToggleInput
              label="Preserve Bot Saves"
              checked={form.preserveBotSaves}
              disabled={form.saveIsolationMode === 'none'}
              onChange={(event) => update('preserveBotSaves', event.target.checked)}
            />
          </div>
          <div className={form.saveIsolationMode === 'none' ? 'notice-list notice-list--warning' : 'notice-list'}>
            <FieldLabel label="Shared Save Warning" />
            <span>
              {form.saveIsolationMode === 'none'
                ? 'Multiple bots or game instances may share the same save/profile data.'
                : 'Each launched game instance will receive its own save/profile information when the adapter starts it.'}
            </span>
          </div>
        </section>

        <section className="form-section">
          <h2>Known Content</h2>
          <div className="field-grid">
            {knownContentFields.map((field) => (
              <TextareaInput
                key={field.key}
                label={field.label}
                name={`knownContent.${field.key}`}
                value={form.knownContent[field.key]}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    knownContent: {
                      ...current.knownContent,
                      [field.key]: event.target.value
                    }
                  }))
                }
              />
            ))}
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
