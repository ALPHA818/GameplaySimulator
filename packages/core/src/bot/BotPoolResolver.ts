import type {
  BotLaunchPlan,
  BotPoolConfig,
  BotProfile,
  RuntimeViabilityReport,
  SimulationRunConfig
} from '../types';

export interface BotPoolResolverInput {
  runConfig: SimulationRunConfig;
  botProfiles: BotProfile[];
  viabilityReport: RuntimeViabilityReport;
}

interface PoolTarget {
  pool: BotPoolConfig;
  profile: BotProfile;
  targetCount: number;
  allocatedCount: number;
  order: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function padBotIndex(value: number): string {
  return value.toString().padStart(3, '0');
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function seedFrom(...parts: Array<string | number>): number {
  const input = parts.join(':');
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function playstyleFor(profile: BotProfile): string {
  const configured = profile.config.playstyle;
  return typeof configured === 'string' && configured.trim().length > 0
    ? configured.trim()
    : profile.botType;
}

function targetForPool(pool: BotPoolConfig, viabilityReport: RuntimeViabilityReport): number {
  if (pool.scalingMode === 'fixed') {
    return pool.desiredCount;
  }

  const allocation = viabilityReport.botAllocation.find((item) => item.profileId === pool.profileId);
  return allocation?.recommendedCount ?? 0;
}

function assignGameInstanceId(
  launchIndex: number,
  runConfig: SimulationRunConfig,
  viabilityReport: RuntimeViabilityReport
): string | undefined {
  if (viabilityReport.recommendedGameInstances <= 0) {
    return undefined;
  }

  if (runConfig.runMode === 'sequential') {
    return 'game-instance-001';
  }

  const instanceCount = Math.max(1, viabilityReport.recommendedGameInstances);
  const perInstanceLimit = Math.max(1, runConfig.perGameInstanceBotLimit);
  const zeroBasedInstance = Math.floor((launchIndex - 1) / perInstanceLimit) % instanceCount;

  return `game-instance-${padBotIndex(zeroBasedInstance + 1)}`;
}

function buildTargets(input: BotPoolResolverInput): PoolTarget[] {
  const profilesById = new Map(input.botProfiles.map((profile) => [profile.profileId, profile]));

  return input.runConfig.botPools
    .map((pool, order) => {
      const profile = profilesById.get(pool.profileId);

      if (!pool.enabled || !profile) {
        return null;
      }

      return {
        pool,
        profile,
        targetCount: clamp(targetForPool(pool, input.viabilityReport), 0, pool.maxCount),
        allocatedCount: 0,
        order
      };
    })
    .filter((target): target is PoolTarget => target !== null)
    .sort((a, b) => b.pool.priority - a.pool.priority || a.order - b.order);
}

function allocateTargets(targets: PoolTarget[], globalBotLimit: number): void {
  let remaining = Math.max(0, globalBotLimit);

  for (const target of targets) {
    if (remaining <= 0) {
      return;
    }

    const minimumCount = Math.min(target.pool.minCount, target.targetCount, remaining);
    target.allocatedCount += minimumCount;
    remaining -= minimumCount;
  }

  for (const target of targets) {
    if (remaining <= 0) {
      return;
    }

    const extraCount = Math.min(target.targetCount - target.allocatedCount, remaining);
    target.allocatedCount += extraCount;
    remaining -= extraCount;
  }
}

export function resolveBotPools(input: BotPoolResolverInput): BotLaunchPlan[] {
  const targets = buildTargets(input);
  allocateTargets(targets, input.runConfig.globalBotLimit);

  const profileCounters = new Map<string, number>();
  const launchPlans: BotLaunchPlan[] = [];

  for (const target of targets) {
    const profileSlug = slugify(target.pool.profileId) || 'bot';

    for (let localIndex = 0; localIndex < target.allocatedCount; localIndex += 1) {
      const nextProfileIndex = (profileCounters.get(profileSlug) ?? 0) + 1;
      const launchIndex = launchPlans.length + 1;
      const botId = `${profileSlug}-${padBotIndex(nextProfileIndex)}`;

      profileCounters.set(profileSlug, nextProfileIndex);
      launchPlans.push({
        botId,
        profileId: target.pool.profileId,
        displayName: `${target.profile.displayName} ${padBotIndex(nextProfileIndex)}`,
        playstyle: playstyleFor(target.profile),
        assignedGameInstanceId: assignGameInstanceId(launchIndex, input.runConfig, input.viabilityReport),
        seed: seedFrom(input.runConfig.sessionId, botId, launchIndex),
        resourceWeight: target.pool.resourceWeight,
        launchIndex
      });
    }
  }

  return launchPlans;
}

export class BotPoolResolver {
  resolve(input: BotPoolResolverInput): BotLaunchPlan[] {
    return resolveBotPools(input);
  }
}
