import type {
  AdapterType,
  BotLaunchPlan,
  GameInstanceConfig,
  GameInstanceResourceUsage,
  GameInstanceRuntimeStatus,
  GameInstanceStatus,
  GameProfile,
  SaveIsolationConfig,
  SaveIsolationMode,
  SaveIsolationRuntimeInfo,
  SimulationRunConfig
} from '../types';

export interface GameInstanceManagerCapabilities {
  supportsMultipleInstances: boolean;
  supportsMultipleBotsPerInstance: boolean;
  supportsSaveIsolation: boolean;
}

export interface ManagedAdapterHealth {
  instanceId: string;
  status: 'idle' | 'ready' | 'running' | 'degraded' | 'failed' | 'stopped';
  checkedAt: string;
  message?: string;
  details: Record<string, unknown>;
}

export interface ManagedGameAdapterInstance {
  instanceId: string;
  gameProfileId: string;
  startedAt: string;
  metadata: Record<string, unknown>;
}

export interface ManagedGameAdapter {
  adapterType: AdapterType;
  capabilities: GameInstanceManagerCapabilities;
  launchInstance(config: GameInstanceConfig): Promise<ManagedGameAdapterInstance>;
  stopInstance(instanceId: string): Promise<void>;
  stopAll?(): Promise<void>;
  isRunning(instanceId: string): Promise<boolean>;
  getHealth(instanceId: string): Promise<ManagedAdapterHealth>;
}

export interface GameInstanceManagerFileSystem {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  rm(path: string, options: { recursive: boolean; force: boolean }): Promise<unknown>;
  cp(source: string, destination: string, options: { recursive: boolean; force: boolean }): Promise<unknown>;
}

export interface GameInstancePlanningInput {
  runConfig: SimulationRunConfig;
  gameProfile: GameProfile;
  launchPlans: BotLaunchPlan[];
  adapterType?: AdapterType;
  adapterCapabilities?: Partial<GameInstanceManagerCapabilities>;
  defaultStatus?: GameInstanceRuntimeStatus;
  now?: string;
}

export interface PlannedGameInstance {
  instanceId: string;
  assignedBots: BotLaunchPlan[];
  queuedBots: BotLaunchPlan[];
  config: GameInstanceConfig;
  status: GameInstanceStatus;
}

export type GameInstanceManagerEventType =
  | 'instance_start'
  | 'instance_stop'
  | 'instance_crash'
  | 'instance_health_warning'
  | 'instance_restart'
  | 'instance_save_isolation';

export interface GameInstanceManagerEvent {
  eventType: GameInstanceManagerEventType;
  instanceId: string;
  timestamp: string;
  status: GameInstanceRuntimeStatus;
  previousStatus?: GameInstanceRuntimeStatus;
  message?: string;
  details?: Record<string, unknown>;
}

export interface LiveGameInstanceRecord {
  instanceId: string;
  gameProfileId: string;
  config: GameInstanceConfig;
  status: GameInstanceStatus;
  adapterInstance?: ManagedGameAdapterInstance;
  health?: ManagedAdapterHealth;
  lastError?: string;
  launchedAt?: string;
  stoppedAt?: string;
}

export interface GameInstancePlan {
  mode: SimulationRunConfig['runMode'];
  concurrencyModel: 'parallel' | 'sequential' | 'hybrid';
  capabilities: GameInstanceManagerCapabilities;
  instances: PlannedGameInstance[];
  queuedBotIds: string[];
  warnings: string[];
}

export interface GameInstanceManagerOptions {
  adapter: ManagedGameAdapter;
  runConfig: SimulationRunConfig;
  gameProfile: GameProfile;
  launchPlans: BotLaunchPlan[];
  restartCrashedInstances?: boolean;
  fileSystem?: GameInstanceManagerFileSystem;
  now?: () => string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function padIndex(value: number): string {
  return value.toString().padStart(3, '0');
}

function defaultSaveIsolationConfig(): SaveIsolationConfig {
  return {
    mode: 'none',
    cleanupTempSaves: false,
    preserveBotSaves: true
  };
}

function saveIsolationFor(gameProfile: GameProfile): SaveIsolationConfig {
  return {
    ...defaultSaveIsolationConfig(),
    ...gameProfile.saveIsolation
  };
}

function safePathSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function currentWorkingDirectory(): string {
  if (typeof process !== 'undefined' && typeof process.cwd === 'function') {
    return process.cwd();
  }

  return '';
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || path.startsWith('\\') || /^[a-zA-Z]:[\\/]/.test(path);
}

function pathSeparatorFor(...parts: string[]): '/' | '\\' {
  return parts.some((part) => part.includes('\\')) ? '\\' : '/';
}

function joinPath(...parts: Array<string | undefined>): string {
  const filtered = parts.filter((part): part is string => Boolean(part && part.length > 0));

  if (filtered.length === 0) {
    return '';
  }

  const separator = pathSeparatorFor(...filtered);
  const joined = filtered.join(separator);
  const duplicateSeparatorPattern = separator === '\\' ? /\\+/g : /\/+/g;
  const normalized = joined.replace(duplicateSeparatorPattern, separator);

  return /^[a-zA-Z]:[\\/]/.test(joined) && !/^[a-zA-Z]:[\\/]/.test(normalized)
    ? joined.slice(0, 3) + normalized.slice(3)
    : normalized;
}

function resolvePath(path: string): string {
  if (isAbsolutePath(path)) {
    return path;
  }

  const cwd = currentWorkingDirectory();
  return cwd ? joinPath(cwd, path) : path;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function numericValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function defaultCapabilities(gameProfile: GameProfile): GameInstanceManagerCapabilities {
  const multiBotAdapter =
    gameProfile.adapter.type === 'instrumented' ||
    gameProfile.adapter.type === 'browser' ||
    gameProfile.adapter.supportsDirectActions;

  return {
    supportsMultipleInstances: gameProfile.adapter.supportsMultipleInstances,
    supportsMultipleBotsPerInstance: multiBotAdapter,
    supportsSaveIsolation: gameProfile.adapter.supportsSaveIsolation
  };
}

function mergeCapabilities(input: GameInstancePlanningInput): GameInstanceManagerCapabilities {
  return {
    ...defaultCapabilities(input.gameProfile),
    ...input.adapterCapabilities
  };
}

function resolveConcurrencyModel(
  runConfig: SimulationRunConfig,
  capabilities: GameInstanceManagerCapabilities
): GameInstancePlan['concurrencyModel'] {
  if (runConfig.runMode === 'sequential' || !capabilities.supportsMultipleInstances) {
    return 'sequential';
  }

  return runConfig.runMode;
}

function capacityPerInstance(
  runConfig: SimulationRunConfig,
  capabilities: GameInstanceManagerCapabilities
): number {
  if (!capabilities.supportsMultipleBotsPerInstance) {
    return 1;
  }

  return Math.max(1, runConfig.perGameInstanceBotLimit);
}

function isStartupFlowPlan(plan: BotLaunchPlan): boolean {
  return plan.botId.startsWith('startup-flow-') && plan.profileId === 'ui-journey-bot';
}

function estimateInstanceCount(
  botCount: number,
  runConfig: SimulationRunConfig,
  capabilities: GameInstanceManagerCapabilities,
  concurrencyModel: GameInstancePlan['concurrencyModel']
): number {
  if (botCount === 0) {
    return 0;
  }

  if (concurrencyModel === 'sequential') {
    return 1;
  }

  const maxInstances = Math.max(1, runConfig.resourceLimits.maxGameInstances);
  const instanceCapacity = capacityPerInstance(runConfig, capabilities);

  if (concurrencyModel === 'hybrid') {
    const hybridBatchSize = Math.max(1, instanceCapacity * 2);
    return Math.max(1, Math.min(maxInstances, Math.ceil(botCount / hybridBatchSize)));
  }

  return Math.max(1, Math.min(maxInstances, Math.ceil(botCount / instanceCapacity)));
}

function statusForInstance(input: {
  instanceId: string;
  gameProfileId: string;
  adapterType: AdapterType;
  assignedBots: BotLaunchPlan[];
  timestamp: string;
  status: GameInstanceRuntimeStatus;
  saveProfileId?: string;
  isolatedSaveDirectory?: string;
  saveIsolationMode?: SaveIsolationMode;
  saveIsolationCleanedUp?: boolean;
}): GameInstanceStatus {
  return {
    instanceId: input.instanceId,
    gameProfileId: input.gameProfileId,
    adapterType: input.adapterType,
    status: input.status,
    assignedBots: input.assignedBots.map((bot) => bot.botId),
    startTime: input.timestamp,
    lastHeartbeat: input.timestamp,
    saveProfileId: input.saveProfileId,
    isolatedSaveDirectory: input.isolatedSaveDirectory,
    saveIsolationMode: input.saveIsolationMode,
    saveIsolationCleanedUp: input.saveIsolationCleanedUp
  };
}

function needsLocalSaveDirectory(mode: SaveIsolationMode): boolean {
  return [
    'copy-directory',
    'temp-directory',
    'launch-argument-profile',
    'environment-variable'
  ].includes(mode);
}

function workingSaveRoot(input: {
  runConfig: SimulationRunConfig;
  gameProfile: GameProfile;
  saveIsolation: SaveIsolationConfig;
}): string {
  const configuredRoot = input.saveIsolation.workingSaveRoot?.trim();
  const root = configuredRoot && configuredRoot.length > 0
    ? configuredRoot
    : joinPath('runs', input.runConfig.sessionId, 'saves');

  return resolvePath(root);
}

function replaceTemplateTokens(
  template: string,
  values: {
    savePath?: string;
    profileId?: string;
    instanceId: string;
    sessionId: string;
    botIds: string;
  }
): string {
  return template
    .replaceAll('{savePath}', values.savePath ?? '')
    .replaceAll('{saveProfilePath}', values.savePath ?? '')
    .replaceAll('{profileId}', values.profileId ?? '')
    .replaceAll('{instanceId}', values.instanceId)
    .replaceAll('{sessionId}', values.sessionId)
    .replaceAll('{botIds}', values.botIds);
}

function saveIsolationRuntimeInfo(input: {
  instanceId: string;
  assignedBots: BotLaunchPlan[];
  runConfig: SimulationRunConfig;
  gameProfile: GameProfile;
  capabilities: GameInstanceManagerCapabilities;
}): SaveIsolationRuntimeInfo | undefined {
  const { instanceId, assignedBots, runConfig, gameProfile, capabilities } = input;
  const saveIsolation = saveIsolationFor(gameProfile);
  const adapterSupportsSaveIsolation = capabilities.supportsSaveIsolation && gameProfile.adapter.supportsSaveIsolation;

  if (saveIsolation.mode === 'none' || !adapterSupportsSaveIsolation) {
    return undefined;
  }

  const profileId = `${runConfig.sessionId}-${instanceId}`;
  const isolatedSaveDirectory = needsLocalSaveDirectory(saveIsolation.mode)
    ? joinPath(workingSaveRoot({ runConfig, gameProfile, saveIsolation }), safePathSegment(instanceId))
    : undefined;
  const botIds = assignedBots.map((bot) => bot.botId).join(',');
  const resolvedProfileArgument = saveIsolation.profileArgumentTemplate && saveIsolation.mode === 'launch-argument-profile'
    ? replaceTemplateTokens(saveIsolation.profileArgumentTemplate, {
        savePath: isolatedSaveDirectory,
        profileId,
        instanceId,
        sessionId: runConfig.sessionId,
        botIds
      })
    : undefined;
  const environmentVariableValue = saveIsolation.mode === 'environment-variable'
    ? isolatedSaveDirectory ?? profileId
    : undefined;

  return {
    mode: saveIsolation.mode,
    profileId,
    sourceSavePath: saveIsolation.sourceSavePath,
    workingSaveRoot: workingSaveRoot({ runConfig, gameProfile, saveIsolation }),
    isolatedSaveDirectory,
    profileArgumentTemplate: saveIsolation.profileArgumentTemplate,
    resolvedProfileArgument,
    environmentVariableName: saveIsolation.environmentVariableName,
    environmentVariableValue,
    cleanupTempSaves: saveIsolation.cleanupTempSaves,
    preserveBotSaves: saveIsolation.preserveBotSaves,
    warnings: []
  };
}

function configForInstance(input: {
  instanceId: string;
  assignedBots: BotLaunchPlan[];
  runConfig: SimulationRunConfig;
  gameProfile: GameProfile;
  capabilities: GameInstanceManagerCapabilities;
}): GameInstanceConfig {
  const { instanceId, assignedBots, runConfig, gameProfile, capabilities } = input;
  const saveIsolation = saveIsolationRuntimeInfo(input);
  const launchArguments = [...gameProfile.launch.arguments];
  const environment: Record<string, string> = {
    GAMEPLAY_SIMULATOR_SESSION_ID: runConfig.sessionId,
    GAMEPLAY_SIMULATOR_INSTANCE_ID: instanceId,
    GAMEPLAY_SIMULATOR_ASSIGNED_BOTS: assignedBots.map((bot) => bot.botId).join(',')
  };

  if (saveIsolation?.profileId) {
    environment.GAMEPLAY_SIMULATOR_SAVE_PROFILE_ID = saveIsolation.profileId;
  }

  if (saveIsolation?.isolatedSaveDirectory) {
    environment.GAMEPLAY_SIMULATOR_SAVE_DIRECTORY = saveIsolation.isolatedSaveDirectory;
  }

  if (saveIsolation?.mode === 'environment-variable' && saveIsolation.environmentVariableName && saveIsolation.environmentVariableValue) {
    environment[saveIsolation.environmentVariableName] = saveIsolation.environmentVariableValue;
  }

  if (saveIsolation?.mode === 'launch-argument-profile' && saveIsolation.resolvedProfileArgument) {
    launchArguments.push(saveIsolation.resolvedProfileArgument);
  }

  return {
    instanceId,
    gameProfileId: gameProfile.gameId,
    launch: {
      ...gameProfile.launch,
      arguments: launchArguments
    },
    saveProfileId: saveIsolation?.profileId,
    isolatedSaveDirectory: saveIsolation?.isolatedSaveDirectory,
    saveIsolation,
    maxBots: Math.max(1, assignedBots.length),
    environment
  };
}

function extractProcessIdFromDetails(details: Record<string, unknown>): number | undefined {
  const processInfo = details.processInfo;

  if (isRecord(processInfo)) {
    return numericValue(processInfo.pid);
  }

  return undefined;
}

function extractProcessId(
  instance: ManagedGameAdapterInstance | undefined,
  health: ManagedAdapterHealth | undefined
): number | undefined {
  const metadataProcessId = numericValue(instance?.metadata.processId);
  const healthProcessId = health ? extractProcessIdFromDetails(health.details) : undefined;
  const processId = metadataProcessId ?? healthProcessId;

  return processId !== undefined && processId > 0 ? Math.floor(processId) : undefined;
}

function extractResourceUsage(health: ManagedAdapterHealth): GameInstanceResourceUsage | undefined {
  const directUsage = health.details.resourceUsage;
  const source = isRecord(directUsage)
    ? directUsage
    : isRecord(health.details.processInfo)
      ? health.details.processInfo
      : undefined;

  if (!source) {
    return undefined;
  }

  const usage: GameInstanceResourceUsage = {};
  const cpuPercent = numericValue(source.cpuPercent);
  const ramMb = numericValue(source.ramMb) ?? numericValue(source.memoryMb);
  const gpuPercent = numericValue(source.gpuPercent);

  if (cpuPercent !== undefined) {
    usage.cpuPercent = cpuPercent;
  }

  if (ramMb !== undefined) {
    usage.ramMb = ramMb;
  }

  if (gpuPercent !== undefined) {
    usage.gpuPercent = gpuPercent;
  }

  return Object.keys(usage).length > 0 ? usage : undefined;
}

function cloneStatus(status: GameInstanceStatus): GameInstanceStatus {
  return {
    ...status,
    assignedBots: [...status.assignedBots],
    resourceUsage: status.resourceUsage ? { ...status.resourceUsage } : undefined
  };
}

function cloneConfig(config: GameInstanceConfig): GameInstanceConfig {
  return {
    ...config,
    launch: {
      ...config.launch,
      arguments: [...config.launch.arguments]
    },
    environment: { ...config.environment },
    saveIsolation: config.saveIsolation
      ? {
          ...config.saveIsolation,
          warnings: [...config.saveIsolation.warnings]
        }
      : undefined
  };
}

function cloneAdapterInstance(instance: ManagedGameAdapterInstance): ManagedGameAdapterInstance {
  return {
    ...instance,
    metadata: { ...instance.metadata }
  };
}

function cloneHealth(health: ManagedAdapterHealth): ManagedAdapterHealth {
  return {
    ...health,
    details: { ...health.details }
  };
}

function cloneLiveRecord(record: LiveGameInstanceRecord): LiveGameInstanceRecord {
  return {
    ...record,
    config: cloneConfig(record.config),
    status: cloneStatus(record.status),
    adapterInstance: record.adapterInstance ? cloneAdapterInstance(record.adapterInstance) : undefined,
    health: record.health ? cloneHealth(record.health) : undefined
  };
}

function mapHealthStatus(
  currentStatus: GameInstanceRuntimeStatus,
  running: boolean,
  health: ManagedAdapterHealth | undefined
): GameInstanceRuntimeStatus {
  if (currentStatus === 'stopping' || currentStatus === 'stopped') {
    return running ? 'running' : currentStatus;
  }

  if (!health) {
    return running ? 'running' : 'unresponsive';
  }

  if (health.status === 'failed') {
    return 'failed';
  }

  if (health.status === 'degraded') {
    return 'unresponsive';
  }

  if (!running) {
    return currentStatus === 'starting' ||
      currentStatus === 'running' ||
      currentStatus === 'unresponsive' ||
      currentStatus === 'failed'
      ? 'crashed'
      : currentStatus;
  }

  return 'running';
}

export function planGameInstances(input: GameInstancePlanningInput): GameInstancePlan {
  const timestamp = input.now ?? nowIso();
  const capabilities = mergeCapabilities(input);
  const adapterType = input.adapterType ?? input.runConfig.adapterType;
  const concurrencyModel = resolveConcurrencyModel(input.runConfig, capabilities);
  const sortedLaunchPlans = [...input.launchPlans].sort((a, b) => a.launchIndex - b.launchIndex);
  const startupLaunchPlans = sortedLaunchPlans.filter(isStartupFlowPlan);
  const normalLaunchPlans = sortedLaunchPlans.filter((plan) => !isStartupFlowPlan(plan));
  const instanceCount = estimateInstanceCount(
    normalLaunchPlans.length > 0 ? normalLaunchPlans.length : sortedLaunchPlans.length,
    input.runConfig,
    capabilities,
    concurrencyModel
  );
  const instanceCapacity = capacityPerInstance(input.runConfig, capabilities);
  const saveIsolation = saveIsolationFor(input.gameProfile);
  const warnings: string[] = [];
  const instances: PlannedGameInstance[] = [];

  if (!capabilities.supportsMultipleInstances && input.runConfig.runMode !== 'sequential') {
    warnings.push('Adapter does not support multiple game instances, so this run will use sequential batches.');
  }

  if (!capabilities.supportsMultipleBotsPerInstance && input.runConfig.perGameInstanceBotLimit > 1) {
    warnings.push('Adapter supports one active bot per game instance; extra bots are queued or spread across instances.');
  }

  if (saveIsolation.mode !== 'none' && (!capabilities.supportsSaveIsolation || !input.gameProfile.adapter.supportsSaveIsolation)) {
    warnings.push('Save isolation is configured, but the selected adapter/profile says save isolation is not supported.');
  }

  if (instanceCount > 1 && saveIsolation.mode === 'none') {
    warnings.push(
      'Multiple game instances are planned without save isolation. Bots may overwrite or corrupt the same save/profile data.'
    );
  }

  for (let index = 0; index < instanceCount; index += 1) {
    const instanceId = `game-instance-${padIndex(index + 1)}`;
    instances.push({
      instanceId,
      assignedBots: [],
      queuedBots: [],
      config: {
        instanceId,
        gameProfileId: input.gameProfile.gameId,
        launch: input.gameProfile.launch,
        maxBots: 1,
        environment: {}
      },
      status: statusForInstance({
        instanceId,
        gameProfileId: input.gameProfile.gameId,
        adapterType,
        assignedBots: [],
        timestamp,
        status: input.defaultStatus ?? 'stopped'
      })
    });
  }

  const activeCapacity = instanceCount * instanceCapacity;
  const queuedBotIds: string[] = [];

  for (const bot of startupLaunchPlans) {
    const instance = instances[0];

    if (!instance) {
      queuedBotIds.push(bot.botId);
      continue;
    }

    instance.assignedBots.push(bot);
  }

  normalLaunchPlans.forEach((bot, index) => {
    if (index >= activeCapacity || instances.length === 0) {
      queuedBotIds.push(bot.botId);
      return;
    }

    const instanceIndex = capabilities.supportsMultipleBotsPerInstance
      ? Math.floor(index / instanceCapacity)
      : index;
    const instance = instances[Math.min(instanceIndex, instances.length - 1)];
    instance.assignedBots.push(bot);
  });

  if (queuedBotIds.length > 0) {
    warnings.push(
      `${queuedBotIds.length} bot${queuedBotIds.length === 1 ? ' is' : 's are'} queued for later batches.`
    );
  }

  for (const instance of instances) {
    instance.queuedBots = sortedLaunchPlans.filter((bot) => queuedBotIds.includes(bot.botId));
    instance.config = configForInstance({
      instanceId: instance.instanceId,
      assignedBots: instance.assignedBots,
      runConfig: input.runConfig,
      gameProfile: input.gameProfile,
      capabilities
    });
    instance.status = statusForInstance({
      instanceId: instance.instanceId,
      gameProfileId: input.gameProfile.gameId,
      adapterType,
      assignedBots: instance.assignedBots,
      timestamp,
      status: input.defaultStatus ?? 'stopped',
      saveProfileId: instance.config.saveProfileId,
      isolatedSaveDirectory: instance.config.isolatedSaveDirectory,
      saveIsolationMode: instance.config.saveIsolation?.mode
    });
  }

  return {
    mode: input.runConfig.runMode,
    concurrencyModel,
    capabilities,
    instances,
    queuedBotIds,
    warnings
  };
}

export function planGameInstanceStatuses(input: GameInstancePlanningInput): GameInstanceStatus[] {
  return planGameInstances(input).instances.map((instance) => cloneStatus(instance.status));
}

export class GameInstanceManager {
  private readonly adapter: ManagedGameAdapter;
  private readonly runConfig: SimulationRunConfig;
  private readonly gameProfile: GameProfile;
  private readonly restartCrashedInstances: boolean;
  private readonly fileSystem?: GameInstanceManagerFileSystem;
  private readonly now: () => string;
  private readonly statuses = new Map<string, GameInstanceStatus>();
  private readonly records = new Map<string, LiveGameInstanceRecord>();
  private readonly events: GameInstanceManagerEvent[] = [];
  private plan: GameInstancePlan;

  constructor(options: GameInstanceManagerOptions) {
    this.adapter = options.adapter;
    this.runConfig = options.runConfig;
    this.gameProfile = options.gameProfile;
    this.restartCrashedInstances = options.restartCrashedInstances ?? false;
    this.fileSystem = options.fileSystem;
    this.now = options.now ?? nowIso;
    this.plan = planGameInstances({
      runConfig: options.runConfig,
      gameProfile: options.gameProfile,
      launchPlans: options.launchPlans,
      adapterType: options.adapter.adapterType,
      adapterCapabilities: options.adapter.capabilities,
      defaultStatus: 'stopped',
      now: this.now()
    });

    this.resetStatusesFromPlan();
  }

  getPlan(): GameInstancePlan {
    return {
      ...this.plan,
      instances: this.plan.instances.map((instance) => ({
        ...instance,
        assignedBots: [...instance.assignedBots],
        queuedBots: [...instance.queuedBots],
        config: cloneConfig(instance.config),
        status: cloneStatus(this.statuses.get(instance.instanceId) ?? instance.status)
      })),
      queuedBotIds: [...this.plan.queuedBotIds],
      warnings: [...this.plan.warnings]
    };
  }

  getStatuses(): GameInstanceStatus[] {
    return [...this.statuses.values()].map(cloneStatus);
  }

  getAllInstanceStatuses(): GameInstanceStatus[] {
    return this.getStatuses();
  }

  getInstanceStatus(instanceId: string): GameInstanceStatus {
    return cloneStatus(this.requireStatus(instanceId));
  }

  getLiveInstanceRecords(): LiveGameInstanceRecord[] {
    return [...this.records.values()].map(cloneLiveRecord);
  }

  getLiveInstanceRecord(instanceId: string): LiveGameInstanceRecord {
    return cloneLiveRecord(this.requireRecord(instanceId));
  }

  drainEvents(): GameInstanceManagerEvent[] {
    return this.events.splice(0).map((event) => ({
      ...event,
      details: event.details ? { ...event.details } : undefined
    }));
  }

  getAssignedLaunchPlans(): BotLaunchPlan[] {
    return this.plan.instances.flatMap((instance) =>
      instance.assignedBots.map((bot) => ({
        ...bot,
        assignedGameInstanceId: instance.instanceId
      }))
    );
  }

  getQueuedBotIds(): string[] {
    return [...this.plan.queuedBotIds];
  }

  getAssignedBotIds(instanceId: string): string[] {
    return [...(this.statuses.get(instanceId)?.assignedBots ?? [])];
  }

  assignBotsToInstances(launchPlans: BotLaunchPlan[]): GameInstanceStatus[] {
    this.plan = planGameInstances({
      runConfig: this.runConfig,
      gameProfile: this.gameProfile,
      launchPlans,
      adapterType: this.adapter.adapterType,
      adapterCapabilities: this.adapter.capabilities,
      defaultStatus: 'stopped',
      now: this.now()
    });
    this.resetStatusesFromPlan();

    return this.getStatuses();
  }

  async launchInstances(): Promise<GameInstanceStatus[]> {
    return this.startAllInstances();
  }

  async startAllInstances(): Promise<GameInstanceStatus[]> {
    for (const instance of this.plan.instances) {
      await this.launchInstance(instance.instanceId);
    }

    return this.getStatuses();
  }

  async launchInstance(instanceId: string): Promise<GameInstanceStatus> {
    const planned = this.requirePlannedInstance(instanceId);
    const current = this.requireStatus(instanceId);

    if (current.status === 'running') {
      return cloneStatus(current);
    }

    const startedAt = this.now();
    this.setStatus(instanceId, {
      status: 'starting',
      startTime: startedAt,
      lastHeartbeat: startedAt
    });
    let launchConfig = cloneConfig(planned.config);
    this.updateRecord(instanceId, {
      config: cloneConfig(launchConfig),
      status: this.requireStatus(instanceId),
      lastError: undefined,
      stoppedAt: undefined
    });

    try {
      launchConfig = await this.prepareSaveIsolation(instanceId, launchConfig);
      planned.config = cloneConfig(launchConfig);
      this.updateRecord(instanceId, {
        config: cloneConfig(launchConfig),
        status: this.requireStatus(instanceId)
      });

      const launched = await this.adapter.launchInstance(launchConfig);
      const timestamp = launched.startedAt || this.now();

      this.setStatus(instanceId, {
        status: 'running',
        startTime: timestamp,
        lastHeartbeat: timestamp,
        processId: extractProcessId(launched, undefined),
        saveProfileId: launchConfig.saveProfileId,
        isolatedSaveDirectory: launchConfig.isolatedSaveDirectory,
        saveIsolationMode: launchConfig.saveIsolation?.mode,
        saveIsolationCleanedUp: Boolean(launchConfig.saveIsolation?.cleanedUpAt)
      });
      this.updateRecord(instanceId, {
        adapterInstance: cloneAdapterInstance(launched),
        config: cloneConfig(launchConfig),
        status: this.requireStatus(instanceId),
        launchedAt: timestamp,
        lastError: undefined
      });
      this.pushEvent({
        eventType: 'instance_start',
        instanceId,
        timestamp,
        status: 'running',
        previousStatus: current.status,
        details: {
          adapterType: this.adapter.adapterType,
          assignedBots: planned.assignedBots.map((bot) => bot.botId),
          saveProfileId: launchConfig.saveProfileId,
          isolatedSaveDirectory: launchConfig.isolatedSaveDirectory,
          saveIsolation: launchConfig.saveIsolation
        }
      });
    } catch (error) {
      await this.cleanupSaveIsolation(instanceId, launchConfig).catch(() => undefined);
      const message = error instanceof Error ? error.message : 'Unknown game instance launch failure.';
      const timestamp = this.now();
      this.setStatus(instanceId, {
        status: 'failed',
        lastHeartbeat: timestamp,
        saveProfileId: launchConfig.saveProfileId,
        isolatedSaveDirectory: launchConfig.isolatedSaveDirectory,
        saveIsolationMode: launchConfig.saveIsolation?.mode,
        saveIsolationCleanedUp: Boolean(launchConfig.saveIsolation?.cleanedUpAt)
      });
      this.updateRecord(instanceId, {
        config: cloneConfig(launchConfig),
        status: this.requireStatus(instanceId),
        lastError: message
      });
      this.pushEvent({
        eventType: 'instance_crash',
        instanceId,
        timestamp,
        status: 'failed',
        previousStatus: current.status,
        message,
        details: {
          reason: 'launch_failed',
          saveIsolation: launchConfig.saveIsolation
        }
      });
      throw error;
    }

    return cloneStatus(this.requireStatus(instanceId));
  }

  async stopInstance(instanceId: string): Promise<GameInstanceStatus> {
    const planned = this.requirePlannedInstance(instanceId);
    const previousStatus = this.requireStatus(instanceId).status;
    const timestamp = this.now();
    this.setStatus(instanceId, {
      status: 'stopping',
      lastHeartbeat: timestamp
    });

    await this.adapter.stopInstance(instanceId);
    await this.cleanupSaveIsolation(instanceId, planned.config);
    const stoppedAt = this.now();
    this.setStatus(instanceId, {
      status: 'stopped',
      lastHeartbeat: stoppedAt,
      saveProfileId: planned.config.saveProfileId,
      isolatedSaveDirectory: planned.config.isolatedSaveDirectory,
      saveIsolationMode: planned.config.saveIsolation?.mode,
      saveIsolationCleanedUp: Boolean(planned.config.saveIsolation?.cleanedUpAt)
    });
    this.updateRecord(instanceId, {
      config: cloneConfig(planned.config),
      status: this.requireStatus(instanceId),
      stoppedAt
    });
    this.pushEvent({
      eventType: 'instance_stop',
      instanceId,
      timestamp: stoppedAt,
      status: 'stopped',
      previousStatus,
      details: {
        assignedBots: this.requireStatus(instanceId).assignedBots,
        saveProfileId: planned.config.saveProfileId,
        isolatedSaveDirectory: planned.config.isolatedSaveDirectory,
        saveIsolation: planned.config.saveIsolation
      }
    });

    return cloneStatus(this.requireStatus(instanceId));
  }

  async stopAll(): Promise<GameInstanceStatus[]> {
    return this.stopAllInstances();
  }

  async stopAllInstances(): Promise<GameInstanceStatus[]> {
    for (const status of this.getStatuses()) {
      if (status.status !== 'stopped') {
        await this.stopInstance(status.instanceId);
      }
    }

    await this.adapter.stopAll?.();

    return this.getStatuses();
  }

  async refreshHealth(): Promise<GameInstanceStatus[]> {
    for (const current of this.getStatuses()) {
      if (current.status === 'stopped' || current.status === 'stopping') {
        continue;
      }

      let running = false;
      let health: ManagedAdapterHealth | undefined;
      let healthError: string | undefined;

      try {
        running = await this.adapter.isRunning(current.instanceId);
        health = await this.adapter.getHealth(current.instanceId);
      } catch (error) {
        running = false;
        healthError = error instanceof Error ? error.message : 'Instance health check failed.';
      }

      const nextStatus = mapHealthStatus(current.status, running, health);
      const timestamp = health?.checkedAt ?? this.now();

      this.setStatus(current.instanceId, {
        status: nextStatus,
        lastHeartbeat: timestamp,
        processId: extractProcessId(undefined, health) ?? current.processId,
        resourceUsage: health ? extractResourceUsage(health) : current.resourceUsage
      });
      this.updateRecord(current.instanceId, {
        status: this.requireStatus(current.instanceId),
        health: health ? cloneHealth(health) : undefined,
        lastError: healthError
      });

      if (nextStatus !== current.status) {
        if (nextStatus === 'crashed' || nextStatus === 'failed') {
          this.pushEvent({
            eventType: 'instance_crash',
            instanceId: current.instanceId,
            timestamp,
            status: nextStatus,
            previousStatus: current.status,
            message:
              healthError ??
              health?.message ??
              (nextStatus === 'failed'
                ? 'Adapter reported a failed game instance.'
                : 'Game instance stopped unexpectedly.'),
            details: {
              running,
              healthStatus: health?.status
            }
          });
        } else if (nextStatus === 'unresponsive') {
          this.pushEvent({
            eventType: 'instance_health_warning',
            instanceId: current.instanceId,
            timestamp,
            status: nextStatus,
            previousStatus: current.status,
            message: healthError ?? health?.message ?? 'Game instance health check reports unresponsive state.',
            details: {
              running,
              healthStatus: health?.status
            }
          });
        }
      }

      if ((nextStatus === 'crashed' || nextStatus === 'failed') && this.restartCrashedInstances) {
        await this.restartInstance(current.instanceId);
      }
    }

    return this.getStatuses();
  }

  async restartInstance(instanceId: string): Promise<GameInstanceStatus> {
    this.requirePlannedInstance(instanceId);
    const previousStatus = this.requireStatus(instanceId).status;
    const timestamp = this.now();
    this.pushEvent({
      eventType: 'instance_restart',
      instanceId,
      timestamp,
      status: previousStatus,
      previousStatus,
      message: 'Restarting game instance after crash, failure, or manual restart request.'
    });

    try {
      if (await this.adapter.isRunning(instanceId)) {
        await this.adapter.stopInstance(instanceId);
      }
    } catch {
      // Restart still proceeds because a failed health check often means the process is already gone.
    }

    return this.launchInstance(instanceId);
  }

  private async prepareSaveIsolation(
    instanceId: string,
    config: GameInstanceConfig
  ): Promise<GameInstanceConfig> {
    if (!config.saveIsolation) {
      return config;
    }

    const nextConfig = cloneConfig(config);
    const saveIsolation = nextConfig.saveIsolation!;
    const warnings = [...saveIsolation.warnings];

    if (saveIsolation.isolatedSaveDirectory) {
      const fs = this.requireFileSystem();

      if (saveIsolation.sourceSavePath) {
        await fs.rm(saveIsolation.isolatedSaveDirectory, { recursive: true, force: true });
        await fs.cp(saveIsolation.sourceSavePath, saveIsolation.isolatedSaveDirectory, {
          recursive: true,
          force: true
        });
        saveIsolation.copiedFromSource = true;
      } else {
        if (saveIsolation.mode === 'copy-directory' && !saveIsolation.sourceSavePath) {
          warnings.push('Copy-directory save isolation has no source save path, so an empty save folder was created.');
        }

        await fs.mkdir(saveIsolation.isolatedSaveDirectory, { recursive: true });
        saveIsolation.copiedFromSource = false;
      }
    }

    saveIsolation.createdAt = this.now();
    saveIsolation.warnings = warnings;
    nextConfig.saveIsolation = saveIsolation;
    this.pushEvent({
      eventType: 'instance_save_isolation',
      instanceId,
      timestamp: saveIsolation.createdAt,
      status: this.requireStatus(instanceId).status,
      message: saveIsolation.isolatedSaveDirectory
        ? `Prepared isolated save/profile directory at ${saveIsolation.isolatedSaveDirectory}.`
        : `Prepared ${saveIsolation.mode} save/profile isolation.`,
      details: {
        action: 'prepare',
        saveIsolation
      }
    });

    return nextConfig;
  }

  private async cleanupSaveIsolation(instanceId: string, config: GameInstanceConfig): Promise<void> {
    const saveIsolation = config.saveIsolation;

    if (
      !saveIsolation?.isolatedSaveDirectory ||
      saveIsolation.mode !== 'temp-directory' ||
      !saveIsolation.cleanupTempSaves ||
      saveIsolation.preserveBotSaves
    ) {
      return;
    }

    const fs = this.requireFileSystem();
    await fs.rm(saveIsolation.isolatedSaveDirectory, { recursive: true, force: true });
    saveIsolation.cleanedUpAt = this.now();
    config.saveIsolation = {
      ...saveIsolation,
      warnings: [...saveIsolation.warnings]
    };
    this.pushEvent({
      eventType: 'instance_save_isolation',
      instanceId,
      timestamp: saveIsolation.cleanedUpAt,
      status: this.requireStatus(instanceId).status,
      message: `Cleaned up temporary save/profile directory at ${saveIsolation.isolatedSaveDirectory}.`,
      details: {
        action: 'cleanup',
        saveIsolation: config.saveIsolation
      }
    });
  }

  private resetStatusesFromPlan(): void {
    this.statuses.clear();
    this.records.clear();

    for (const instance of this.plan.instances) {
      const status = cloneStatus(instance.status);
      this.statuses.set(instance.instanceId, status);
      this.records.set(instance.instanceId, {
        instanceId: instance.instanceId,
        gameProfileId: this.gameProfile.gameId,
        config: cloneConfig(instance.config),
        status
      });
    }
  }

  private requireFileSystem(): GameInstanceManagerFileSystem {
    if (!this.fileSystem) {
      throw new Error('Save isolation needs filesystem access from the backend runtime.');
    }

    return this.fileSystem;
  }

  private requirePlannedInstance(instanceId: string): PlannedGameInstance {
    const planned = this.plan.instances.find((instance) => instance.instanceId === instanceId);

    if (!planned) {
      throw new Error(`Game instance "${instanceId}" is not part of this manager plan.`);
    }

    return planned;
  }

  private requireStatus(instanceId: string): GameInstanceStatus {
    const status = this.statuses.get(instanceId);

    if (!status) {
      throw new Error(`Game instance "${instanceId}" is not tracked.`);
    }

    return status;
  }

  private requireRecord(instanceId: string): LiveGameInstanceRecord {
    const record = this.records.get(instanceId);

    if (!record) {
      throw new Error(`Game instance "${instanceId}" does not have a live record.`);
    }

    return record;
  }

  private setStatus(instanceId: string, patch: Partial<GameInstanceStatus>): void {
    const current = this.requireStatus(instanceId);
    const nextStatus = {
      ...current,
      ...patch,
      assignedBots: patch.assignedBots ? [...patch.assignedBots] : current.assignedBots,
      resourceUsage:
        patch.resourceUsage === undefined
          ? current.resourceUsage
          : patch.resourceUsage
            ? { ...patch.resourceUsage }
            : undefined
    };
    this.statuses.set(instanceId, nextStatus);
    this.updateRecord(instanceId, {
      status: nextStatus
    });
  }

  private updateRecord(instanceId: string, patch: Partial<LiveGameInstanceRecord>): void {
    const current = this.records.get(instanceId);

    if (!current) {
      return;
    }

    this.records.set(instanceId, {
      ...current,
      ...patch,
      config: patch.config ? cloneConfig(patch.config) : current.config,
      status: patch.status ? cloneStatus(patch.status) : current.status,
      adapterInstance:
        patch.adapterInstance === undefined
          ? current.adapterInstance
          : patch.adapterInstance
            ? cloneAdapterInstance(patch.adapterInstance)
            : undefined,
      health:
        patch.health === undefined
          ? current.health
          : patch.health
            ? cloneHealth(patch.health)
            : undefined
    });
  }

  private pushEvent(event: GameInstanceManagerEvent): void {
    this.events.push({
      ...event,
      details: event.details ? { ...event.details } : undefined
    });
  }
}
