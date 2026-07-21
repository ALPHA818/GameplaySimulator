import type {
  BotLaunchPlan,
  BotProfile,
  BotPoolConfig,
  GameProfile,
  RunMode,
  RuntimeViabilityReport,
  SessionLabel,
  SimulationRunConfig
} from '@core/types';
import { SimulationRunConfigSchema } from '@core/types';
import { resolveBotPools } from '@core/bot/BotPoolResolver';
import {
  firstTestTemplates,
  isFirstTestTemplateCompatible,
  recommendedFirstTestTemplate
} from '@core/config/firstTestTemplates';
import type { FirstTestTemplate, FirstTestTemplateId } from '@core/config/firstTestTemplates';
import { planGameInstances } from '@core/sessions/GameInstanceManager';
import { Pause, Play, Plus, RotateCw, ShieldCheck, Square, Trash2 } from 'lucide-react';
import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { FieldLabel, SelectInput, TextInput, ToggleInput } from '../components/FormFields';
import { createBotPoolFromProfile, createDefaultBotPools, useConfigStore } from '../store/configStore';
import { useSessionStore } from '../store/sessionStore';
import type { FieldErrors } from '../utils/forms';
import { optionalText, zodFieldErrors } from '../utils/forms';

interface RunFormState {
  sessionId: string;
  sessionLabel: SessionLabel;
  gameProfileId: string;
  runMode: RunMode;
  runUntilStopped: boolean;
  maxRuntimeMinutes: string;
  stopOnCriticalIssue: boolean;
  saveScreenshots: boolean;
  saveVideo: boolean;
  screenshotEveryNActions: string;
  startupFlowId: string;
  continueOnStartupFlowFailure: boolean;
  startupFlowTimeoutSeconds: string;
  saveActionTimeline: boolean;
  saveStateSnapshots: boolean;
  botPools: BotPoolConfig[];
  globalBotLimit: number;
  perGameInstanceBotLimit: number;
  actionDelayMs: number;
  maxActionsPerBot: string;
  maxCpuPercent: number;
  maxRamPercent: number;
  maxGpuPercent: string;
  reserveRamMb: number;
  maxGameInstances: number;
  allowAutoScaling: boolean;
}

const runModes: Array<{ value: RunMode; label: string }> = [
  { value: 'parallel', label: 'Parallel' },
  { value: 'sequential', label: 'Sequential' },
  { value: 'hybrid', label: 'Hybrid' }
];

const sessionLabels: SessionLabel[] = ['Smoke Test', 'Regression', 'UI Flow', 'Stress Test', 'Custom'];

function botPoolForTemplate(template: FirstTestTemplate, botProfiles: BotProfile[]): BotPoolConfig | null {
  const profile = botProfiles.find((item) => item.profileId === template.botProfileId);

  if (!profile) {
    return null;
  }

  return {
    profileId: profile.profileId,
    enabled: true,
    minCount: 1,
    desiredCount: 1,
    maxCount: 1,
    scalingMode: 'fixed',
    priority: 100,
    resourceWeight: template.resourceWeight,
    notes: `Applied by ${template.name}.`
  };
}

function applyTemplateToForm(
  current: RunFormState,
  template: FirstTestTemplate,
  gameProfile: GameProfile,
  botProfiles: BotProfile[]
): RunFormState | null {
  const botPool = botPoolForTemplate(template, botProfiles);

  if (!botPool) {
    return null;
  }

  const screenshotsEnabled =
    template.saveScreenshots === 'on' || gameProfile.adapter.supportsScreenshots;
  const startupFlowId = template.recommendStartupFlow ? (gameProfile.uiFlows[0]?.flowId ?? '') : '';

  return {
    ...current,
    sessionLabel: 'Smoke Test',
    gameProfileId: gameProfile.gameId,
    runMode: 'sequential',
    runUntilStopped: false,
    maxRuntimeMinutes: '15',
    stopOnCriticalIssue: true,
    saveScreenshots: screenshotsEnabled,
    saveVideo: false,
    screenshotEveryNActions: screenshotsEnabled ? String(template.actionCount) : '',
    startupFlowId,
    continueOnStartupFlowFailure: false,
    startupFlowTimeoutSeconds: '60',
    saveActionTimeline: true,
    saveStateSnapshots: template.saveStateSnapshots,
    botPools: [botPool],
    globalBotLimit: 1,
    perGameInstanceBotLimit: 1,
    actionDelayMs: template.actionDelayMs,
    maxActionsPerBot: String(template.actionCount),
    maxCpuPercent: 70,
    maxRamPercent: 70,
    maxGpuPercent: '75',
    reserveRamMb: 2048,
    maxGameInstances: 1,
    allowAutoScaling: false
  };
}

function initialRunFormState(gameProfile: GameProfile | undefined, botProfiles: BotProfile[]): RunFormState {
  const base: RunFormState = {
    sessionId: `session-${Date.now()}`,
    sessionLabel: 'Smoke Test',
    gameProfileId: gameProfile?.gameId ?? '',
    runMode: 'sequential',
    runUntilStopped: false,
    maxRuntimeMinutes: '15',
    stopOnCriticalIssue: true,
    saveScreenshots: gameProfile?.adapter.supportsScreenshots ?? true,
    saveVideo: false,
    screenshotEveryNActions: '20',
    startupFlowId: '',
    continueOnStartupFlowFailure: false,
    startupFlowTimeoutSeconds: '60',
    saveActionTimeline: true,
    saveStateSnapshots: false,
    botPools: [],
    globalBotLimit: 1,
    perGameInstanceBotLimit: 1,
    actionDelayMs: 650,
    maxActionsPerBot: '20',
    maxCpuPercent: 70,
    maxRamPercent: 70,
    maxGpuPercent: '75',
    reserveRamMb: 2048,
    maxGameInstances: 1,
    allowAutoScaling: false
  };
  const template = gameProfile ? recommendedFirstTestTemplate(gameProfile) : undefined;

  if (!gameProfile || !template) {
    return {
      ...base,
      botPools: createDefaultBotPools(botProfiles).slice(0, 1).map((pool) => ({
        ...pool,
        minCount: 1,
        desiredCount: 1,
        maxCount: 1,
        scalingMode: 'fixed'
      }))
    };
  }

  return applyTemplateToForm(base, template, gameProfile, botProfiles) ?? base;
}

function numericInput(value: string): number {
  return value === '' ? 0 : Number(value);
}

function buildRunConfig(form: RunFormState, adapterType: SimulationRunConfig['adapterType']): SimulationRunConfig {
  return {
    sessionId: form.sessionId.trim(),
    sessionLabel: form.sessionLabel,
    gameProfilePath: `memory://game-profiles/${form.gameProfileId}`,
    adapterType,
    runMode: form.runMode,
    runUntilStopped: form.runUntilStopped,
    maxRuntimeMinutes: optionalText(form.maxRuntimeMinutes)
      ? Number(form.maxRuntimeMinutes)
      : undefined,
    stopOnCriticalIssue: form.stopOnCriticalIssue,
    saveScreenshots: form.saveScreenshots,
    saveVideo: form.saveVideo,
    screenshotEveryNActions: optionalText(form.screenshotEveryNActions)
      ? Number(form.screenshotEveryNActions)
      : undefined,
    startupFlowId: optionalText(form.startupFlowId),
    continueOnStartupFlowFailure: form.continueOnStartupFlowFailure,
    startupFlowTimeoutMs: optionalText(form.startupFlowTimeoutSeconds)
      ? Math.max(1, Number(form.startupFlowTimeoutSeconds)) * 1000
      : undefined,
    saveActionTimeline: form.saveActionTimeline,
    saveStateSnapshots: form.saveStateSnapshots,
    botPools: form.botPools,
    globalBotLimit: form.globalBotLimit,
    perGameInstanceBotLimit: form.perGameInstanceBotLimit,
    actionDelayMs: form.actionDelayMs,
    maxActionsPerBot: optionalText(form.maxActionsPerBot) ? Number(form.maxActionsPerBot) : undefined,
    resourceLimits: {
      maxCpuPercent: form.maxCpuPercent,
      maxRamPercent: form.maxRamPercent,
      maxGpuPercent: optionalText(form.maxGpuPercent) ? Number(form.maxGpuPercent) : undefined,
      reserveRamMb: form.reserveRamMb,
      maxGameInstances: form.maxGameInstances,
      allowAutoScaling: form.allowAutoScaling
    }
  };
}

function countRequestedBots(config: SimulationRunConfig): number {
  return config.botPools.reduce((total, pool) => total + (pool.enabled ? pool.desiredCount : 0), 0);
}

function applyResolvedAutoCounts(
  config: SimulationRunConfig,
  launchPlans: BotLaunchPlan[]
): SimulationRunConfig {
  const resolvedCounts = launchPlans.reduce<Map<string, number>>((counts, plan) => {
    counts.set(plan.profileId, (counts.get(plan.profileId) ?? 0) + 1);
    return counts;
  }, new Map());

  return {
    ...config,
    botPools: config.botPools.map((pool) => {
      if (pool.scalingMode !== 'auto') {
        return pool;
      }

      const resolvedCount = resolvedCounts.get(pool.profileId) ?? 0;

      return {
        ...pool,
        minCount: Math.min(pool.minCount, resolvedCount),
        desiredCount: resolvedCount
      };
    })
  };
}

export function NewSessionPage() {
  const gameProfiles = useConfigStore((state) => state.gameProfiles);
  const botProfiles = useConfigStore((state) => state.botProfiles);
  const saveRunConfig = useConfigStore((state) => state.saveRunConfig);
  const openGameProfileEditor = useConfigStore((state) => state.openGameProfileEditor);
  const setSessionPreview = useSessionStore((state) => state.setSessionPreview);
  const sessionStatus = useSessionStore((state) => state.status);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const runtimeBotStatuses = useSessionStore((state) => state.botStatuses);
  const runtimeInstanceStatuses = useSessionStore((state) => state.instanceStatuses);
  const runtimeIssues = useSessionStore((state) => state.issues);
  const runtimeLogs = useSessionStore((state) => state.logs);
  const applySessionSnapshot = useSessionStore((state) => state.applySessionSnapshot);
  const applyRuntimeDetails = useSessionStore((state) => state.applyRuntimeDetails);
  const initialGameProfile = gameProfiles[0];
  const initialTemplate = initialGameProfile ? recommendedFirstTestTemplate(initialGameProfile) : undefined;
  const [form, setForm] = useState<RunFormState>(() => initialRunFormState(initialGameProfile, botProfiles));
  const [selectedTemplateId, setSelectedTemplateId] = useState<FirstTestTemplateId>(
    initialTemplate?.id ?? 'browser-smoke-test'
  );
  const [templateApplyMessage, setTemplateApplyMessage] = useState<string | null>(
    initialTemplate ? `${initialTemplate.name} safe settings are ready.` : null
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [validatedConfig, setValidatedConfig] = useState<SimulationRunConfig | null>(null);
  const [viabilityReport, setViabilityReport] = useState<RuntimeViabilityReport | null>(null);
  const [viabilityError, setViabilityError] = useState<string | null>(null);
  const [adapterValidationErrors, setAdapterValidationErrors] = useState<string[]>([]);
  const [adapterValidationWarnings, setAdapterValidationWarnings] = useState<string[]>([]);
  const [runAnyway, setRunAnyway] = useState(false);
  const [addPoolProfileId, setAddPoolProfileId] = useState('');
  const [startupFlowTestResult, setStartupFlowTestResult] = useState<string | null>(null);
  const selectedProfile = gameProfiles.find((profile) => profile.gameId === form.gameProfileId);
  const adapterType = selectedProfile?.adapter.type ?? 'custom';
  const videoSupported = selectedProfile?.adapter.supportsVideo ?? false;
  const canPause = activeSessionId !== null && sessionStatus === 'running';
  const canResume = activeSessionId !== null && sessionStatus === 'paused';
  const canStop =
    activeSessionId !== null && ['created', 'starting', 'running', 'paused'].includes(sessionStatus);
  const availableBotProfiles = botProfiles.filter(
    (profile) => !form.botPools.some((pool) => pool.profileId === profile.profileId)
  );
  const profileIdToAdd = addPoolProfileId || availableBotProfiles[0]?.profileId || '';
  const startupFlowOptions = selectedProfile?.uiFlows ?? [];
  const selectedStartupFlow = startupFlowOptions.find((flow) => flow.flowId === form.startupFlowId);
  const selectedTemplate =
    firstTestTemplates.find((template) => template.id === selectedTemplateId) ?? firstTestTemplates[0];
  const templateCompatible = selectedProfile
    ? isFirstTestTemplateCompatible(selectedTemplate, selectedProfile)
    : false;

  const preview = useMemo(
    () =>
      buildRunConfig(
        { ...form, saveVideo: videoSupported ? form.saveVideo : false },
        adapterType
      ),
    [adapterType, form, videoSupported]
  );
  const requestedBots = countRequestedBots(preview);
  const screenshotEvery = optionalText(form.screenshotEveryNActions)
    ? Math.max(1, Number(form.screenshotEveryNActions))
    : undefined;
  const estimatedScreenshotCount =
    form.saveScreenshots && screenshotEvery
      ? requestedBots * Math.ceil((optionalText(form.maxActionsPerBot) ? Number(form.maxActionsPerBot) : 250) / screenshotEvery)
      : 0;
  const diskUsageWarning =
    form.saveScreenshots && screenshotEvery && (screenshotEvery < 10 || estimatedScreenshotCount > 300)
      ? `This setup may create about ${estimatedScreenshotCount} periodic screenshots before issue/recovery evidence. Use a larger number like 20 or 50 to save disk space.`
      : '';
  const resolvedLaunchPlans = useMemo<BotLaunchPlan[]>(() => {
    const parsed = SimulationRunConfigSchema.safeParse(preview);

    if (!parsed.success || !viabilityReport) {
      return [];
    }

    return resolveBotPools({
      runConfig: parsed.data,
      botProfiles,
      viabilityReport
    });
  }, [botProfiles, preview, viabilityReport]);
  const plannedGameInstances = useMemo(() => {
    const parsed = SimulationRunConfigSchema.safeParse(preview);

    if (!parsed.success || !selectedProfile || resolvedLaunchPlans.length === 0) {
      return null;
    }

    return planGameInstances({
      runConfig: parsed.data,
      gameProfile: selectedProfile,
      launchPlans: resolvedLaunchPlans,
      adapterCapabilities: {
        supportsMultipleInstances: selectedProfile.adapter.supportsMultipleInstances,
        supportsSaveIsolation: selectedProfile.adapter.supportsSaveIsolation
      }
    });
  }, [preview, resolvedLaunchPlans, selectedProfile]);
  const sharedSaveWarning =
    plannedGameInstances &&
    plannedGameInstances.instances.length > 1 &&
    (selectedProfile?.saveIsolation?.mode ?? 'none') === 'none'
      ? 'Multiple game instances are planned without save isolation. Bots may overwrite the same save/profile data.'
      : '';

  useEffect(() => {
    let cancelled = false;
    const config = preview;
    const parsed = SimulationRunConfigSchema.safeParse(config);

    if (!parsed.success || !selectedProfile) {
      setViabilityReport(null);
      setViabilityError('Complete the run configuration to estimate viability.');
      setAdapterValidationErrors([]);
      setAdapterValidationWarnings([]);
      return;
    }

    setViabilityError(null);

    window.gameplaySimulator.simulation
      .estimateViability({ runConfig: parsed.data, gameProfile: selectedProfile, botProfiles })
      .then((report) => {
        if (!cancelled) {
          setViabilityReport(report);
          setRunAnyway(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setViabilityReport(null);
          setViabilityError('Resource estimate is unavailable.');
        }
      });

    window.gameplaySimulator.simulation
      .validateSessionConfig({ runConfig: parsed.data, gameProfile: selectedProfile, botProfiles })
      .then((validation) => {
        if (!cancelled) {
          setAdapterValidationErrors(validation.errors.map((error) => `${error.path}: ${error.message}`));
          setAdapterValidationWarnings(validation.warnings.map((warning) => `${warning.path}: ${warning.message}`));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAdapterValidationErrors(['Adapter profile validation is unavailable.']);
          setAdapterValidationWarnings([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [adapterType, botProfiles, form, selectedProfile, videoSupported]);

  function update<K extends keyof RunFormState>(key: K, value: RunFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === 'startupFlowId' || key === 'startupFlowTimeoutSeconds' || key === 'continueOnStartupFlowFailure') {
      setStartupFlowTestResult(null);
    }
  }

  function updatePool(index: number, patch: Partial<BotPoolConfig>) {
    setForm((current) => ({
      ...current,
      botPools: current.botPools.map((pool, poolIndex) =>
        poolIndex === index
          ? {
              ...pool,
              ...patch,
              ...(patch.scalingMode === 'fixed'
                ? {
                    minCount: patch.desiredCount ?? pool.desiredCount
                  }
                : {})
            }
          : pool
      )
    }));
  }

  function addBotPool() {
    const profile = botProfiles.find((item) => item.profileId === profileIdToAdd);

    if (!profile) {
      return;
    }

    setForm((current) => ({
      ...current,
      botPools: [...current.botPools, createBotPoolFromProfile(profile, current.botPools.length, true)]
    }));
    setAddPoolProfileId('');
  }

  function removeBotPool(index: number) {
    setForm((current) => ({
      ...current,
      botPools: current.botPools.filter((_pool, poolIndex) => poolIndex !== index)
    }));
  }

  function applySelectedTemplate() {
    if (!selectedProfile) {
      setTemplateApplyMessage('Choose a game profile before applying a first-test template.');
      return;
    }

    if (!templateCompatible) {
      const recommended = recommendedFirstTestTemplate(selectedProfile);
      setTemplateApplyMessage(
        recommended
          ? `${selectedTemplate.name} does not match this profile. Choose ${recommended.name}.`
          : `${selectedTemplate.name} does not match this game profile.`
      );
      return;
    }

    const nextForm = applyTemplateToForm(form, selectedTemplate, selectedProfile, botProfiles);

    if (!nextForm) {
      setTemplateApplyMessage(`The ${selectedTemplate.botProfileId} profile is missing, so this template cannot be applied.`);
      return;
    }

    setForm(nextForm);
    setErrors({});
    setValidatedConfig(null);
    setRunAnyway(false);
    setStartupFlowTestResult(null);
    setTemplateApplyMessage(
      `${selectedTemplate.name} applied: one bot, ${selectedTemplate.actionCount} actions, one game instance, and video off.`
    );
  }

  function poolError(index: number, field: keyof BotPoolConfig): string | undefined {
    return errors[`botPools.${index}.${field}`];
  }

  function testStartupFlow() {
    if (!selectedProfile) {
      setStartupFlowTestResult('Choose a game profile before testing a startup flow.');
      return;
    }

    if (!form.startupFlowId) {
      setStartupFlowTestResult('No startup flow is selected. Normal bots will start after the game instances launch.');
      return;
    }

    const flow = selectedProfile.uiFlows.find((item) => item.flowId === form.startupFlowId);

    if (!flow) {
      setStartupFlowTestResult('The selected startup flow no longer exists on this game profile.');
      return;
    }

    if (flow.steps.length === 0) {
      setStartupFlowTestResult(`Startup flow "${flow.name}" has no steps. Add steps in the game profile before using it.`);
      return;
    }

    const timeoutSeconds = optionalText(form.startupFlowTimeoutSeconds)
      ? Math.max(1, Number(form.startupFlowTimeoutSeconds))
      : 60;

    setStartupFlowTestResult(
      `Startup flow "${flow.name}" is ready. It will run ${flow.steps.length} step${flow.steps.length === 1 ? '' : 's'} before normal bots start, with a ${timeoutSeconds} second timeout.`
    );
  }

  async function refreshRuntimeDetails(sessionId: string) {
    const [status, botStatuses, instanceStatuses, issues, logs, coverage] = await Promise.all([
      window.gameplaySimulator.simulation.getSessionStatus(sessionId),
      window.gameplaySimulator.simulation.getBotStatuses(sessionId),
      window.gameplaySimulator.simulation.getInstanceStatuses(sessionId),
      window.gameplaySimulator.simulation.getIssues(sessionId),
      window.gameplaySimulator.simulation.getLogs(sessionId),
      window.gameplaySimulator.simulation.getCoverage(sessionId)
    ]);

    applySessionSnapshot(status);
    applyRuntimeDetails({ botStatuses, instanceStatuses, issues, logs, coverage });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const config = buildRunConfig(
      { ...form, saveVideo: videoSupported ? form.saveVideo : false },
      adapterType
    );
    const result = SimulationRunConfigSchema.safeParse(config);

    if (!result.success) {
      setErrors(zodFieldErrors(result.error));
      setValidatedConfig(null);
      return;
    }

    if (!selectedProfile) {
      setErrors({ form: 'Choose a game profile before starting a session.' });
      setValidatedConfig(null);
      return;
    }

    if (!viabilityReport) {
      setErrors({ form: 'Wait for the resource estimate before creating the session config.' });
      setValidatedConfig(null);
      return;
    }

    if (viabilityReport.blockers.length > 0 || !viabilityReport.canRun) {
      setErrors({ form: 'Resource blockers must be fixed before creating the session config.' });
      setValidatedConfig(null);
      return;
    }

    if (viabilityReport.warnings.length > 0 && !runAnyway) {
      setErrors({ form: 'Review the resource warnings or enable Run anyway.' });
      setValidatedConfig(null);
      return;
    }

    const adjustedConfig = applyResolvedAutoCounts(result.data, resolvedLaunchPlans);
    const adjustedResult = SimulationRunConfigSchema.safeParse(adjustedConfig);

    if (!adjustedResult.success) {
      setErrors(zodFieldErrors(adjustedResult.error));
      setValidatedConfig(null);
      return;
    }

    if (resolvedLaunchPlans.length === 0) {
      setErrors({ form: 'No bots can be resolved from the current pool and resource settings.' });
      setValidatedConfig(null);
      return;
    }

    const payload = {
      runConfig: adjustedResult.data,
      gameProfile: selectedProfile,
      botProfiles
    };
    const backendValidation = await window.gameplaySimulator.simulation.validateSessionConfig(payload);

    if (!backendValidation.valid) {
      setErrors({
        form: backendValidation.errors.map((error) => `${error.path}: ${error.message}`).join(' ')
      });
      setAdapterValidationErrors(backendValidation.errors.map((error) => `${error.path}: ${error.message}`));
      setAdapterValidationWarnings(backendValidation.warnings.map((warning) => `${warning.path}: ${warning.message}`));
      setValidatedConfig(null);
      return;
    }

    try {
      setAdapterValidationWarnings(backendValidation.warnings.map((warning) => `${warning.path}: ${warning.message}`));
      const created = await window.gameplaySimulator.simulation.createSession(payload);
      const started = await window.gameplaySimulator.simulation.startSession(created.sessionId);

      setErrors({});
      setValidatedConfig(adjustedResult.data);
      saveRunConfig(adjustedResult.data);
      applySessionSnapshot(started);
      applyRuntimeDetails({
        botStatuses: created.botStatuses,
        instanceStatuses: created.instanceStatuses,
        logs: created.logs
      });
      setSessionPreview(started.label);
      void refreshRuntimeDetails(created.sessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Backend session start failed.';
      setErrors({ form: message });
      setValidatedConfig(null);
    }
  }

  async function stopActiveSession() {
    if (!activeSessionId) {
      return;
    }

    const status = await window.gameplaySimulator.simulation.stopSession(activeSessionId);
    applySessionSnapshot(status);
    await refreshRuntimeDetails(activeSessionId);
  }

  async function pauseActiveSession() {
    if (!activeSessionId) {
      return;
    }

    const status = await window.gameplaySimulator.simulation.pauseSession(activeSessionId);
    applySessionSnapshot(status);
    await refreshRuntimeDetails(activeSessionId);
  }

  async function resumeActiveSession() {
    if (!activeSessionId) {
      return;
    }

    const status = await window.gameplaySimulator.simulation.resumeSession(activeSessionId);
    applySessionSnapshot(status);
    await refreshRuntimeDetails(activeSessionId);
  }

  if (gameProfiles.length === 0) {
    return (
      <section className="empty-state">
        <h1>New Session</h1>
        <button className="primary-button" type="button" onClick={() => openGameProfileEditor()}>
          <span>New Profile</span>
        </button>
      </section>
    );
  }

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Simulation</p>
          <h1>New Session</h1>
        </div>
        <div className="page-actions">
          <button
            className="primary-button"
            type="submit"
            form="new-session-form"
            disabled={sessionStatus === 'starting'}
          >
            <Play size={18} aria-hidden="true" />
            <span>Start Session</span>
          </button>
          {canPause ? (
            <button className="secondary-button" type="button" onClick={pauseActiveSession}>
              <Pause size={18} aria-hidden="true" />
              <span>Pause</span>
            </button>
          ) : null}
          {canResume ? (
            <button className="secondary-button" type="button" onClick={resumeActiveSession}>
              <RotateCw size={18} aria-hidden="true" />
              <span>Resume</span>
            </button>
          ) : null}
          {canStop ? (
            <button className="secondary-button" type="button" onClick={stopActiveSession}>
              <Square size={18} aria-hidden="true" />
              <span>Stop</span>
            </button>
          ) : null}
        </div>
      </div>

      <form id="new-session-form" className="form-grid" onSubmit={onSubmit}>
        {errors.form ? <div className="form-error">{errors.form}</div> : null}

        <section className="form-section form-section--template">
          <div className="section-header-row">
            <div>
              <p className="eyebrow">Safe Starting Point</p>
              <h2>First Test Template</h2>
            </div>
            <button
              className="secondary-button"
              type="button"
              disabled={!templateCompatible}
              onClick={applySelectedTemplate}
            >
              <ShieldCheck size={18} aria-hidden="true" />
              <span>Apply Template</span>
            </button>
          </div>

          <div className="field-grid">
            <SelectInput
              id="first-test-template"
              label="First Test Template"
              helpText="This is a ready-made set of safe settings for one short test. The simulator uses it to choose one bot, 20 actions, a slow action delay, and one game instance. For example, choose Browser Smoke Test for a browser game. If it does not match the game profile, it cannot be applied. Beginners should use the template marked as matching their profile."
              value={selectedTemplateId}
              onChange={(event) => {
                setSelectedTemplateId(event.target.value as FirstTestTemplateId);
                setTemplateApplyMessage(null);
              }}
            >
              {firstTestTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </SelectInput>
            <div className="template-compatibility">
              <FieldLabel
                label="Template Compatibility"
                helpText="This tells you whether the template matches the selected game profile. The simulator checks the game engine, adapter, and instrumentation endpoint. For example, a Unity profile with an endpoint matches Unity Instrumented Smoke Test. If it does not match, applying it could use the wrong kind of setup, so the app blocks it. Beginners should choose the matching template."
              />
              <span className={`status-pill ${templateCompatible ? '' : 'status-pill--warning'}`}>
                {templateCompatible ? 'Matches selected profile' : 'Does not match selected profile'}
              </span>
            </div>
          </div>

          <div className="template-guidance">
            <div>
              <FieldLabel
                label="What This Template Does"
                helpText="This explains the small test the template will create. It helps you know which bot and evidence will be used. For example, a browser smoke test checks a few UI actions. If this is not the test you need, choose another template. Beginners should start with the simplest matching smoke test."
              />
              <p>{selectedTemplate.whatItDoes}</p>
            </div>
            <div>
              <FieldLabel
                label="When To Use It"
                helpText="This explains when the template is a good choice. It helps you pick the setup that matches your game profile. For example, an instrumented template needs a working local endpoint. If you use it at the wrong time, the session may not start. Beginners should finish the named profile check first."
              />
              <p>{selectedTemplate.whenToUse}</p>
            </div>
            <div>
              <FieldLabel
                label="What It Cannot Test"
                helpText="This explains the important limits of the short test. It helps you avoid treating one small run as proof that the whole game works. For example, 20 menu actions cannot test every level. If you ignore these limits, you may miss bugs. Beginners should use the result as a setup check."
              />
              <p>{selectedTemplate.limitations}</p>
            </div>
            <div>
              <FieldLabel
                label="Expected First Result"
                helpText="This describes what a normal first result should look like. It helps you tell a working setup from a setup problem. For example, the game opens, one bot acts, and a report is saved. If the result is different, check profile tests and logs before adding bots. Beginners should aim for this result first."
              />
              <p>{selectedTemplate.expectedResult}</p>
            </div>
            <div>
              <FieldLabel
                label="Beginner Recommendation"
                helpText="This is the safest next step for someone new to the simulator. It explains what to check before making the run larger. For example, test one desktop control first. If you skip it, bots may fail for a simple setup reason. Beginners should follow this advice for the first run."
              />
              <p>{selectedTemplate.beginnerRecommendation}</p>
            </div>
            <div>
              <FieldLabel
                label="Before Starting"
                helpText="These are quick checks to complete before the bot starts. The simulator lists them because a profile can look complete while launch, controls, or endpoints still fail. For example, test one control before a desktop run. If a check fails, fix it before starting. Beginners should complete every item."
              />
              <ul>
                {selectedTemplate.beforeStarting.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="template-safety-strip">
            <FieldLabel
              label="Template Safety Limits"
              helpText="These are hard small-run settings applied by the template. They prevent an accidental large first test. Every template uses one bot, one game instance, no video, and no more than 20 actions. If you change them later, the run can use more computer power. Beginners should keep these limits for the first report."
            />
            <span>
              1 bot · 1 game instance · {selectedTemplate.actionCount} actions · {selectedTemplate.actionDelayMs} ms delay · video off
            </span>
          </div>

          {templateApplyMessage ? (
            <div className={`inline-notice ${templateCompatible ? 'inline-notice--ready' : 'inline-notice--loading'}`}>
              <FieldLabel
                label="Template Result"
                helpText="This confirms whether the template was applied. It helps you know if the visible session settings now use the safe values. For example, it may say one bot and 20 actions were applied. If it says the profile does not match, choose the recommended template. Beginners should read this before starting."
              />
              <span>{templateApplyMessage}</span>
            </div>
          ) : null}
        </section>

        <section className="form-section">
          <h2>Run</h2>
          <div className="field-grid">
            <TextInput
              label="Session ID"
              name="sessionId"
              value={form.sessionId}
              error={errors.sessionId}
              onChange={(event) => update('sessionId', event.target.value)}
            />
            <SelectInput
              label="Session Label"
              name="sessionLabel"
              value={form.sessionLabel}
              onChange={(event) => update('sessionLabel', event.target.value as SessionLabel)}
            >
              {sessionLabels.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </SelectInput>
            <SelectInput
              label="Game Profile"
              name="gameProfileId"
              value={form.gameProfileId}
              error={errors.gameProfilePath}
              onChange={(event) => {
                const nextProfile = gameProfiles.find((profile) => profile.gameId === event.target.value);
                const nextTemplate = nextProfile ? recommendedFirstTestTemplate(nextProfile) : undefined;

                setForm((current) => {
                  if (nextProfile && nextTemplate) {
                    return applyTemplateToForm(current, nextTemplate, nextProfile, botProfiles) ?? {
                      ...current,
                      gameProfileId: event.target.value,
                      startupFlowId: ''
                    };
                  }

                  return {
                    ...current,
                    gameProfileId: event.target.value,
                    startupFlowId: ''
                  };
                });
                if (nextTemplate) {
                  setSelectedTemplateId(nextTemplate.id);
                  setTemplateApplyMessage(`${nextTemplate.name} safe settings are ready.`);
                } else {
                  setTemplateApplyMessage('No first-test template exactly matches this profile. Review the adapter setup.');
                }
                setStartupFlowTestResult(null);
              }}
            >
              {gameProfiles.map((profile) => (
                <option key={profile.gameId} value={profile.gameId}>
                  {profile.gameName}
                </option>
              ))}
            </SelectInput>
            <SelectInput
              label="Run Mode"
              name="runMode"
              value={form.runMode}
              onChange={(event) => update('runMode', event.target.value as RunMode)}
            >
              {runModes.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </SelectInput>
            <TextInput
              label="Max Runtime Minutes"
              name="maxRuntimeMinutes"
              type="number"
              min={1}
              value={form.maxRuntimeMinutes}
              onChange={(event) => update('maxRuntimeMinutes', event.target.value)}
            />
            <TextInput
              label="Action Delay Ms"
              name="actionDelayMs"
              type="number"
              min={0}
              value={form.actionDelayMs}
              error={errors.actionDelayMs}
              onChange={(event) => update('actionDelayMs', numericInput(event.target.value))}
            />
            <TextInput
              label="Max Actions Per Bot"
              name="maxActionsPerBot"
              type="number"
              min={1}
              value={form.maxActionsPerBot}
              onChange={(event) => update('maxActionsPerBot', event.target.value)}
            />
            <TextInput
              label="Screenshot Every N Actions"
              name="screenshotEveryNActions"
              type="number"
              min={1}
              value={form.screenshotEveryNActions}
              onChange={(event) => update('screenshotEveryNActions', event.target.value)}
            />
            <SelectInput
              label="Startup Flow"
              name="startupFlowId"
              value={form.startupFlowId}
              disabled={startupFlowOptions.length === 0}
              onChange={(event) => update('startupFlowId', event.target.value)}
            >
              <option value="">
                {startupFlowOptions.length === 0 ? 'No UI flows configured' : 'No startup flow'}
              </option>
              {startupFlowOptions.map((flow) => (
                <option key={flow.flowId} value={flow.flowId}>
                  {flow.name}
                </option>
              ))}
            </SelectInput>
            <TextInput
              label="Startup timeout"
              name="startupFlowTimeoutSeconds"
              type="number"
              min={1}
              value={form.startupFlowTimeoutSeconds}
              onChange={(event) => update('startupFlowTimeoutSeconds', event.target.value)}
            />
          </div>
          <div className="toggle-grid">
            <ToggleInput
              label="Run Until Stopped"
              checked={form.runUntilStopped}
              onChange={(event) => update('runUntilStopped', event.target.checked)}
            />
            <ToggleInput
              label="Stop On Critical Issue"
              checked={form.stopOnCriticalIssue}
              onChange={(event) => update('stopOnCriticalIssue', event.target.checked)}
            />
            <ToggleInput
              label="Save screenshots"
              checked={form.saveScreenshots}
              disabled={!selectedProfile?.adapter.supportsScreenshots}
              onChange={(event) => update('saveScreenshots', event.target.checked)}
            />
            <ToggleInput
              label="Save video"
              checked={videoSupported && form.saveVideo}
              disabled={!videoSupported}
              onChange={(event) => update('saveVideo', event.target.checked)}
            />
            <ToggleInput
              label="Action Timeline"
              checked={form.saveActionTimeline}
              onChange={(event) => update('saveActionTimeline', event.target.checked)}
            />
            <ToggleInput
              label="State Snapshots"
              checked={form.saveStateSnapshots}
              onChange={(event) => update('saveStateSnapshots', event.target.checked)}
            />
            <ToggleInput
              label="Continue if startup flow fails"
              checked={form.continueOnStartupFlowFailure}
              disabled={!form.startupFlowId}
              onChange={(event) => update('continueOnStartupFlowFailure', event.target.checked)}
            />
          </div>
          <div className="wizard-test-card">
            <div>
              <FieldLabel label="Test Startup Flow" />
              <p className="form-hint">
                {selectedStartupFlow
                  ? `Checks "${selectedStartupFlow.name}" before the real session uses it.`
                  : 'Choose a startup flow from this game profile before testing it.'}
              </p>
            </div>
            <button
              className="secondary-button"
              type="button"
              disabled={startupFlowOptions.length === 0}
              onClick={testStartupFlow}
            >
              <Play size={18} aria-hidden="true" />
              <span>Test Startup Flow</span>
            </button>
          </div>
          {startupFlowTestResult ? (
            <div className="inline-notice inline-notice--ready">
              <FieldLabel label="Startup Flow Test Result" />
              <span>{startupFlowTestResult}</span>
            </div>
          ) : null}
          {diskUsageWarning ? (
            <div className="inline-notice inline-notice--loading">
              <FieldLabel label="Disk usage warning" />
              <span>{diskUsageWarning}</span>
            </div>
          ) : null}
        </section>

        <section className="form-section">
          <div className="section-header-row">
            <h2>Bot Pools</h2>
            <div className="bot-pool-adder">
              <SelectInput
                label="Add Bot Type"
                value={profileIdToAdd}
                disabled={availableBotProfiles.length === 0}
                onChange={(event) => setAddPoolProfileId(event.target.value)}
              >
                {availableBotProfiles.length === 0 ? (
                  <option value="">All profiles added</option>
                ) : (
                  availableBotProfiles.map((profile) => (
                    <option key={profile.profileId} value={profile.profileId}>
                      {profile.displayName}
                    </option>
                  ))
                )}
              </SelectInput>
              <button
                className="secondary-button"
                type="button"
                disabled={availableBotProfiles.length === 0}
                onClick={addBotPool}
              >
                <Plus size={18} aria-hidden="true" />
                <span>Add Pool</span>
              </button>
            </div>
          </div>
          <div className="bot-pool-grid">
            {form.botPools.map((pool, index) => {
              const profile = botProfiles.find((item) => item.profileId === pool.profileId);

              return (
                <div className="bot-pool-row" key={pool.profileId}>
                  <ToggleInput
                    label={profile?.displayName ?? pool.profileId}
                    helpText={`This turns the ${profile?.displayName ?? pool.profileId} pool on or off. The simulator uses enabled pools to create bots for this session. For example, turn on Explorer Bot to test maps and hidden areas. If this is off, no bots from this pool will run. Beginners should keep one simple pool enabled first.`}
                    checked={pool.enabled}
                    onChange={(event) => updatePool(index, { enabled: event.target.checked })}
                  />
                  <TextInput
                    label="Min"
                    type="number"
                    min={0}
                    value={pool.minCount}
                    error={poolError(index, 'minCount')}
                    onChange={(event) => updatePool(index, { minCount: numericInput(event.target.value) })}
                  />
                  <TextInput
                    label="Desired"
                    type="number"
                    min={0}
                    value={pool.desiredCount}
                    error={poolError(index, 'desiredCount')}
                    onChange={(event) => {
                      const desiredCount = numericInput(event.target.value);
                      updatePool(index, {
                        desiredCount,
                        ...(pool.scalingMode === 'fixed' ? { minCount: desiredCount } : {})
                      });
                    }}
                  />
                  <TextInput
                    label="Max"
                    type="number"
                    min={0}
                    value={pool.maxCount}
                    error={poolError(index, 'maxCount')}
                    onChange={(event) => updatePool(index, { maxCount: numericInput(event.target.value) })}
                  />
                  <SelectInput
                    label="Scaling"
                    value={pool.scalingMode}
                    error={poolError(index, 'scalingMode')}
                    onChange={(event) =>
                      updatePool(index, { scalingMode: event.target.value as BotPoolConfig['scalingMode'] })
                    }
                  >
                    <option value="fixed">Fixed</option>
                    <option value="auto">Auto</option>
                  </SelectInput>
                  <button
                    className="icon-text-button bot-pool-remove"
                    type="button"
                    onClick={() => removeBotPool(index)}
                  >
                    <Trash2 size={17} aria-hidden="true" />
                    <span>Remove</span>
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section className="form-section">
          <h2>Limits</h2>
          <div className="field-grid">
            <TextInput
              label="Global Bot Limit"
              type="number"
              min={1}
              value={form.globalBotLimit}
              error={errors.globalBotLimit}
              onChange={(event) => update('globalBotLimit', numericInput(event.target.value))}
            />
            <TextInput
              label="Per-Instance Bot Limit"
              type="number"
              min={1}
              value={form.perGameInstanceBotLimit}
              error={errors.perGameInstanceBotLimit}
              onChange={(event) => update('perGameInstanceBotLimit', numericInput(event.target.value))}
            />
            <TextInput
              label="CPU Percent"
              type="number"
              min={1}
              max={100}
              value={form.maxCpuPercent}
              error={errors['resourceLimits.maxCpuPercent']}
              onChange={(event) => update('maxCpuPercent', numericInput(event.target.value))}
            />
            <TextInput
              label="RAM Percent"
              type="number"
              min={1}
              max={100}
              value={form.maxRamPercent}
              error={errors['resourceLimits.maxRamPercent']}
              onChange={(event) => update('maxRamPercent', numericInput(event.target.value))}
            />
            <TextInput
              label="GPU Percent"
              type="number"
              min={1}
              max={100}
              value={form.maxGpuPercent}
              error={errors['resourceLimits.maxGpuPercent']}
              onChange={(event) => update('maxGpuPercent', event.target.value)}
            />
            <TextInput
              label="Reserve RAM MB"
              type="number"
              min={0}
              value={form.reserveRamMb}
              error={errors['resourceLimits.reserveRamMb']}
              onChange={(event) => update('reserveRamMb', numericInput(event.target.value))}
            />
            <TextInput
              label="Max Game Instances"
              type="number"
              min={1}
              value={form.maxGameInstances}
              error={errors['resourceLimits.maxGameInstances']}
              onChange={(event) => update('maxGameInstances', numericInput(event.target.value))}
            />
          </div>
          <div className="toggle-grid">
            <ToggleInput
              label="Auto Scaling"
              checked={form.allowAutoScaling}
              onChange={(event) => update('allowAutoScaling', event.target.checked)}
            />
          </div>
        </section>
      </form>

      <section className="viability-panel" aria-label="Runtime viability estimate">
        <div className="viability-panel__header">
          <div>
            <p className="eyebrow">Resource Estimate</p>
            <h2>Bot-count viability</h2>
          </div>
          {viabilityReport ? (
            <span className="status-pill">{viabilityReport.canRun ? 'Can run' : 'Needs changes'}</span>
          ) : null}
        </div>

        {viabilityError ? <div className="form-error">{viabilityError}</div> : null}

        {adapterValidationErrors.length > 0 ? (
          <div className="notice-list notice-list--blocker">
            <strong>Adapter profile errors</strong>
            {adapterValidationErrors.map((message) => (
              <span key={message}>{message}</span>
            ))}
          </div>
        ) : null}

        {adapterValidationWarnings.length > 0 ? (
          <div className="notice-list notice-list--warning">
            <strong>Adapter profile warnings</strong>
            {adapterValidationWarnings.map((message) => (
              <span key={message}>{message}</span>
            ))}
          </div>
        ) : null}

        {viabilityReport ? (
          <>
            <div className="metric-grid">
              <div className="metric-card">
                <FieldLabel label="Requested bots" />
                <strong>{requestedBots}</strong>
              </div>
              <div className="metric-card">
                <FieldLabel label="Recommended bots" />
                <strong>{viabilityReport.recommendedTotalBots}</strong>
              </div>
              <div className="metric-card">
                <FieldLabel label="Final bots" />
                <strong>{resolvedLaunchPlans.length}</strong>
              </div>
              <div className="metric-card">
                <FieldLabel label="Game instances" />
                <strong>{plannedGameInstances?.instances.length ?? 0}</strong>
              </div>
              <div className="metric-card">
                <FieldLabel label="Estimated RAM" />
                <strong>{viabilityReport.estimatedRamMb} MB</strong>
              </div>
              <div className="metric-card">
                <FieldLabel label="Estimated CPU" />
                <strong>{viabilityReport.estimatedCpuPercent}%</strong>
              </div>
            </div>

            <div className="allocation-table">
              <div className="allocation-row allocation-row--head">
                <span>
                  <FieldLabel label="Bot profile" />
                </span>
                <span>
                  <FieldLabel label="Requested" />
                </span>
                <span>
                  <FieldLabel label="Recommended" />
                </span>
                <span>
                  <FieldLabel label="Reason" />
                </span>
              </div>
              {viabilityReport.botAllocation.map((allocation) => (
                <div className="allocation-row" key={allocation.profileId}>
                  <span>{allocation.profileId}</span>
                  <span>{allocation.requestedCount}</span>
                  <span>{allocation.recommendedCount}</span>
                  <span>{allocation.reason}</span>
                </div>
              ))}
            </div>

            <div className="allocation-table">
              <div className="launch-plan-row launch-plan-row--head">
                <span>
                  <FieldLabel label="Launch" />
                </span>
                <span>
                  <FieldLabel label="Bot ID" />
                </span>
                <span>
                  <FieldLabel label="Display" />
                </span>
                <span>
                  <FieldLabel label="Playstyle" />
                </span>
                <span>
                  <FieldLabel label="Instance" />
                </span>
              </div>
              {resolvedLaunchPlans.length === 0 ? (
                <div className="empty-row">No bots resolved from the current limits</div>
              ) : (
                resolvedLaunchPlans.map((plan) => (
                  <div className="launch-plan-row" key={plan.botId}>
                    <span>{plan.launchIndex}</span>
                    <span>{plan.botId}</span>
                    <span>{plan.displayName}</span>
                    <span>{plan.playstyle}</span>
                    <span>{plan.assignedGameInstanceId ?? 'Unassigned'}</span>
                  </div>
                ))
              )}
            </div>

            <div className="allocation-table">
              <div className="instance-row instance-row--head">
                <span>
                  <FieldLabel label="Instance" />
                </span>
                <span>
                  <FieldLabel label="Status" />
                </span>
                <span>
                  <FieldLabel label="Active bots" />
                </span>
                <span>
                  <FieldLabel label="Max bots" />
                </span>
                <span>
                  <FieldLabel label="Save/profile" />
                </span>
              </div>
              {!plannedGameInstances || plannedGameInstances.instances.length === 0 ? (
                <div className="empty-row">No game instances planned yet</div>
              ) : (
                plannedGameInstances.instances.map((instance) => (
                  <div className="instance-row" key={instance.instanceId}>
                    <span>{instance.instanceId}</span>
                    <span>{instance.status.status}</span>
                    <span>{instance.status.assignedBots.join(', ') || 'None'}</span>
                    <span>{instance.config.maxBots}</span>
                    <span>
                      {instance.config.saveProfileId ?? 'Shared/default'}
                      {instance.config.isolatedSaveDirectory ? <small>{instance.config.isolatedSaveDirectory}</small> : null}
                    </span>
                  </div>
                ))
              )}
            </div>

            {plannedGameInstances && plannedGameInstances.queuedBotIds.length > 0 ? (
              <div className="notice-list notice-list--warning">
                <strong>Queued bots</strong>
                <span>{plannedGameInstances.queuedBotIds.join(', ')}</span>
              </div>
            ) : null}

            {sharedSaveWarning ? (
              <div className="notice-list notice-list--warning">
                <FieldLabel label="Shared Save Warning" />
                <span>{sharedSaveWarning}</span>
              </div>
            ) : null}

            {plannedGameInstances && plannedGameInstances.warnings.length > 0 ? (
              <div className="notice-list notice-list--warning">
                <FieldLabel label="Instance planning" />
                {plannedGameInstances.warnings.map((warning) => (
                  <span key={warning}>{warning}</span>
                ))}
              </div>
            ) : null}

            {viabilityReport.warnings.length > 0 ? (
              <div className="notice-list notice-list--warning">
                <strong>Warnings</strong>
                {viabilityReport.warnings.map((warning) => (
                  <span key={warning}>{warning}</span>
                ))}
              </div>
            ) : null}

            {viabilityReport.blockers.length > 0 ? (
              <div className="notice-list notice-list--blocker">
                <strong>Blockers</strong>
                {viabilityReport.blockers.map((blocker) => (
                  <span key={blocker}>{blocker}</span>
                ))}
              </div>
            ) : null}

            {viabilityReport.canRun &&
            viabilityReport.warnings.length > 0 &&
            viabilityReport.blockers.length === 0 ? (
              <ToggleInput
                label="Run anyway"
                checked={runAnyway}
                onChange={(event) => setRunAnyway(event.target.checked)}
              />
            ) : null}
          </>
        ) : null}
      </section>

      <section className="viability-panel" aria-label="Backend session runtime">
        <div className="viability-panel__header">
          <div>
            <p className="eyebrow">Backend Runtime</p>
            <h2>Mock session state</h2>
          </div>
          <span className="status-pill">{sessionStatus}</span>
        </div>

        <div className="metric-grid">
          <div className="metric-card">
            <FieldLabel label="Active session" />
            <strong>{activeSessionId ?? 'None'}</strong>
          </div>
          <div className="metric-card">
            <FieldLabel label="Runtime bots" />
            <strong>{runtimeBotStatuses.length}</strong>
          </div>
          <div className="metric-card">
            <FieldLabel label="Instances" />
            <strong>{runtimeInstanceStatuses.length}</strong>
          </div>
          <div className="metric-card">
            <FieldLabel label="Issues" />
            <strong>{runtimeIssues.length}</strong>
          </div>
          <div className="metric-card">
            <FieldLabel label="Logs" />
            <strong>{runtimeLogs.length}</strong>
          </div>
          <div className="metric-card">
            <FieldLabel label="Control" />
            <strong>{canStop ? 'Live' : 'Idle'}</strong>
          </div>
        </div>

        <div className="allocation-table">
          <div className="instance-row instance-row--head">
            <span>
              <FieldLabel label="Instance" />
            </span>
            <span>
              <FieldLabel label="Status" />
            </span>
            <span>
              <FieldLabel label="Assigned bots" />
            </span>
            <span>
              <FieldLabel label="Process" />
            </span>
            <span>
              <FieldLabel label="Heartbeat" />
            </span>
          </div>
          {runtimeInstanceStatuses.length === 0 ? (
            <div className="empty-row">No backend instance state yet</div>
          ) : (
            runtimeInstanceStatuses.map((instance) => (
              <div className="instance-row" key={instance.instanceId}>
                <span>{instance.instanceId}</span>
                <span>{instance.status}</span>
                <span>{instance.assignedBots.join(', ') || 'None'}</span>
                <span>{instance.processId ?? 'Mock'}</span>
                <span>{new Date(instance.lastHeartbeat).toLocaleTimeString()}</span>
              </div>
            ))
          )}
        </div>

        <div className="allocation-table">
          <div className="runtime-row runtime-row--head">
            <span>
              <FieldLabel label="Bot" />
            </span>
            <span>
              <FieldLabel label="Status" />
            </span>
            <span>
              <FieldLabel label="Instance" />
            </span>
            <span>
              <FieldLabel label="Last action" />
            </span>
            <span>
              <FieldLabel label="Message" />
            </span>
          </div>
          {runtimeBotStatuses.length === 0 ? (
            <div className="empty-row">No backend bot state yet</div>
          ) : (
            runtimeBotStatuses.slice(0, 10).map((bot) => (
              <div className="runtime-row" key={bot.botId}>
                <span>{bot.botId}</span>
                <span>{bot.status}</span>
                <span>{bot.gameInstanceId ?? 'Queued'}</span>
                <span>{bot.lastActionId ?? 'None'}</span>
                <span>{bot.message ?? ''}</span>
              </div>
            ))
          )}
        </div>

        {runtimeLogs.length > 0 ? (
          <div className="notice-list">
            <strong>Recent logs</strong>
            {runtimeLogs.slice(-4).map((log) => (
              <span key={log.id}>
                [{log.level}] {log.message}
              </span>
            ))}
          </div>
        ) : null}
      </section>

      <section className="json-panel" aria-label="Run config preview">
        {validatedConfig ? <div className="success-text">Run config created</div> : null}
        <pre>{JSON.stringify(validatedConfig ?? preview, null, 2)}</pre>
      </section>
    </section>
  );
}
