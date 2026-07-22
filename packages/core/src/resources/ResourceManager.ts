import os from 'node:os';
import {
  defaultRuntimeObservationConfig,
  resolveRuntimeObservationConfig,
  type RuntimeObservationConfig
} from '../config/runtimeObservationConfig';
import type {
  BotPoolConfig,
  GameProfile,
  RuntimeObservationEstimate,
  RuntimeViabilityReport,
  SimulationRunConfig
} from '../types';

export interface GpuInfo {
  name?: string;
  loadPercent?: number;
  memoryTotalMb?: number;
  memoryFreeMb?: number;
}

export interface SystemResourceSnapshot {
  cpuCoreCount: number;
  totalRamMb: number;
  freeRamMb: number;
  currentCpuLoadPercent?: number;
  currentRamUsagePercent: number;
  platform: NodeJS.Platform;
  osRelease: string;
  gpu?: GpuInfo;
}

export interface ResourceCost {
  cpuPercent: number;
  ramMb: number;
  gpuPercent?: number;
}

export interface ResourceManagerAssessment {
  system: SystemResourceSnapshot;
  estimatedCostPerGameInstance: ResourceCost;
  estimatedCostPerBot: Array<{
    profileId: string;
    cost: ResourceCost;
  }>;
  viability: RuntimeViabilityReport;
}

export interface RuntimeViabilityRequest {
  runConfig: SimulationRunConfig;
  gameProfile: GameProfile;
  runtimeObservation?: RuntimeObservationConfig;
  systemSnapshot?: SystemResourceSnapshot;
}

type MutableAllocation = RuntimeViabilityReport['botAllocation'][number] & {
  pool: BotPoolConfig;
};

const MB = 1024 * 1024;

const engineCost: Record<GameProfile['engine']['type'], ResourceCost> = {
  unity: { cpuPercent: 15, ramMb: 1200, gpuPercent: 12 },
  godot: { cpuPercent: 10, ramMb: 760, gpuPercent: 8 },
  unreal: { cpuPercent: 22, ramMb: 1900, gpuPercent: 18 },
  browser: { cpuPercent: 8, ramMb: 520, gpuPercent: 4 },
  custom: { cpuPercent: 12, ramMb: 900, gpuPercent: 8 },
  unknown: { cpuPercent: 12, ramMb: 900, gpuPercent: 8 }
};

const adapterCostFactor: Record<SimulationRunConfig['adapterType'], number> = {
  instrumented: 0.82,
  desktop: 1.18,
  browser: 0.92,
  unity: 1,
  godot: 0.88,
  unreal: 1.18,
  rpg_maker: 0.78,
  gamemaker: 0.78,
  custom: 1
};

const botWeightCost: Record<BotPoolConfig['resourceWeight'], ResourceCost> = {
  light: { cpuPercent: 1.1, ramMb: 72, gpuPercent: 0.2 },
  medium: { cpuPercent: 2.1, ramMb: 140, gpuPercent: 0.5 },
  heavy: { cpuPercent: 4.2, ramMb: 280, gpuPercent: 1.2 },
  very_heavy: { cpuPercent: 7.6, ramMb: 560, gpuPercent: 2.5 }
};

const headedBrowserWindowCost: ResourceCost = { cpuPercent: 2.4, ramMb: 220, gpuPercent: 1 };
const additionalBrowserWindowCost: ResourceCost = { cpuPercent: 1.4, ramMb: 140, gpuPercent: 0.7 };
const additionalObservedWindowCost: ResourceCost = { cpuPercent: 0.15, ramMb: 8, gpuPercent: 0 };
const actionOverlayCost: ResourceCost = { cpuPercent: 0.15, ramMb: 8, gpuPercent: 0.05 };
const focusTrackingCost: ResourceCost = { cpuPercent: 0.2, ramMb: 8, gpuPercent: 0 };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function sumRecommended(allocations: MutableAllocation[]): number {
  return allocations.reduce((total, allocation) => total + allocation.recommendedCount, 0);
}

function scaleCost(cost: ResourceCost, count: number): Required<ResourceCost> {
  return {
    cpuPercent: round(cost.cpuPercent * count),
    ramMb: Math.round(cost.ramMb * count),
    gpuPercent: round((cost.gpuPercent ?? 0) * count)
  };
}

function addCosts(...costs: ResourceCost[]): Required<ResourceCost> {
  return costs.reduce<Required<ResourceCost>>(
    (total, cost) => ({
      cpuPercent: total.cpuPercent + cost.cpuPercent,
      ramMb: total.ramMb + cost.ramMb,
      gpuPercent: total.gpuPercent + (cost.gpuPercent ?? 0)
    }),
    { cpuPercent: 0, ramMb: 0, gpuPercent: 0 }
  );
}

export class ResourceManager {
  collectSystemResources(): SystemResourceSnapshot {
    const cpuCoreCount = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
    const totalRamMb = Math.round(os.totalmem() / MB);
    const freeRamMb = Math.round(os.freemem() / MB);
    const usedRamMb = Math.max(0, totalRamMb - freeRamMb);
    const loadAverage = os.loadavg()[0];
    const currentCpuLoadPercent =
      loadAverage > 0 && cpuCoreCount > 0 ? clamp((loadAverage / cpuCoreCount) * 100, 0, 100) : undefined;

    return {
      cpuCoreCount,
      totalRamMb,
      freeRamMb,
      currentCpuLoadPercent,
      currentRamUsagePercent: totalRamMb > 0 ? round((usedRamMb / totalRamMb) * 100) : 0,
      platform: os.platform(),
      osRelease: os.release(),
      gpu: this.collectGpuInfo()
    };
  }

  estimateCosts(runConfig: SimulationRunConfig, gameProfile: GameProfile): {
    estimatedCostPerGameInstance: ResourceCost;
    estimatedCostPerBot: ResourceManagerAssessment['estimatedCostPerBot'];
  } {
    const base = engineCost[gameProfile.engine.type];
    const adapterFactor = adapterCostFactor[runConfig.adapterType];
    const stateFactor = gameProfile.adapter.supportsStateRead ? 0.92 : 1.08;
    const directActionFactor = gameProfile.adapter.supportsDirectActions ? 0.9 : 1.12;
    const evidenceFactor = runConfig.saveVideo ? 1.24 : runConfig.saveScreenshots ? 1.08 : 1;
    const instanceFactor = adapterFactor * evidenceFactor;

    const estimatedCostPerGameInstance: ResourceCost = {
      cpuPercent: round(base.cpuPercent * instanceFactor),
      ramMb: Math.round(base.ramMb * instanceFactor),
      gpuPercent: round((base.gpuPercent ?? 0) * evidenceFactor)
    };

    const actionDelay = Math.max(50, runConfig.actionDelayMs || 250);
    const actionCadenceFactor = clamp(250 / actionDelay, 0.65, 3);
    const botFactor = adapterFactor * stateFactor * directActionFactor * actionCadenceFactor;

    return {
      estimatedCostPerGameInstance,
      estimatedCostPerBot: runConfig.botPools.map((pool) => {
        const weight = botWeightCost[pool.resourceWeight];

        return {
          profileId: pool.profileId,
          cost: {
            cpuPercent: round(weight.cpuPercent * botFactor),
            ramMb: Math.round(weight.ramMb * botFactor),
            gpuPercent: round((weight.gpuPercent ?? 0) * evidenceFactor)
          }
        };
      })
    };
  }

  async collectAssessment(request: RuntimeViabilityRequest): Promise<ResourceManagerAssessment> {
    const system = request.systemSnapshot ?? this.collectSystemResources();
    const costs = this.estimateCosts(request.runConfig, request.gameProfile);

    return {
      system,
      ...costs,
      viability: this.estimateViabilitySync({ ...request, systemSnapshot: system })
    };
  }

  estimateViabilitySync(request: RuntimeViabilityRequest): RuntimeViabilityReport {
    const system = request.systemSnapshot ?? this.collectSystemResources();
    const { runConfig, gameProfile } = request;
    const runtimeObservation = resolveRuntimeObservationConfig(
      runConfig,
      request.runtimeObservation ?? defaultRuntimeObservationConfig
    );
    const costs = this.estimateCosts(runConfig, gameProfile);
    const costByProfile = new Map(costs.estimatedCostPerBot.map((item) => [item.profileId, item.cost]));
    const warnings: string[] = [];
    const blockers: string[] = [];
    const enabledPools = runConfig.botPools.filter((pool) => pool.enabled);
    const requestedTotal = enabledPools.reduce((total, pool) => total + pool.desiredCount, 0);
    const instanceCapacity = gameProfile.adapter.supportsMultipleInstances
      ? runConfig.resourceLimits.maxGameInstances * runConfig.perGameInstanceBotLimit
      : runConfig.perGameInstanceBotLimit;
    const userCapacity = Math.max(0, Math.min(runConfig.globalBotLimit, instanceCapacity));
    const allocations: MutableAllocation[] = enabledPools.map((pool) => ({
      profileId: pool.profileId,
      requestedCount: pool.desiredCount,
      recommendedCount: pool.scalingMode === 'fixed' ? pool.desiredCount : pool.minCount,
      reason:
        pool.scalingMode === 'fixed'
          ? 'Fixed scaling keeps the requested count unless a hard limit makes it impossible.'
          : 'Auto scaling starts at the configured minimum and grows while resources allow.',
      pool
    }));

    if (!gameProfile.adapter.supportsMultipleInstances && requestedTotal > runConfig.perGameInstanceBotLimit) {
      warnings.push(
        `${gameProfile.gameName} does not support multiple instances, so concurrency is capped by the per-instance bot limit.`
      );
    }

    if (requestedTotal > runConfig.globalBotLimit) {
      warnings.push(
        `Requested ${requestedTotal} bots exceeds the global bot limit of ${runConfig.globalBotLimit}.`
      );
    }

    if (requestedTotal > instanceCapacity) {
      warnings.push(
        `Requested ${requestedTotal} bots needs more concurrent game-instance capacity than currently configured.`
      );
    }

    const fixedTotal = allocations
      .filter((allocation) => allocation.pool.scalingMode === 'fixed')
      .reduce((total, allocation) => total + allocation.recommendedCount, 0);

    if (fixedTotal > userCapacity) {
      blockers.push(
        `Fixed bot pools request ${fixedTotal} bots, but user and instance limits allow ${userCapacity}.`
      );
    }

    this.fitAllocationsToUserCapacity(allocations, userCapacity, warnings, blockers);

    const resourceCapacity = this.calculateResourceCapacity(system, runConfig);
    this.fitAllocationsToResourceCapacity(
      allocations,
      costs.estimatedCostPerGameInstance,
      costByProfile,
      resourceCapacity,
      runConfig,
      gameProfile,
      warnings,
      blockers
    );

    this.growAutoAllocations(
      allocations,
      costs.estimatedCostPerGameInstance,
      costByProfile,
      resourceCapacity,
      userCapacity,
      runConfig,
      gameProfile
    );

    const recommendedTotalBots = sumRecommended(allocations);
    const recommendedGameInstances = this.estimateGameInstances(
      recommendedTotalBots,
      runConfig,
      gameProfile.adapter.supportsMultipleInstances
    );
    const baseEstimated = this.estimateTotalCost(
      allocations,
      recommendedGameInstances,
      costs.estimatedCostPerGameInstance,
      costByProfile
    );
    const observation = this.estimateObservationResources({
      runConfig,
      gameProfile,
      runtimeObservation,
      system,
      totalBotCount: recommendedTotalBots,
      totalRunningGameInstances: recommendedGameInstances,
      baseEstimated,
      resourceCapacity,
      warnings
    });
    const estimated = addCosts(baseEstimated, {
      cpuPercent: observation.estimatedCpuPercent,
      ramMb: observation.estimatedRamMb,
      gpuPercent: observation.estimatedGpuPercent
    });
    const cpuWithCurrentLoad = estimated.cpuPercent + (system.currentCpuLoadPercent ?? 0);
    const ramUsedMb = system.totalRamMb - system.freeRamMb;
    const ramWithCurrentUsage = estimated.ramMb + ramUsedMb + runConfig.resourceLimits.reserveRamMb;
    const maxRamMb = system.totalRamMb * (runConfig.resourceLimits.maxRamPercent / 100);

    if (recommendedTotalBots < requestedTotal) {
      warnings.push(
        `Recommended ${recommendedTotalBots} of ${requestedTotal} requested bots. Allocation reasons explain each reduction.`
      );
    }

    if (requestedTotal > 0 && recommendedTotalBots === 0) {
      blockers.push('No requested bots can fit within the current resource budget.');
    }

    if (cpuWithCurrentLoad > runConfig.resourceLimits.maxCpuPercent) {
      blockers.push(
        `Estimated CPU ${round(cpuWithCurrentLoad)}% exceeds the configured ${runConfig.resourceLimits.maxCpuPercent}% limit.`
      );
    }

    if (ramWithCurrentUsage > maxRamMb) {
      blockers.push(
        `Estimated RAM use ${Math.round(ramWithCurrentUsage)} MB exceeds the configured RAM limit.`
      );
    }

    if (system.currentCpuLoadPercent && system.currentCpuLoadPercent > runConfig.resourceLimits.maxCpuPercent * 0.75) {
      warnings.push(`Current CPU load is already ${round(system.currentCpuLoadPercent)}%.`);
    }

    if (system.currentRamUsagePercent > runConfig.resourceLimits.maxRamPercent * 0.75) {
      warnings.push(`Current RAM usage is already ${round(system.currentRamUsagePercent)}%.`);
    }

    const estimatedGpuPercent =
      estimated.gpuPercent === undefined || estimated.gpuPercent <= 0
        ? undefined
        : round(estimated.gpuPercent + (system.gpu?.loadPercent ?? 0));

    if (
      estimatedGpuPercent !== undefined &&
      runConfig.resourceLimits.maxGpuPercent !== undefined &&
      estimatedGpuPercent > runConfig.resourceLimits.maxGpuPercent
    ) {
      warnings.push(
        `Estimated GPU ${estimatedGpuPercent}% exceeds the configured ${runConfig.resourceLimits.maxGpuPercent}% limit.`
      );
    }

    return {
      canRun: blockers.length === 0 && recommendedTotalBots > 0,
      recommendedTotalBots,
      recommendedGameInstances,
      warnings: [...new Set(warnings)],
      blockers: [...new Set(blockers)],
      estimatedCpuPercent: round(cpuWithCurrentLoad),
      estimatedRamMb: Math.round(estimated.ramMb),
      estimatedGpuPercent,
      botAllocation: allocations.map(({ pool: _pool, ...allocation }) => allocation),
      observation
    };
  }

  private estimateObservationResources(input: {
    runConfig: SimulationRunConfig;
    gameProfile: GameProfile;
    runtimeObservation: RuntimeObservationConfig;
    system: SystemResourceSnapshot;
    totalBotCount: number;
    totalRunningGameInstances: number;
    baseEstimated: ResourceCost;
    resourceCapacity: ResourceCost;
    warnings: string[];
  }): RuntimeObservationEstimate {
    const {
      runConfig,
      gameProfile,
      runtimeObservation,
      system,
      totalBotCount,
      totalRunningGameInstances,
      baseEstimated,
      resourceCapacity,
      warnings
    } = input;
    const observationRequested =
      runtimeObservation.showBotGameplay &&
      runtimeObservation.observationMode !== 'background';
    const enabled =
      observationRequested &&
      totalRunningGameInstances > 0;
    const requestedVisibleGameInstances = !enabled
      ? 0
      : runtimeObservation.observationMode === 'show-all-instances'
        ? Math.min(totalRunningGameInstances, runtimeObservation.maxVisibleGameWindows)
        : Math.min(totalRunningGameInstances, 1);
    const recommendedVisibleWindowLimit = this.recommendedVisibleWindowLimit(system);
    let recommendedVisibleGameInstances = Math.min(
      requestedVisibleGameInstances,
      recommendedVisibleWindowLimit
    );

    while (recommendedVisibleGameInstances > 0) {
      const candidate = this.observationCost(
        gameProfile,
        runtimeObservation,
        recommendedVisibleGameInstances
      );
      const total = addCosts(baseEstimated, candidate.total);

      if (
        total.cpuPercent <= resourceCapacity.cpuPercent &&
        total.ramMb <= resourceCapacity.ramMb &&
        (resourceCapacity.gpuPercent === undefined || total.gpuPercent <= resourceCapacity.gpuPercent)
      ) {
        break;
      }

      recommendedVisibleGameInstances -= 1;
    }

    const cost = this.observationCost(
      gameProfile,
      runtimeObservation,
      recommendedVisibleGameInstances
    );
    const backgroundGameInstances = Math.max(
      0,
      totalRunningGameInstances - recommendedVisibleGameInstances
    );

    if (observationRequested) {
      warnings.push(
        `Visible mode may use more RAM. The current estimate adds about ${cost.total.ramMb} MB for observation.`
      );
    }

    if (observationRequested && runtimeObservation.observationMode === 'show-all-instances') {
      warnings.push('Show All Instances may open several windows and cover the desktop.');
    }

    if (observationRequested && runtimeObservation.maxVisibleGameWindows > recommendedVisibleWindowLimit) {
      warnings.push(
        `The configured visible-window limit of ${runtimeObservation.maxVisibleGameWindows} is higher than the recommended ${recommendedVisibleWindowLimit} for this computer.`
      );
    }

    if (observationRequested && system.currentRamUsagePercent >= 70) {
      warnings.push(
        `The current system is already using significant RAM (${round(system.currentRamUsagePercent)}%). Background mode is safer.`
      );
    }

    if (recommendedVisibleGameInstances < requestedVisibleGameInstances) {
      warnings.push(
        `Only ${recommendedVisibleGameInstances} of ${requestedVisibleGameInstances} requested game windows are recommended as visible. The other ${backgroundGameInstances} game instances can continue in the background without removing bots.`
      );
    }

    if (enabled && runConfig.sessionLabel === 'Stress Test') {
      warnings.push('Background mode is recommended for stress tests so visible windows do not compete with bots.');
    }

    if (
      enabled &&
      runConfig.runUntilStopped &&
      (runConfig.maxRuntimeMinutes === undefined || runConfig.maxRuntimeMinutes >= 240)
    ) {
      warnings.push('Background mode is recommended for long or overnight tests.');
    }

    return {
      enabled,
      totalBotCount,
      totalRunningGameInstances,
      requestedVisibleGameInstances,
      recommendedVisibleGameInstances,
      backgroundGameInstances,
      recommendedVisibleWindowLimit,
      estimatedCpuPercent: round(cost.total.cpuPercent),
      estimatedRamMb: Math.round(cost.total.ramMb),
      estimatedGpuPercent: cost.total.gpuPercent > 0 ? round(cost.total.gpuPercent) : undefined,
      breakdown: {
        headedBrowserWindow: cost.headedBrowserWindow,
        additionalVisibleWindows: cost.additionalVisibleWindows,
        actionOverlays: cost.actionOverlays,
        focusTracking: cost.focusTracking
      }
    };
  }

  private observationCost(
    gameProfile: GameProfile,
    observation: RuntimeObservationConfig,
    visibleCount: number
  ): {
    total: Required<ResourceCost>;
    headedBrowserWindow: Required<ResourceCost>;
    additionalVisibleWindows: Required<ResourceCost>;
    actionOverlays: Required<ResourceCost>;
    focusTracking: Required<ResourceCost>;
  } {
    const isBrowser = gameProfile.adapter.type === 'browser' || gameProfile.engine.type === 'browser';
    const headedBrowserWindow = scaleCost(headedBrowserWindowCost, isBrowser && visibleCount > 0 ? 1 : 0);
    const additionalVisibleWindows = scaleCost(
      isBrowser ? additionalBrowserWindowCost : additionalObservedWindowCost,
      Math.max(0, visibleCount - 1)
    );
    const actionOverlays = scaleCost(
      actionOverlayCost,
      isBrowser && observation.showActionInformation ? visibleCount : 0
    );
    const tracksFocus =
      visibleCount > 0 &&
      (observation.bringGameToFrontOnAction ||
        observation.observationMode === 'follow-first-bot' ||
        observation.observationMode === 'follow-selected-bot');
    const focusTracking = scaleCost(focusTrackingCost, tracksFocus ? 1 : 0);

    return {
      total: addCosts(
        headedBrowserWindow,
        additionalVisibleWindows,
        actionOverlays,
        focusTracking
      ),
      headedBrowserWindow,
      additionalVisibleWindows,
      actionOverlays,
      focusTracking
    };
  }

  private recommendedVisibleWindowLimit(system: SystemResourceSnapshot): number {
    if (system.totalRamMb <= 16_384 || system.cpuCoreCount <= 8) {
      return 1;
    }

    if (system.totalRamMb <= 32_768 || system.cpuCoreCount <= 12) {
      return 2;
    }

    return 3;
  }

  private collectGpuInfo(): GpuInfo | undefined {
    const name = process.env.GAMEPLAY_SIMULATOR_GPU_NAME;
    const loadPercent = process.env.GAMEPLAY_SIMULATOR_GPU_LOAD_PERCENT
      ? Number(process.env.GAMEPLAY_SIMULATOR_GPU_LOAD_PERCENT)
      : undefined;
    const memoryTotalMb = process.env.GAMEPLAY_SIMULATOR_GPU_MEMORY_TOTAL_MB
      ? Number(process.env.GAMEPLAY_SIMULATOR_GPU_MEMORY_TOTAL_MB)
      : undefined;
    const memoryFreeMb = process.env.GAMEPLAY_SIMULATOR_GPU_MEMORY_FREE_MB
      ? Number(process.env.GAMEPLAY_SIMULATOR_GPU_MEMORY_FREE_MB)
      : undefined;

    if (!name && loadPercent === undefined && memoryTotalMb === undefined && memoryFreeMb === undefined) {
      return undefined;
    }

    return { name, loadPercent, memoryTotalMb, memoryFreeMb };
  }

  private calculateResourceCapacity(system: SystemResourceSnapshot, runConfig: SimulationRunConfig) {
    const currentCpu = system.currentCpuLoadPercent ?? 0;
    const cpuPercent = Math.max(0, runConfig.resourceLimits.maxCpuPercent - currentCpu);
    const currentRamMb = Math.max(0, system.totalRamMb - system.freeRamMb);
    const maxAllowedRamMb = system.totalRamMb * (runConfig.resourceLimits.maxRamPercent / 100);
    const ramMb = Math.max(0, maxAllowedRamMb - currentRamMb - runConfig.resourceLimits.reserveRamMb);
    const gpuPercent =
      runConfig.resourceLimits.maxGpuPercent === undefined
        ? undefined
        : Math.max(0, runConfig.resourceLimits.maxGpuPercent - (system.gpu?.loadPercent ?? 0));

    return { cpuPercent, ramMb, gpuPercent };
  }

  private fitAllocationsToUserCapacity(
    allocations: MutableAllocation[],
    userCapacity: number,
    warnings: string[],
    blockers: string[]
  ): void {
    while (sumRecommended(allocations) > userCapacity) {
      const autoCandidate = [...allocations]
        .filter((allocation) => allocation.pool.scalingMode === 'auto' && allocation.recommendedCount > 0)
        .sort((a, b) => a.pool.priority - b.pool.priority)[0];

      if (autoCandidate) {
        autoCandidate.recommendedCount -= 1;
        autoCandidate.reason = `Reduced by auto scaling to fit user-defined bot and game-instance limits.`;
        continue;
      }

      const fixedCandidate = [...allocations]
        .filter((allocation) => allocation.recommendedCount > 0)
        .sort((a, b) => a.pool.priority - b.pool.priority)[0];

      if (!fixedCandidate) {
        return;
      }

      fixedCandidate.recommendedCount -= 1;
      fixedCandidate.reason = `Fixed request could not fit the configured hard limits.`;
      blockers.push(`${fixedCandidate.profileId} was reduced because hard user limits make the request impossible.`);
    }

    if (sumRecommended(allocations) < allocations.reduce((total, allocation) => total + allocation.requestedCount, 0)) {
      warnings.push('Some requested bots were reduced to fit user-defined limits.');
    }
  }

  private fitAllocationsToResourceCapacity(
    allocations: MutableAllocation[],
    instanceCost: ResourceCost,
    costByProfile: Map<string, ResourceCost>,
    capacity: ResourceCost,
    runConfig: SimulationRunConfig,
    gameProfile: GameProfile,
    warnings: string[],
    blockers: string[]
  ): void {
    while (
      !this.fitsCapacity(
        allocations,
        instanceCost,
        costByProfile,
        capacity,
        runConfig,
        gameProfile.adapter.supportsMultipleInstances
      )
    ) {
      const autoCandidate = [...allocations]
        .filter((allocation) => allocation.pool.scalingMode === 'auto' && allocation.recommendedCount > 0)
        .sort((a, b) => a.pool.priority - b.pool.priority)[0];

      if (autoCandidate) {
        autoCandidate.recommendedCount -= 1;
        autoCandidate.reason = `Reduced by auto scaling because the estimated CPU/RAM cost is too high.`;
        warnings.push(`${autoCandidate.profileId} was reduced by the resource estimator.`);
        continue;
      }

      const fixedCandidate = [...allocations]
        .filter((allocation) => allocation.recommendedCount > 0)
        .sort((a, b) => a.pool.priority - b.pool.priority)[0];

      if (!fixedCandidate) {
        blockers.push('No enabled bot pool can fit within the current resource limits.');
        return;
      }

      fixedCandidate.recommendedCount -= 1;
      fixedCandidate.reason = `Fixed request could not fit the current CPU/RAM budget.`;
      blockers.push(`${fixedCandidate.profileId} was reduced because the fixed request is impossible on this budget.`);
    }
  }

  private growAutoAllocations(
    allocations: MutableAllocation[],
    instanceCost: ResourceCost,
    costByProfile: Map<string, ResourceCost>,
    capacity: ResourceCost,
    userCapacity: number,
    runConfig: SimulationRunConfig,
    gameProfile: GameProfile
  ): void {
    let grew = true;

    while (grew) {
      grew = false;
      const candidates = [...allocations]
        .filter(
          (allocation) =>
            allocation.pool.scalingMode === 'auto' &&
            allocation.recommendedCount < allocation.requestedCount &&
            allocation.recommendedCount < allocation.pool.maxCount
        )
        .sort((a, b) => b.pool.priority - a.pool.priority);

      for (const candidate of candidates) {
        if (sumRecommended(allocations) >= userCapacity) {
          return;
        }

        candidate.recommendedCount += 1;

        if (
          this.fitsCapacity(
            allocations,
            instanceCost,
            costByProfile,
            capacity,
            runConfig,
            gameProfile.adapter.supportsMultipleInstances
          )
        ) {
          candidate.reason =
            candidate.recommendedCount === candidate.requestedCount
              ? 'Requested count fits the current resource estimate.'
              : 'Partially scaled up within current resource limits.';
          grew = true;
        } else {
          candidate.recommendedCount -= 1;
        }
      }
    }
  }

  private fitsCapacity(
    allocations: MutableAllocation[],
    instanceCost: ResourceCost,
    costByProfile: Map<string, ResourceCost>,
    capacity: ResourceCost,
    runConfig: SimulationRunConfig,
    supportsMultipleInstances: boolean
  ): boolean {
    const gameInstances = this.estimateGameInstances(sumRecommended(allocations), runConfig, supportsMultipleInstances);
    const estimate = this.estimateTotalCost(allocations, gameInstances, instanceCost, costByProfile);

    if (estimate.cpuPercent > capacity.cpuPercent) {
      return false;
    }

    if (estimate.ramMb > capacity.ramMb) {
      return false;
    }

    return capacity.gpuPercent === undefined || (estimate.gpuPercent ?? 0) <= capacity.gpuPercent;
  }

  private estimateGameInstances(
    botCount: number,
    runConfig: SimulationRunConfig,
    supportsMultipleInstances: boolean
  ): number {
    if (botCount === 0) {
      return 0;
    }

    if (!supportsMultipleInstances || runConfig.runMode === 'sequential') {
      return 1;
    }

    if (runConfig.runMode === 'hybrid') {
      const hybridBatchSize = Math.max(1, runConfig.perGameInstanceBotLimit * 2);
      return clamp(Math.ceil(botCount / hybridBatchSize), 1, runConfig.resourceLimits.maxGameInstances);
    }

    return clamp(
      Math.ceil(botCount / Math.max(1, runConfig.perGameInstanceBotLimit)),
      1,
      runConfig.resourceLimits.maxGameInstances
    );
  }

  private estimateTotalCost(
    allocations: MutableAllocation[],
    gameInstances: number,
    instanceCost: ResourceCost,
    costByProfile: Map<string, ResourceCost>
  ): Required<ResourceCost> {
    return allocations.reduce(
      (total, allocation) => {
        const botCost = costByProfile.get(allocation.profileId) ?? botWeightCost.medium;
        total.cpuPercent += botCost.cpuPercent * allocation.recommendedCount;
        total.ramMb += botCost.ramMb * allocation.recommendedCount;
        total.gpuPercent += (botCost.gpuPercent ?? 0) * allocation.recommendedCount;
        return total;
      },
      {
        cpuPercent: instanceCost.cpuPercent * gameInstances,
        ramMb: instanceCost.ramMb * gameInstances,
        gpuPercent: (instanceCost.gpuPercent ?? 0) * gameInstances
      }
    );
  }
}

export const resourceManager = new ResourceManager();
