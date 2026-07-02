import type {
  AdapterType,
  BotLaunchPlan,
  GameInstanceConfig,
  GameInstanceResourceUsage,
  GameInstanceRuntimeStatus,
  GameInstanceStatus,
  GameProfile,
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
  now?: () => string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function padIndex(value: number): string {
  return value.toString().padStart(3, '0');
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
}): GameInstanceStatus {
  return {
    instanceId: input.instanceId,
    gameProfileId: input.gameProfileId,
    adapterType: input.adapterType,
    status: input.status,
    assignedBots: input.assignedBots.map((bot) => bot.botId),
    startTime: input.timestamp,
    lastHeartbeat: input.timestamp
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
  const usesSaveIsolation = capabilities.supportsSaveIsolation && gameProfile.adapter.supportsSaveIsolation;

  return {
    instanceId,
    gameProfileId: gameProfile.gameId,
    launch: gameProfile.launch,
    saveProfileId: usesSaveIsolation ? `${runConfig.sessionId}-${instanceId}` : undefined,
    isolatedSaveDirectory: usesSaveIsolation
      ? `runs/${runConfig.sessionId}/saves/${instanceId}`
      : undefined,
    maxBots: Math.max(1, assignedBots.length),
    environment: {
      GAMEPLAY_SIMULATOR_SESSION_ID: runConfig.sessionId,
      GAMEPLAY_SIMULATOR_INSTANCE_ID: instanceId,
      GAMEPLAY_SIMULATOR_ASSIGNED_BOTS: assignedBots.map((bot) => bot.botId).join(',')
    }
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
    return 'crashed';
  }

  if (health.status === 'degraded') {
    return 'unresponsive';
  }

  if (!running) {
    return currentStatus === 'starting' || currentStatus === 'running' || currentStatus === 'unresponsive'
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
  const instanceCount = estimateInstanceCount(
    sortedLaunchPlans.length,
    input.runConfig,
    capabilities,
    concurrencyModel
  );
  const instanceCapacity = capacityPerInstance(input.runConfig, capabilities);
  const warnings: string[] = [];
  const instances: PlannedGameInstance[] = [];

  if (!capabilities.supportsMultipleInstances && input.runConfig.runMode !== 'sequential') {
    warnings.push('Adapter does not support multiple game instances, so this run will use sequential batches.');
  }

  if (!capabilities.supportsMultipleBotsPerInstance && input.runConfig.perGameInstanceBotLimit > 1) {
    warnings.push('Adapter supports one active bot per game instance; extra bots are queued or spread across instances.');
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

  sortedLaunchPlans.forEach((bot, index) => {
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
      status: input.defaultStatus ?? 'stopped'
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
  private readonly now: () => string;
  private readonly statuses = new Map<string, GameInstanceStatus>();
  private plan: GameInstancePlan;

  constructor(options: GameInstanceManagerOptions) {
    this.adapter = options.adapter;
    this.runConfig = options.runConfig;
    this.gameProfile = options.gameProfile;
    this.restartCrashedInstances = options.restartCrashedInstances ?? false;
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
        config: {
          ...instance.config,
          launch: { ...instance.config.launch, arguments: [...instance.config.launch.arguments] },
          environment: { ...instance.config.environment }
        },
        status: cloneStatus(this.statuses.get(instance.instanceId) ?? instance.status)
      })),
      queuedBotIds: [...this.plan.queuedBotIds],
      warnings: [...this.plan.warnings]
    };
  }

  getStatuses(): GameInstanceStatus[] {
    return [...this.statuses.values()].map(cloneStatus);
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

    this.setStatus(instanceId, {
      status: 'starting',
      lastHeartbeat: this.now()
    });

    try {
      const launched = await this.adapter.launchInstance(planned.config);
      const timestamp = launched.startedAt || this.now();

      this.setStatus(instanceId, {
        status: 'running',
        startTime: timestamp,
        lastHeartbeat: timestamp,
        processId: extractProcessId(launched, undefined)
      });
    } catch (error) {
      this.setStatus(instanceId, {
        status: 'crashed',
        lastHeartbeat: this.now()
      });
      throw error;
    }

    return cloneStatus(this.requireStatus(instanceId));
  }

  async stopInstance(instanceId: string): Promise<GameInstanceStatus> {
    this.requirePlannedInstance(instanceId);
    this.setStatus(instanceId, {
      status: 'stopping',
      lastHeartbeat: this.now()
    });

    await this.adapter.stopInstance(instanceId);
    this.setStatus(instanceId, {
      status: 'stopped',
      lastHeartbeat: this.now()
    });

    return cloneStatus(this.requireStatus(instanceId));
  }

  async stopAll(): Promise<GameInstanceStatus[]> {
    for (const status of this.getStatuses()) {
      if (status.status !== 'stopped') {
        await this.stopInstance(status.instanceId);
      }
    }

    return this.getStatuses();
  }

  async refreshHealth(): Promise<GameInstanceStatus[]> {
    for (const current of this.getStatuses()) {
      if (current.status === 'stopped' || current.status === 'stopping') {
        continue;
      }

      let running = false;
      let health: ManagedAdapterHealth | undefined;

      try {
        running = await this.adapter.isRunning(current.instanceId);
        health = await this.adapter.getHealth(current.instanceId);
      } catch {
        running = false;
      }

      const nextStatus = mapHealthStatus(current.status, running, health);

      this.setStatus(current.instanceId, {
        status: nextStatus,
        lastHeartbeat: health?.checkedAt ?? this.now(),
        processId: extractProcessId(undefined, health) ?? current.processId,
        resourceUsage: health ? extractResourceUsage(health) : current.resourceUsage
      });

      if (nextStatus === 'crashed' && this.restartCrashedInstances) {
        await this.restartInstance(current.instanceId);
      }
    }

    return this.getStatuses();
  }

  async restartInstance(instanceId: string): Promise<GameInstanceStatus> {
    this.requirePlannedInstance(instanceId);

    try {
      if (await this.adapter.isRunning(instanceId)) {
        await this.adapter.stopInstance(instanceId);
      }
    } catch {
      // Restart still proceeds because a failed health check often means the process is already gone.
    }

    return this.launchInstance(instanceId);
  }

  private resetStatusesFromPlan(): void {
    this.statuses.clear();

    for (const instance of this.plan.instances) {
      this.statuses.set(instance.instanceId, cloneStatus(instance.status));
    }
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

  private setStatus(instanceId: string, patch: Partial<GameInstanceStatus>): void {
    const current = this.requireStatus(instanceId);
    this.statuses.set(instanceId, {
      ...current,
      ...patch,
      assignedBots: patch.assignedBots ? [...patch.assignedBots] : current.assignedBots,
      resourceUsage:
        patch.resourceUsage === undefined
          ? current.resourceUsage
          : patch.resourceUsage
            ? { ...patch.resourceUsage }
            : undefined
    });
  }
}
