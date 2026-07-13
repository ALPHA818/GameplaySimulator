import type {
  ActionResult,
  DetectedIssue,
  GameAction,
  GameInstanceStatus,
  GameStateSnapshot,
  IssueCategory,
  Severity
} from '../types';
import type { ProgressSummary } from '../bot/ProgressTracker';

export interface IssueDetectionMemory {
  previousState?: GameStateSnapshot | null;
  lastState: GameStateSnapshot | null;
  lastAction: GameAction | null;
  lastResult: ActionResult | null;
  recentActionTypes: string[];
  currentArea?: string;
  progressState?: string;
  stuckReason?: string;
  progressSummary?: ProgressSummary;
}

export interface IssueDetectionContext {
  sessionId: string;
  botId?: string;
  instanceId?: string;
  timestamp: string;
  memory: IssueDetectionMemory;
  instanceStatus?: GameInstanceStatus;
  recentIssues?: DetectedIssue[];
}

interface IssueDraft {
  key: string;
  severity: Severity;
  category: IssueCategory;
  title: string;
  description: string;
  expectedBehavior: string;
  actualBehavior: string;
  confidence: number;
  scene?: string;
  area?: string;
  stateSummary?: string;
  screenshotPath?: string;
  videoPath?: string;
  rawEvidence?: unknown;
}

export interface IssueDetector {
  readonly id: string;
  detect(context: IssueDetectionContext): DetectedIssue[];
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = normalize(value);
    if (['true', 'yes', 'alive', 'running', 'responsive', 'enabled', 'ok'].includes(normalized)) {
      return true;
    }
    if (['false', 'no', 'dead', 'crashed', 'stopped', 'unresponsive', 'disabled', 'failed'].includes(normalized)) {
      return false;
    }
  }

  return undefined;
}

function numericValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function pick(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined) {
      return source[key];
    }
  }

  return undefined;
}

function readPath(source: unknown, path: string[]): unknown {
  let current = source;

  for (const part of path) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[part];
  }

  return current;
}

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function normalizedText(value: unknown): string {
  return normalize(compactJson(value));
}

function recordEntries(value: unknown): Array<[string, unknown]> {
  if (isRecord(value)) {
    return Object.entries(value);
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => {
      if (isRecord(item)) {
        const id =
          textValue(pick(item, ['id', 'itemId', 'name', 'key', 'rewardId', 'questId', 'flagId'])) ??
          `item-${index + 1}`;
        return [id, item];
      }

      return [String(index), item];
    });
  }

  return [];
}

function quantityFrom(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (isRecord(value)) {
    return (
      numericValue(pick(value, ['quantity', 'count', 'amount', 'qty', 'stack', 'value'])) ??
      (booleanValue(pick(value, ['owned', 'unlocked', 'received'])) === true ? 1 : undefined)
    );
  }

  return undefined;
}

function quantityMap(value: unknown): Map<string, number> {
  const quantities = new Map<string, number>();

  for (const [key, item] of recordEntries(value)) {
    const quantity = quantityFrom(item);

    if (quantity !== undefined) {
      quantities.set(normalize(key), quantity);
    }
  }

  return quantities;
}

function stringSet(value: unknown): Set<string> {
  if (Array.isArray(value)) {
    return new Set(value.map((item) => normalize(String(item))).filter(Boolean));
  }

  if (isRecord(value)) {
    return new Set(
      Object.entries(value)
        .filter(([, item]) => item === true || item === 'true' || item === 'complete' || item === 'completed' || item === 'received')
        .map(([key]) => normalize(key))
    );
  }

  if (typeof value === 'string') {
    return new Set([normalize(value)]);
  }

  return new Set();
}

function firstNumber(source: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = numericValue(source[key]);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function stateObject(snapshot?: GameStateSnapshot | null): Record<string, unknown> {
  return snapshot?.state ?? {};
}

function sceneFrom(context: IssueDetectionContext): string | undefined {
  const state = context.memory.lastState;
  return state?.scene ?? textValue(pick(state?.state ?? {}, ['scene', 'area', 'currentArea', 'location', 'screen']));
}

function stateSummary(context: IssueDetectionContext): string {
  const state = context.memory.lastState;

  if (!state) {
    return 'No state snapshot was available.';
  }

  const summary = {
    scene: sceneFrom(context),
    tick: state.tick,
    screenshotPath: state.screenshotPath,
    state: state.state,
    metrics: state.metrics
  };

  return compactJson(summary).slice(0, 2000);
}

function lastActions(context: IssueDetectionContext): string[] {
  const actions = [...context.memory.recentActionTypes];
  const lastAction = context.memory.lastAction?.type;

  if (lastAction && actions[0] !== lastAction) {
    actions.unshift(lastAction);
  }

  return actions.slice(0, 10);
}

function issueIdFrom(context: IssueDetectionContext, detectorId: string, key: string): string {
  const botPart = context.botId ?? 'instance';
  return `${context.sessionId}-${botPart}-${detectorId}-${normalize(key)}`;
}

function issueFromDraft(context: IssueDetectionContext, detectorId: string, draft: IssueDraft): DetectedIssue {
  const issueId = issueIdFrom(context, detectorId, draft.key);
  const screenshotPath = draft.screenshotPath ?? context.memory.lastState?.screenshotPath;

  return {
    id: issueId,
    issueId,
    timestamp: context.timestamp,
    sessionId: context.sessionId,
    instanceId: context.instanceId,
    gameInstanceId: context.instanceId,
    botId: context.botId,
    severity: draft.severity,
    category: draft.category,
    title: draft.title,
    description: draft.description,
    scene: draft.scene ?? sceneFrom(context),
    area: draft.area ?? context.memory.currentArea ?? sceneFrom(context),
    lastActions: lastActions(context),
    stateSummary: draft.stateSummary ?? stateSummary(context),
    expectedBehavior: draft.expectedBehavior,
    actualBehavior: draft.actualBehavior,
    confidence: draft.confidence,
    screenshotPath,
    videoPath: draft.videoPath,
    rawEvidence: draft.rawEvidence,
    evidencePaths: screenshotPath ? [screenshotPath] : [],
    actionTimelineIds: context.memory.lastAction ? [context.memory.lastAction.actionId] : [],
    firstSeenAt: context.timestamp,
    reproducible: false
  };
}

function hasText(value: unknown, keywords: string[]): boolean {
  const text = normalize(compactJson(value));
  return keywords.some((keyword) => text.includes(normalize(keyword)));
}

function actionMatches(context: IssueDetectionContext, keywords: string[]): boolean {
  const action = context.memory.lastAction;
  if (!action) {
    return false;
  }

  return hasText([action.type, action.target, action.payload], keywords);
}

abstract class BaseDetector implements IssueDetector {
  abstract readonly id: string;

  detect(context: IssueDetectionContext): DetectedIssue[] {
    return this.detectDrafts(context).map((draft) => issueFromDraft(context, this.id, draft));
  }

  protected abstract detectDrafts(context: IssueDetectionContext): IssueDraft[];
}

export class CrashDetector extends BaseDetector {
  readonly id = 'crash';

  protected detectDrafts(context: IssueDetectionContext): IssueDraft[] {
    const state = context.memory.lastState?.state ?? {};
    const processAlive = booleanValue(pick(state, ['processAlive', 'isProcessAlive']));
    const crashed =
      context.instanceStatus?.status === 'crashed' ||
      context.instanceStatus?.status === 'failed' ||
      processAlive === false ||
      hasText(pick(state, ['processStatus', 'windowStatus', 'error', 'fatalError']), ['crash', 'fatal']);

    return crashed
      ? [
          {
            key: 'process-crashed',
            severity: 'critical',
            category: 'crash',
            title: 'Game process crashed',
            description: 'The game process or adapter state indicates a crash.',
            expectedBehavior: 'The game should remain running during test execution.',
            actualBehavior: 'The process is no longer alive or reported a crash.',
            confidence: 0.95,
            rawEvidence: { instanceStatus: context.instanceStatus, state }
          }
        ]
      : [];
  }
}

export class FreezeDetector extends BaseDetector {
  readonly id = 'freeze';

  protected detectDrafts(context: IssueDetectionContext): IssueDraft[] {
    const state = context.memory.lastState?.state ?? {};
    const responsive = booleanValue(pick(state, ['processResponsive', 'windowResponsive', 'responsive', 'acceptingInput']));
    const reason = context.memory.stuckReason ?? context.memory.progressSummary?.stuckReason ?? '';
    const unresponsive = context.instanceStatus?.status === 'unresponsive' || responsive === false;
    const loading = hasText(reason, ['loading screen']) || booleanValue(pick(state, ['loading', 'isLoading'])) === true;

    if (unresponsive) {
      return [
        {
          key: 'window-unresponsive',
          severity: 'critical',
          category: 'hang',
          title: 'Game window is unresponsive',
          description: 'The game is still present but is not responding to input or health checks.',
          expectedBehavior: 'The game window should continue responding to input and health checks.',
          actualBehavior: 'The process/window is reported as unresponsive.',
          confidence: 0.9,
          rawEvidence: { instanceStatus: context.instanceStatus, state }
        }
      ];
    }

    if (loading) {
      return [
        {
          key: 'loading-screen-timeout',
          severity: 'error',
          category: 'hang',
          title: 'Loading screen lasted too long',
          description: 'The progress tracker indicates the bot is stuck on a loading screen.',
          expectedBehavior: 'Loading should complete within the configured threshold.',
          actualBehavior: reason || 'The game remains in a loading state.',
          confidence: 0.82,
          rawEvidence: { reason, state }
        }
      ];
    }

    return [];
  }
}

export class StuckDetector extends BaseDetector {
  readonly id = 'stuck';

  protected detectDrafts(context: IssueDetectionContext): IssueDraft[] {
    const reason = context.memory.stuckReason ?? context.memory.progressSummary?.stuckReason;
    if (!reason) {
      return [];
    }

    return [
      {
        key: reason,
        severity: 'error',
        category: 'navigation',
        title: 'Bot cannot make progress',
        description: reason,
        expectedBehavior: 'The bot should be able to continue progressing or recover automatically.',
        actualBehavior: `The bot is stuck: ${reason}`,
        confidence: 0.8,
        rawEvidence: context.memory.progressSummary
      }
    ];
  }
}

export class EngineErrorDetector extends BaseDetector {
  readonly id = 'engine-error';

  protected detectDrafts(context: IssueDetectionContext): IssueDraft[] {
    const state = context.memory.lastState?.state ?? {};
    const evidence = pick(state, ['engineError', 'engineErrors', 'exception', 'error', 'warning', 'logError']);

    return evidence && hasText(evidence, ['error', 'exception', 'assert', 'stack', 'nullreference', 'fatal'])
      ? [
          {
            key: compactJson(evidence).slice(0, 80),
            severity: 'error',
            category: 'gameplay',
            title: 'Engine error detected',
            description: 'Structured game state reported an engine/runtime error.',
            expectedBehavior: 'The game should not emit engine errors during normal play.',
            actualBehavior: compactJson(evidence).slice(0, 1000),
            confidence: 0.86,
            rawEvidence: evidence
          }
        ]
      : [];
  }
}

export class UIDetector extends BaseDetector {
  readonly id = 'ui';

  protected detectDrafts(context: IssueDetectionContext): IssueDraft[] {
    const state = context.memory.lastState?.state ?? {};
    const reason = context.memory.stuckReason ?? '';
    const closeFailed =
      actionMatches(context, ['close-menu', 'cancel', 'back', 'escape']) &&
      (context.memory.lastResult?.status === 'failed' || context.memory.lastResult?.status === 'timed_out');
    const trapped = hasText(reason, ['menu', 'dialogue']) || booleanValue(pick(state, ['menuCannotClose', 'uiBlocked'])) === true;

    return closeFailed || trapped
      ? [
          {
            key: 'menu-cannot-close',
            severity: 'error',
            category: 'ui',
            title: 'Menu or UI flow cannot close',
            description: 'The bot appears trapped in a UI/menu/dialogue flow.',
            expectedBehavior: 'Menus, settings, and dialogue should allow a valid exit path.',
            actualBehavior: closeFailed ? 'Close/cancel action failed.' : reason,
            confidence: closeFailed ? 0.78 : 0.72,
            rawEvidence: { state, reason, result: context.memory.lastResult }
          }
        ]
      : [];
  }
}

export class QuestDetector extends BaseDetector {
  readonly id = 'quest';

  protected detectDrafts(context: IssueDetectionContext): IssueDraft[] {
    const state = context.memory.lastState?.state ?? {};
    const questError = pick(state, ['questError', 'questBlocked', 'objectiveStalled', 'requiredNpcMissing']);

    return questError || hasText(state, ['required npc missing', 'objective does not update'])
      ? [
          {
            key: 'quest-progression-blocked',
            severity: 'error',
            category: 'quest',
            title: 'Quest progression appears blocked',
            description: 'Quest/objective state indicates blocked or missing required content.',
            expectedBehavior: 'Quest objectives and required NPCs should update and remain available.',
            actualBehavior: compactJson(questError ?? state).slice(0, 1000),
            confidence: 0.82,
            rawEvidence: questError ?? state
          }
        ]
      : [];
  }
}

export class InventoryDetector extends BaseDetector {
  readonly id = 'inventory';

  protected detectDrafts(context: IssueDetectionContext): IssueDraft[] {
    const state = context.memory.lastState?.state ?? {};
    const inventory = pick(state, ['inventory', 'items', 'equipment']);
    const duplicate = booleanValue(pick(state, ['itemDuplicated', 'inventoryDuplicated'])) === true || hasText(inventory, ['duplicated']);
    const negativeItemCount = hasText(inventory, ['count:-', '"count":-', 'quantity:-', '"quantity":-']);

    return duplicate || negativeItemCount
      ? [
          {
            key: duplicate ? 'item-duplicated' : 'negative-item-count',
            severity: duplicate ? 'warning' : 'error',
            category: duplicate ? 'exploit' : 'inventory',
            title: duplicate ? 'Item duplicated unexpectedly' : 'Inventory item count is invalid',
            description: 'Inventory state contains duplication or negative quantity evidence.',
            expectedBehavior: 'Inventory counts should remain consistent after item operations.',
            actualBehavior: compactJson(inventory ?? state).slice(0, 1000),
            confidence: 0.74,
            rawEvidence: inventory ?? state
          }
        ]
      : [];
  }
}

export class EconomyExploitDetector extends BaseDetector {
  readonly id = 'economy';

  protected detectDrafts(context: IssueDetectionContext): IssueDraft[] {
    const state = context.memory.lastState?.state ?? {};
    const currency = numericValue(pick(state, ['currency', 'gold', 'coins', 'money']));
    const walletCurrency = numericValue(readPath(state, ['wallet', 'currency']));
    const price = numericValue(pick(state, ['price', 'itemPrice', 'shopPrice']));
    const exploit = booleanValue(pick(state, ['economyExploit', 'rewardDuplicated'])) === true;
    const negativePrice = price !== undefined && price < 0;

    return negativePrice || exploit
      ? [
          {
            key: negativePrice ? 'negative-price' : 'reward-duplicated',
            severity: 'error',
            category: 'economy',
            title: negativePrice ? 'Shop price is negative' : 'Economy anomaly detected',
            description: 'Economy state indicates invalid pricing or duplicated reward evidence.',
            expectedBehavior: 'Currency, prices, and rewards should remain within valid ranges.',
            actualBehavior: compactJson({ currency, walletCurrency, price, exploit }).slice(0, 1000),
            confidence: 0.84,
            rawEvidence: state
          }
        ]
      : [];
  }
}

export class ExploitDetector extends BaseDetector {
  readonly id = 'exploit';

  protected detectDrafts(context: IssueDetectionContext): IssueDraft[] {
    const current = stateObject(context.memory.lastState);
    const previous = stateObject(context.memory.previousState);
    const drafts: IssueDraft[] = [];
    const actionText = normalizedText([
      context.memory.lastAction?.type,
      context.memory.lastAction?.target,
      context.memory.lastAction?.payload,
      context.memory.recentActionTypes
    ]);

    const inventory = pick(current, ['inventory', 'items', 'equipment']);
    const previousInventory = pick(previous, ['inventory', 'items', 'equipment']);
    const currentItems = quantityMap(inventory);
    const previousItems = quantityMap(previousInventory);

    for (const [itemId, quantity] of currentItems) {
      if (quantity < 0) {
        drafts.push(this.possibleExploit(context, {
          key: `negative-item-quantity-${itemId}`,
          title: 'Possible exploit: negative item quantity',
          description: `Item "${itemId}" has a negative quantity.`,
          expectedBehavior: 'Item quantities should stay at or above zero.',
          actualBehavior: `Observed ${quantity} for item "${itemId}".`,
          confidence: 0.88,
          rawEvidence: { exploitType: 'negative_item_quantity', itemId, previous: previousItems.get(itemId), current: quantity, inventory }
        }));
      }

      const previousQuantity = previousItems.get(itemId);
      const itemIncreased = previousQuantity !== undefined && quantity > previousQuantity;
      const likelyItemGainAction = /buy|claim|reward|loot|craft|collect|pickup|quest|dialogue|shop/.test(actionText);
      const likelyNoGainAction = /load|save|sell|drop|equip|unequip|menu|settings|dialogue-skip/.test(actionText);

      if (itemIncreased && !likelyItemGainAction && likelyNoGainAction) {
        drafts.push(this.possibleExploit(context, {
          key: `item-duplication-${itemId}`,
          title: 'Possible exploit: item duplication',
          description: `Item "${itemId}" increased after an action that does not normally grant items.`,
          expectedBehavior: 'Item counts should only increase after valid reward, loot, shop, craft, or pickup events.',
          actualBehavior: `Item "${itemId}" changed from ${previousQuantity} to ${quantity}.`,
          confidence: 0.7,
          rawEvidence: { exploitType: 'item_duplication', itemId, previous: previousQuantity, current: quantity, action: context.memory.lastAction }
        }));
      }
    }

    const currentCurrency = firstNumber(current, ['currency', 'gold', 'coins', 'money']) ?? numericValue(readPath(current, ['wallet', 'currency']));
    const previousCurrency =
      firstNumber(previous, ['currency', 'gold', 'coins', 'money']) ?? numericValue(readPath(previous, ['wallet', 'currency']));

    if (currentCurrency !== undefined && currentCurrency < 0) {
      drafts.push(this.possibleExploit(context, {
        key: 'negative-currency',
        title: 'Possible exploit: negative currency',
        description: 'Currency dropped below zero.',
        expectedBehavior: 'Currency should remain at or above zero.',
        actualBehavior: `Currency is ${currentCurrency}.`,
        confidence: 0.9,
        rawEvidence: { exploitType: 'negative_currency', previousCurrency, currentCurrency }
      }));
    }

    if (previousCurrency !== undefined && currentCurrency !== undefined && currentCurrency > previousCurrency) {
      const delta = currentCurrency - previousCurrency;
      const likelyCurrencyGain = /reward|sell|quest|loot|claim|win|complete|earn/.test(actionText);
      const likelyProfitLoop = /buy.*sell|sell.*buy|shop|craft|dialogue|claim|reward/.test(actionText);

      if (!likelyCurrencyGain && /load|save|buy|craft|menu|dialogue/.test(actionText)) {
        drafts.push(this.possibleExploit(context, {
          key: 'currency-duplication',
          title: 'Possible exploit: currency duplication',
          description: 'Currency increased after an action that does not normally grant currency.',
          expectedBehavior: 'Currency should only increase from valid rewards, sales, loot, or earnings.',
          actualBehavior: `Currency changed from ${previousCurrency} to ${currentCurrency}.`,
          confidence: 0.68,
          rawEvidence: { exploitType: 'currency_duplication', previousCurrency, currentCurrency, delta, action: context.memory.lastAction }
        }));
      }

      if (likelyProfitLoop && delta > 0) {
        drafts.push(this.possibleExploit(context, {
          key: /craft/.test(actionText) ? 'crafting-profit-loop' : 'buy-sell-profit-loop',
          title: /craft/.test(actionText) ? 'Possible exploit: crafting profit loop' : 'Possible exploit: buy/sell profit loop',
          description: 'Currency increased during repeated shop/crafting style actions.',
          expectedBehavior: 'Economy loops should not generate unlimited profit unless explicitly designed.',
          actualBehavior: `Currency increased by ${delta} during ${context.memory.lastAction?.type ?? 'an economy action'}.`,
          confidence: /buy.*sell|sell.*buy/.test(actionText) ? 0.76 : 0.62,
          rawEvidence: { exploitType: /craft/.test(actionText) ? 'crafting_profit_loop' : 'buy_sell_profit_loop', previousCurrency, currentCurrency, delta }
        }));
      }
    }

    const rewards = pick(current, ['rewards', 'claimedRewards', 'rewardClaims', 'questRewards']);
    const previousRewards = pick(previous, ['rewards', 'claimedRewards', 'rewardClaims', 'questRewards']);
    const currentRewards = quantityMap(rewards);
    const previousRewardSet = stringSet(previousRewards);
    for (const [rewardId, quantity] of currentRewards) {
      const wasPreviouslyClaimed = previousRewardSet.has(rewardId) || (quantityMap(previousRewards).get(rewardId) ?? 0) > 0;
      if (quantity > 1 || (wasPreviouslyClaimed && /claim|reward|quest|dialogue/.test(actionText))) {
        drafts.push(this.possibleExploit(context, {
          key: /dialogue/.test(actionText) ? `dialogue-reward-${rewardId}` : `repeated-reward-${rewardId}`,
          title: /dialogue/.test(actionText)
            ? 'Possible exploit: repeated dialogue reward'
            : 'Possible exploit: reward claimed multiple times',
          description: 'A reward appears to have been granted more than once.',
          expectedBehavior: 'One-time rewards should not be claimable repeatedly unless the design permits it.',
          actualBehavior: `Reward "${rewardId}" quantity/count is ${quantity}.`,
          confidence: /dialogue/.test(actionText) ? 0.7 : 0.78,
          rawEvidence: { exploitType: 'repeated_reward', rewardId, previousRewards, rewards, action: context.memory.lastAction }
        }));
      }
    }

    const xp = firstNumber(current, ['xp', 'experience']);
    const previousXp = firstNumber(previous, ['xp', 'experience']);
    if (xp !== undefined && previousXp !== undefined && xp > previousXp && /idle|dialogue|load|save|menu|repeat/.test(actionText)) {
      drafts.push(this.possibleExploit(context, {
        key: 'xp-loop',
        title: 'Possible exploit: XP loop',
        description: 'XP increased during repeated or non-combat/non-quest actions.',
        expectedBehavior: 'XP should only increase from valid combat, quest, discovery, or reward sources.',
        actualBehavior: `XP changed from ${previousXp} to ${xp}.`,
        confidence: 0.64,
        rawEvidence: { exploitType: 'xp_loop', previousXp, xp, action: context.memory.lastAction }
      }));
    }

    const stats = pick(current, ['stats', 'attributes']);
    if (isRecord(stats)) {
      for (const [statName, value] of Object.entries(stats)) {
        const currentValue = numericValue(value);
        const maxValue =
          numericValue(readPath(current, ['statMaximums', statName])) ??
          numericValue(readPath(current, ['maxStats', statName])) ??
          numericValue(readPath(current, ['statsMax', statName]));

        if (currentValue !== undefined && maxValue !== undefined && currentValue > maxValue) {
          drafts.push(this.possibleExploit(context, {
            key: `stat-over-max-${statName}`,
            title: 'Possible exploit: stat exceeds expected maximum',
            description: `Stat "${statName}" exceeded its reported maximum.`,
            expectedBehavior: 'Stats should stay within reported limits.',
            actualBehavior: `${statName} is ${currentValue}; max is ${maxValue}.`,
            confidence: 0.82,
            rawEvidence: { exploitType: 'stat_exceeds_maximum', statName, currentValue, maxValue, stats }
          }));
        }
      }
    }

    const currentFlags = stringSet(pick(current, ['questFlags', 'flags', 'progressionFlags']));
    const previousFlags = stringSet(pick(previous, ['questFlags', 'flags', 'progressionFlags']));
    const missingRequiredFlags = pick(current, ['missingRequiredFlags', 'missingQuestFlags', 'missingProgressionFlags']);
    const completedQuest = textValue(pick(current, ['completedQuest', 'questCompleted', 'completedQuestId']));
    if ((missingRequiredFlags && completedQuest) || booleanValue(pick(current, ['questCompletedWithoutRequiredFlags'])) === true) {
      drafts.push(this.possibleExploit(context, {
        key: `quest-completed-without-flags-${completedQuest ?? 'unknown'}`,
        title: 'Possible exploit: quest completed without required flags',
        description: 'Quest completion was reported while required flags were missing.',
        expectedBehavior: 'Quest completion should require all configured prerequisite flags.',
        actualBehavior: compactJson({ completedQuest, missingRequiredFlags }).slice(0, 1000),
        confidence: 0.84,
        rawEvidence: { exploitType: 'quest_without_required_flags', completedQuest, missingRequiredFlags, currentFlags: [...currentFlags] }
      }));
    }

    const scene = textValue(pick(current, ['scene', 'area', 'currentArea', 'location'])) ?? context.memory.lastState?.scene;
    const previousScene = textValue(pick(previous, ['scene', 'area', 'currentArea', 'location'])) ?? context.memory.previousState?.scene;
    const earlyAccess = booleanValue(pick(current, ['enteredLockedAreaEarly', 'sequenceBreak', 'accessedLockedContent'])) === true;
    const futureContent = booleanValue(pick(current, ['futureContent', 'enteredFutureContent'])) === true;
    if (earlyAccess || futureContent) {
      drafts.push(this.possibleExploit(context, {
        key: earlyAccess ? `locked-area-early-${scene ?? 'unknown'}` : `future-content-${scene ?? 'unknown'}`,
        title: earlyAccess
          ? 'Possible exploit: locked area entered too early'
          : 'Possible exploit: sequence break into future content',
        description: 'The state indicates content may have been reached before prerequisites were met.',
        expectedBehavior: 'Locked or future content should require the appropriate progression gates.',
        actualBehavior: compactJson({ previousScene, scene, earlyAccess, futureContent }).slice(0, 1000),
        confidence: earlyAccess ? 0.72 : 0.68,
        rawEvidence: { exploitType: earlyAccess ? 'locked_area_entered_early' : 'future_content_sequence_break', previousScene, scene, currentFlags: [...currentFlags], previousFlags: [...previousFlags] }
      }));
    }

    if (booleanValue(pick(current, ['bossSkippedRewardReceived'])) === true || hasText(current, ['boss skipped reward'])) {
      drafts.push(this.possibleExploit(context, {
        key: 'boss-skipped-reward-received',
        title: 'Possible exploit: boss skipped but reward received',
        description: 'Boss reward appears to have been granted without the boss completion flag.',
        expectedBehavior: 'Boss rewards should require defeating or otherwise legitimately resolving the boss.',
        actualBehavior: compactJson(current).slice(0, 1000),
        confidence: 0.78,
        rawEvidence: { exploitType: 'boss_skipped_reward_received', state: current }
      }));
    }

    if (booleanValue(pick(current, ['saveLoadInvalidState', 'invalidStateAfterLoad'])) === true) {
      drafts.push(this.possibleExploit(context, {
        key: 'save-load-invalid-state',
        title: 'Possible exploit: save/load abuse caused invalid state',
        description: 'The state after save/load appears invalid or inconsistent.',
        expectedBehavior: 'Save/load should restore a consistent state without duplicating resources or bypassing gates.',
        actualBehavior: compactJson(current).slice(0, 1000),
        confidence: 0.76,
        rawEvidence: { exploitType: 'save_load_invalid_state', previous, current, action: context.memory.lastAction }
      }));
    }

    if (booleanValue(pick(current, ['freeHealingLoop', 'freeItemFarm', 'healingFarmLoop'])) === true) {
      drafts.push(this.possibleExploit(context, {
        key: 'free-healing-item-farming-loop',
        title: 'Possible exploit: free healing/item farming loop',
        description: 'State indicates repeated free healing or item farming may be possible.',
        expectedBehavior: 'Repeatable healing or item grants should obey intended costs, cooldowns, or limits.',
        actualBehavior: compactJson(current).slice(0, 1000),
        confidence: 0.7,
        rawEvidence: { exploitType: 'free_healing_item_farming_loop', state: current }
      }));
    }

    return drafts;
  }

  private possibleExploit(
    _context: IssueDetectionContext,
    input: Omit<IssueDraft, 'severity' | 'category'> & { confidence: number }
  ): IssueDraft {
    return {
      ...input,
      severity: input.confidence >= 0.85 ? 'error' : 'warning',
      category: 'exploit',
      description: `${input.description} This is labeled as a possible exploit and needs human review.`,
      expectedBehavior: input.expectedBehavior,
      actualBehavior: input.actualBehavior,
      rawEvidence: input.rawEvidence
    };
  }
}

export class CombatDetector extends BaseDetector {
  readonly id = 'combat';

  protected detectDrafts(context: IssueDetectionContext): IssueDraft[] {
    const state = context.memory.lastState?.state ?? {};
    const playerDead = booleanValue(pick(state, ['playerDead', 'dead'])) === true || numericValue(pick(state, ['health', 'hp'])) === 0;
    const respawnFailed = booleanValue(pick(state, ['respawnFailed', 'canRespawn'])) === false;
    const combatError = pick(state, ['combatError', 'enemyStuck', 'damageInvalid']);

    return (playerDead && respawnFailed) || combatError
      ? [
          {
            key: playerDead ? 'death-does-not-respawn' : 'combat-system-error',
            severity: playerDead ? 'error' : 'warning',
            category: 'combat',
            title: playerDead ? 'Death does not respawn player' : 'Combat system anomaly detected',
            description: 'Combat/death state indicates a blocked or invalid combat flow.',
            expectedBehavior: 'Combat and death flows should resolve to a playable state.',
            actualBehavior: compactJson(combatError ?? state).slice(0, 1000),
            confidence: 0.78,
            rawEvidence: combatError ?? state
          }
        ]
      : [];
  }
}

export class PerformanceDetector extends BaseDetector {
  readonly id = 'performance';

  protected detectDrafts(context: IssueDetectionContext): IssueDraft[] {
    const metrics = context.memory.lastState?.metrics ?? {};
    const fps = numericValue(metrics.fps);
    const frameTime = numericValue(metrics.frameTimeMs) ?? numericValue(metrics.frameMs);
    const memoryMb = numericValue(metrics.memoryMb) ?? numericValue(metrics.ramMb);
    const cpu = context.instanceStatus?.resourceUsage?.cpuPercent;

    const badFps = fps !== undefined && fps < 15;
    const badFrame = frameTime !== undefined && frameTime > 100;
    const highMemory = memoryMb !== undefined && memoryMb > 8192;
    const highCpu = cpu !== undefined && cpu > 95;

    return badFps || badFrame || highMemory || highCpu
      ? [
          {
            key: badFps ? 'low-fps' : badFrame ? 'frame-time-spike' : highMemory ? 'memory-high' : 'cpu-high',
            severity: badFps || badFrame ? 'error' : 'warning',
            category: 'performance',
            title: 'Performance threshold exceeded',
            description: 'Runtime metrics indicate a likely performance issue.',
            expectedBehavior: 'The game should stay within configured performance thresholds.',
            actualBehavior: compactJson({ fps, frameTime, memoryMb, cpu }),
            confidence: 0.72,
            rawEvidence: { metrics, resourceUsage: context.instanceStatus?.resourceUsage }
          }
        ]
      : [];
  }
}

export class WorldBoundaryDetector extends BaseDetector {
  readonly id = 'world-boundary';

  protected detectDrafts(context: IssueDetectionContext): IssueDraft[] {
    const state = context.memory.lastState?.state ?? {};
    const y =
      numericValue(readPath(state, ['position', 'y'])) ??
      numericValue(readPath(state, ['playerPosition', 'y'])) ??
      numericValue(pick(state, ['y', 'posY']));
    const outOfWorld = booleanValue(pick(state, ['outOfWorld', 'fellOutOfWorld', 'outsideWorldBounds'])) === true;

    return outOfWorld || (y !== undefined && y < -100)
      ? [
          {
            key: 'player-out-of-world',
            severity: 'critical',
            category: 'world_boundary',
            title: 'Player fell out of the world',
            description: 'Player position is outside expected world bounds.',
            expectedBehavior: 'World collision and boundaries should keep the player in playable space.',
            actualBehavior: compactJson({ y, outOfWorld }).slice(0, 1000),
            confidence: outOfWorld ? 0.92 : 0.82,
            rawEvidence: state
          }
        ]
      : [];
  }
}

export class SaveLoadDetector extends BaseDetector {
  readonly id = 'save-load';

  protected detectDrafts(context: IssueDetectionContext): IssueDraft[] {
    const state = context.memory.lastState?.state ?? {};
    const saveError = pick(state, ['saveError', 'loadError', 'saveLoadError']);
    const loadFailed = actionMatches(context, ['load', 'save', 'checkpoint']) && context.memory.lastResult?.status === 'failed';

    return saveError || loadFailed
      ? [
          {
            key: 'save-load-failed',
            severity: 'critical',
            category: 'save_load',
            title: 'Save or load failed',
            description: 'Save/load state or action result indicates data could not be saved or loaded.',
            expectedBehavior: 'Save and load operations should complete and return to a valid playable state.',
            actualBehavior: loadFailed ? context.memory.lastResult?.message ?? 'Save/load action failed.' : compactJson(saveError),
            confidence: loadFailed ? 0.88 : 0.82,
            rawEvidence: { saveError, result: context.memory.lastResult }
          }
        ]
      : [];
  }
}

export class DialogueDetector extends BaseDetector {
  readonly id = 'dialogue';

  protected detectDrafts(context: IssueDetectionContext): IssueDraft[] {
    const state = context.memory.lastState?.state ?? {};
    const dialogueError = pick(state, ['dialogueError', 'dialogError', 'missingDialogue', 'invalidDialogueOption']);
    const stuckDialogue = hasText(context.memory.stuckReason, ['dialogue']) || booleanValue(pick(state, ['dialogueStuck'])) === true;

    return dialogueError || stuckDialogue
      ? [
          {
            key: 'dialogue-flow-broken',
            severity: 'error',
            category: 'dialogue',
            title: 'Dialogue flow is broken',
            description: 'Dialogue state indicates missing content, invalid choices, or a stuck dialogue loop.',
            expectedBehavior: 'Dialogue should offer valid choices and allow progression or exit.',
            actualBehavior: compactJson(dialogueError ?? context.memory.stuckReason ?? state).slice(0, 1000),
            confidence: 0.76,
            rawEvidence: dialogueError ?? state
          }
        ]
      : [];
  }
}

export class ContentAccessDetector extends BaseDetector {
  readonly id = 'content-access';

  protected detectDrafts(context: IssueDetectionContext): IssueDraft[] {
    const state = context.memory.lastState?.state ?? {};
    const earlyAccess =
      booleanValue(pick(state, ['enteredLockedAreaEarly', 'sequenceBreak', 'accessedLockedContent'])) === true ||
      actionMatches(context, ['enter-locked-area-early', 'sequence', 'skip']);
    const missingContent = booleanValue(pick(state, ['missingRequiredContent', 'requiredContentUnavailable'])) === true;

    return earlyAccess || missingContent
      ? [
          {
            key: earlyAccess ? 'locked-area-accessed-early' : 'required-content-missing',
            severity: earlyAccess ? 'warning' : 'error',
            category: earlyAccess ? 'exploit' : 'content',
            title: earlyAccess ? 'Locked content accessed early' : 'Required content is unavailable',
            description: 'Content access state indicates a possible sequence break or missing required content.',
            expectedBehavior: 'Content gates should enforce requirements, and required content should remain reachable.',
            actualBehavior: compactJson({ earlyAccess, missingContent }).slice(0, 1000),
            confidence: earlyAccess ? 0.66 : 0.82,
            rawEvidence: state
          }
        ]
      : [];
  }
}

export class SoftlockDetector extends BaseDetector {
  readonly id = 'softlock';

  protected detectDrafts(context: IssueDetectionContext): IssueDraft[] {
    const progress = context.memory.progressState ?? '';
    const reason = context.memory.stuckReason ?? context.memory.progressSummary?.stuckReason ?? '';
    const recoveryFailed = progress.startsWith('Recovery failed');
    const noActions = hasText(reason, ['no available actions']);
    const aliveCannotMove = hasText(reason, ['alive but movement']);

    return recoveryFailed || noActions || aliveCannotMove
      ? [
          {
            key: recoveryFailed ? 'recovery-failed' : noActions ? 'no-actions-softlock' : 'alive-cannot-move',
            severity: recoveryFailed ? 'critical' : 'error',
            category: 'softlock',
            title: 'Potential softlock detected',
            description: 'The bot cannot proceed and automatic recovery did not restore progress.',
            expectedBehavior: 'The game should always provide a recoverable path to continue or exit.',
            actualBehavior: progress || reason,
            confidence: recoveryFailed ? 0.9 : 0.75,
            rawEvidence: { progress, reason, progressSummary: context.memory.progressSummary }
          }
        ]
      : [];
  }
}

export const defaultIssueDetectors: IssueDetector[] = [
  new CrashDetector(),
  new FreezeDetector(),
  new StuckDetector(),
  new EngineErrorDetector(),
  new UIDetector(),
  new QuestDetector(),
  new InventoryDetector(),
  new ExploitDetector(),
  new EconomyExploitDetector(),
  new CombatDetector(),
  new PerformanceDetector(),
  new WorldBoundaryDetector(),
  new SaveLoadDetector(),
  new DialogueDetector(),
  new ContentAccessDetector(),
  new SoftlockDetector()
];

export class IssueDetectionRunner {
  private readonly seenKeys = new Set<string>();

  constructor(private readonly detectors: IssueDetector[] = defaultIssueDetectors) {}

  detect(context: IssueDetectionContext): DetectedIssue[] {
    const issues: DetectedIssue[] = [];

    for (const detector of this.detectors) {
      for (const issue of detector.detect(context)) {
        const dedupeKey = `${issue.botId ?? 'instance'}:${issue.category}:${issue.title}:${issue.scene ?? ''}`;
        if (this.seenKeys.has(dedupeKey)) {
          continue;
        }

        this.seenKeys.add(dedupeKey);
        issues.push(issue);
      }
    }

    return issues;
  }
}
