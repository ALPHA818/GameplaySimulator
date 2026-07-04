import type {
  BotLaunchPlan,
  BotPoolConfig,
  RunMode,
  RuntimeViabilityReport,
  SimulationRunConfig
} from '@core/types';
import { SimulationRunConfigSchema } from '@core/types';
import { resolveBotPools } from '@core/bot/BotPoolResolver';
import { planGameInstances } from '@core/sessions/GameInstanceManager';
import { Pause, Play, Plus, RotateCw, Square, Trash2 } from 'lucide-react';
import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { SelectInput, TextInput, ToggleInput } from '../components/FormFields';
import { createBotPoolFromProfile, createDefaultBotPools, useConfigStore } from '../store/configStore';
import { useSessionStore } from '../store/sessionStore';
import type { FieldErrors } from '../utils/forms';
import { optionalText, zodFieldErrors } from '../utils/forms';

interface RunFormState {
  sessionId: string;
  gameProfileId: string;
  runMode: RunMode;
  runUntilStopped: boolean;
  maxRuntimeMinutes: string;
  stopOnCriticalIssue: boolean;
  saveScreenshots: boolean;
  saveVideo: boolean;
  screenshotEveryNActions: string;
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

function numericInput(value: string): number {
  return value === '' ? 0 : Number(value);
}

function buildRunConfig(form: RunFormState, adapterType: SimulationRunConfig['adapterType']): SimulationRunConfig {
  return {
    sessionId: form.sessionId.trim(),
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
  const [form, setForm] = useState<RunFormState>(() => ({
    sessionId: `session-${Date.now()}`,
    gameProfileId: gameProfiles[0]?.gameId ?? '',
    runMode: 'parallel',
    runUntilStopped: false,
    maxRuntimeMinutes: '15',
    stopOnCriticalIssue: true,
    saveScreenshots: true,
    saveVideo: false,
    screenshotEveryNActions: '25',
    saveActionTimeline: true,
    saveStateSnapshots: true,
    botPools: createDefaultBotPools(botProfiles),
    globalBotLimit: 16,
    perGameInstanceBotLimit: 4,
    actionDelayMs: 250,
    maxActionsPerBot: '500',
    maxCpuPercent: 80,
    maxRamPercent: 75,
    maxGpuPercent: '80',
    reserveRamMb: 2048,
    maxGameInstances: 4,
    allowAutoScaling: true
  }));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [validatedConfig, setValidatedConfig] = useState<SimulationRunConfig | null>(null);
  const [viabilityReport, setViabilityReport] = useState<RuntimeViabilityReport | null>(null);
  const [viabilityError, setViabilityError] = useState<string | null>(null);
  const [runAnyway, setRunAnyway] = useState(false);
  const [addPoolProfileId, setAddPoolProfileId] = useState('');
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

  const preview = useMemo(
    () =>
      buildRunConfig(
        { ...form, saveVideo: videoSupported ? form.saveVideo : false },
        adapterType
      ),
    [adapterType, form, videoSupported]
  );
  const requestedBots = countRequestedBots(preview);
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

  useEffect(() => {
    let cancelled = false;
    const config = preview;
    const parsed = SimulationRunConfigSchema.safeParse(config);

    if (!parsed.success || !selectedProfile) {
      setViabilityReport(null);
      setViabilityError('Complete the run configuration to estimate viability.');
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

    return () => {
      cancelled = true;
    };
  }, [adapterType, botProfiles, form, selectedProfile, videoSupported]);

  function update<K extends keyof RunFormState>(key: K, value: RunFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
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

  function poolError(index: number, field: keyof BotPoolConfig): string | undefined {
    return errors[`botPools.${index}.${field}`];
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
      setValidatedConfig(null);
      return;
    }

    try {
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
              label="Game Profile"
              name="gameProfileId"
              value={form.gameProfileId}
              error={errors.gameProfilePath}
              onChange={(event) => update('gameProfileId', event.target.value)}
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
              label="Screenshots"
              checked={form.saveScreenshots}
              disabled={!selectedProfile?.adapter.supportsScreenshots}
              onChange={(event) => update('saveScreenshots', event.target.checked)}
            />
            <ToggleInput
              label="Video"
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
          </div>
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

        {viabilityReport ? (
          <>
            <div className="metric-grid">
              <div className="metric-card">
                <span>Requested bots</span>
                <strong>{requestedBots}</strong>
              </div>
              <div className="metric-card">
                <span>Recommended bots</span>
                <strong>{viabilityReport.recommendedTotalBots}</strong>
              </div>
              <div className="metric-card">
                <span>Final bots</span>
                <strong>{resolvedLaunchPlans.length}</strong>
              </div>
              <div className="metric-card">
                <span>Game instances</span>
                <strong>{plannedGameInstances?.instances.length ?? 0}</strong>
              </div>
              <div className="metric-card">
                <span>Estimated RAM</span>
                <strong>{viabilityReport.estimatedRamMb} MB</strong>
              </div>
              <div className="metric-card">
                <span>Estimated CPU</span>
                <strong>{viabilityReport.estimatedCpuPercent}%</strong>
              </div>
            </div>

            <div className="allocation-table">
              <div className="allocation-row allocation-row--head">
                <span>Bot profile</span>
                <span>Requested</span>
                <span>Recommended</span>
                <span>Reason</span>
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
                <span>Launch</span>
                <span>Bot ID</span>
                <span>Display</span>
                <span>Playstyle</span>
                <span>Instance</span>
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
                <span>Instance</span>
                <span>Status</span>
                <span>Active bots</span>
                <span>Max bots</span>
                <span>Save/profile</span>
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
                    <span>{instance.config.saveProfileId ?? 'Shared/default'}</span>
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

            {plannedGameInstances && plannedGameInstances.warnings.length > 0 ? (
              <div className="notice-list notice-list--warning">
                <strong>Instance planning</strong>
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
            <span>Active session</span>
            <strong>{activeSessionId ?? 'None'}</strong>
          </div>
          <div className="metric-card">
            <span>Runtime bots</span>
            <strong>{runtimeBotStatuses.length}</strong>
          </div>
          <div className="metric-card">
            <span>Instances</span>
            <strong>{runtimeInstanceStatuses.length}</strong>
          </div>
          <div className="metric-card">
            <span>Issues</span>
            <strong>{runtimeIssues.length}</strong>
          </div>
          <div className="metric-card">
            <span>Logs</span>
            <strong>{runtimeLogs.length}</strong>
          </div>
          <div className="metric-card">
            <span>Control</span>
            <strong>{canStop ? 'Live' : 'Idle'}</strong>
          </div>
        </div>

        <div className="allocation-table">
          <div className="instance-row instance-row--head">
            <span>Instance</span>
            <span>Status</span>
            <span>Assigned bots</span>
            <span>Process</span>
            <span>Heartbeat</span>
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
            <span>Bot</span>
            <span>Status</span>
            <span>Instance</span>
            <span>Last action</span>
            <span>Message</span>
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
