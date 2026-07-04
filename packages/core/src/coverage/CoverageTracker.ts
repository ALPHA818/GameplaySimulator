import type { BotProfile, DetectedIssue, GameAction, GameProfile, GameStateSnapshot } from '../types';

export const coverageCategories = [
  'scenes',
  'levels',
  'quests',
  'mainQuests',
  'sideQuests',
  'optionalStories',
  'npcs',
  'shops',
  'bosses',
  'items',
  'menus',
  'dialogueBranches',
  'minigames',
  'endings',
  'hiddenAreas',
  'postGameContent',
  'collectibles',
  'achievements'
] as const;

export type CoverageCategory = (typeof coverageCategories)[number];

export interface CoverageContentItem {
  category: CoverageCategory;
  contentId: string;
  label: string;
  known: boolean;
  tested: boolean;
  botIds: string[];
  botTypes: string[];
  issueIds: string[];
}

export interface CoverageCategorySummary {
  category: CoverageCategory;
  knownCount: number;
  testedKnownCount: number;
  observedCount: number;
  percentage: number;
}

export interface CoverageByBotType {
  botType: string;
  testedCount: number;
  content: Array<Pick<CoverageContentItem, 'category' | 'label' | 'contentId'>>;
}

export interface ContentCoverageSummary {
  percentage: number;
  totalKnown: number;
  testedKnown: number;
  totalObserved: number;
  testedContent: CoverageContentItem[];
  untestedContent: CoverageContentItem[];
  contentWithIssues: CoverageContentItem[];
  byCategory: CoverageCategorySummary[];
  byBotType: CoverageByBotType[];
}

interface CoverageEventContext {
  botId?: string;
  profileId?: string;
}

function normalizeId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function normalizeComparable(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValues(value: unknown): string[] {
  if (typeof value === 'string' && value.trim().length > 0) {
    return [value.trim()];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => stringValues(item));
  }

  if (isRecord(value)) {
    return Object.values(value).flatMap((item) => stringValues(item));
  }

  return [];
}

function valuesAt(state: Record<string, unknown>, keys: string[]): string[] {
  return keys.flatMap((key) => stringValues(state[key]));
}

function findKnownLabel(labels: string[], observed: string): string | undefined {
  const normalizedObserved = normalizeComparable(observed);

  return labels.find((label) => {
    const normalizedLabel = normalizeComparable(label);
    return normalizedLabel === normalizedObserved ||
      normalizedObserved.includes(normalizedLabel) ||
      normalizedLabel.includes(normalizedObserved);
  });
}

function knownContentFor(profile: GameProfile): Record<CoverageCategory, string[]> {
  return {
    scenes: [...(profile.knownContent.scenes ?? []), ...(profile.knownContent.locations ?? [])],
    levels: profile.knownContent.levels ?? [],
    quests: profile.knownContent.quests ?? [],
    mainQuests: profile.knownContent.mainQuests ?? [],
    sideQuests: profile.knownContent.sideQuests ?? [],
    optionalStories: profile.knownContent.optionalStories ?? [],
    npcs: [...(profile.knownContent.npcs ?? []), ...(profile.knownContent.characters ?? [])],
    shops: profile.knownContent.shops ?? [],
    bosses: profile.knownContent.bosses ?? [],
    items: profile.knownContent.items ?? [],
    menus: profile.knownContent.menus ?? [],
    dialogueBranches: profile.knownContent.dialogueBranches ?? [],
    minigames: profile.knownContent.minigames ?? [],
    endings: profile.knownContent.endings ?? [],
    hiddenAreas: profile.knownContent.hiddenAreas ?? [],
    postGameContent: profile.knownContent.postGameContent ?? [],
    collectibles: profile.knownContent.collectibles ?? [],
    achievements: profile.knownContent.achievements ?? []
  };
}

function stateObservations(snapshot: GameStateSnapshot): Array<{ category: CoverageCategory; label: string }> {
  const state = snapshot.state;
  const sceneLabels = [snapshot.scene, ...valuesAt(state, ['scene', 'currentScene', 'area', 'currentArea'])].filter(
    (label): label is string => typeof label === 'string' && label.length > 0
  );

  return [
    ...sceneLabels.map((label) => ({
      category: 'scenes' as CoverageCategory,
      label
    })),
    ...valuesAt(state, ['level', 'currentLevel', 'map', 'stage']).map((label) => ({ category: 'levels' as CoverageCategory, label })),
    ...valuesAt(state, ['quest', 'currentQuest']).map((label) => ({ category: 'quests' as CoverageCategory, label })),
    ...valuesAt(state, ['mainQuest', 'mainObjective']).map((label) => ({ category: 'mainQuests' as CoverageCategory, label })),
    ...valuesAt(state, ['sideQuest', 'acceptedSideQuest']).map((label) => ({ category: 'sideQuests' as CoverageCategory, label })),
    ...valuesAt(state, ['optionalStory', 'optionalStories']).map((label) => ({ category: 'optionalStories' as CoverageCategory, label })),
    ...valuesAt(state, ['npc', 'npcs', 'interactedNpc', 'interactedNPC']).map((label) => ({ category: 'npcs' as CoverageCategory, label })),
    ...valuesAt(state, ['shop', 'shops', 'usedShop', 'shopId']).map((label) => ({ category: 'shops' as CoverageCategory, label })),
    ...valuesAt(state, ['boss', 'bosses', 'currentBoss', 'foughtBoss']).map((label) => ({ category: 'bosses' as CoverageCategory, label })),
    ...valuesAt(state, ['item', 'items', 'inventoryItem', 'collectedItem']).map((label) => ({ category: 'items' as CoverageCategory, label })),
    ...valuesAt(state, ['menu', 'menus', 'currentMenu', 'openedMenu', 'uiState']).map((label) => ({ category: 'menus' as CoverageCategory, label })),
    ...valuesAt(state, ['dialogueBranch', 'dialogueBranches', 'dialogueChoice']).map((label) => ({
      category: 'dialogueBranches' as CoverageCategory,
      label
    })),
    ...valuesAt(state, ['minigame', 'minigames', 'currentMinigame']).map((label) => ({ category: 'minigames' as CoverageCategory, label })),
    ...valuesAt(state, ['ending', 'endings']).map((label) => ({ category: 'endings' as CoverageCategory, label })),
    ...valuesAt(state, ['hiddenArea', 'hiddenAreas', 'secretArea']).map((label) => ({ category: 'hiddenAreas' as CoverageCategory, label })),
    ...valuesAt(state, ['postGameContent', 'postGameArea', 'postGame']).map((label) => ({
      category: 'postGameContent' as CoverageCategory,
      label
    })),
    ...valuesAt(state, ['collectible', 'collectibles']).map((label) => ({ category: 'collectibles' as CoverageCategory, label })),
    ...valuesAt(state, ['achievement', 'achievements']).map((label) => ({ category: 'achievements' as CoverageCategory, label }))
  ];
}

function actionObservations(action: GameAction): Array<{ category: CoverageCategory; label: string }> {
  const type = action.type;
  const target = action.target;
  const payloadLabels = stringValues(action.payload);
  const label = target ?? payloadLabels[0] ?? type;
  const observations: Array<{ category: CoverageCategory; label: string }> = [];

  if (type.includes('main') || type.includes('objective')) observations.push({ category: 'mainQuests', label });
  if (type.includes('side-quest') || type.includes('side_quest')) observations.push({ category: 'sideQuests', label });
  if (type.includes('quest')) observations.push({ category: 'quests', label });
  if (type.includes('menu') || type.includes('settings') || type.includes('inventory')) observations.push({ category: 'menus', label });
  if (type.includes('shop') || type.includes('buy') || type.includes('sell')) observations.push({ category: 'shops', label });
  if (type.includes('boss') || type.includes('enemy') || type.includes('combat') || type.includes('attack')) observations.push({ category: 'bosses', label });
  if (type.includes('minigame')) observations.push({ category: 'minigames', label });
  if (type.includes('optional')) observations.push({ category: 'optionalStories', label });
  if (type.includes('hidden') || type.includes('locked-area') || type.includes('boundary')) observations.push({ category: 'hiddenAreas', label });
  if (type.includes('item') || type.includes('inventory') || type.includes('equip')) observations.push({ category: 'items', label });
  if (type.includes('collectible')) observations.push({ category: 'collectibles', label });
  if (type.includes('dialogue')) observations.push({ category: 'dialogueBranches', label });
  if (type.includes('ending')) observations.push({ category: 'endings', label });
  if (type.includes('post-game')) observations.push({ category: 'postGameContent', label });
  if (type.includes('achievement')) observations.push({ category: 'achievements', label });

  return observations.length > 0 ? observations : [{ category: 'scenes', label: type }];
}

export class CoverageTracker {
  private readonly knownByCategory: Record<CoverageCategory, string[]>;
  private readonly items = new Map<string, CoverageContentItem>();
  private readonly profilesByBotId = new Map<string, string>();

  constructor(gameProfile: GameProfile) {
    this.knownByCategory = knownContentFor(gameProfile);

    for (const category of coverageCategories) {
      for (const label of this.knownByCategory[category]) {
        this.ensureItem(category, label, true);
      }
    }
  }

  registerBot(botId: string, profile: Pick<BotProfile, 'profileId' | 'botType'> | string): void {
    const botType = typeof profile === 'string' ? profile : profile.profileId || profile.botType;
    this.profilesByBotId.set(botId, botType);
  }

  recordSnapshot(snapshot: GameStateSnapshot, context: CoverageEventContext = {}): void {
    const profileId = context.profileId ?? (snapshot.botId ? this.profilesByBotId.get(snapshot.botId) : undefined);

    for (const observation of stateObservations(snapshot)) {
      this.markTested(observation.category, observation.label, {
        botId: context.botId ?? snapshot.botId,
        profileId
      });
    }
  }

  recordAction(action: GameAction, context: CoverageEventContext = {}): void {
    const profileId = context.profileId ?? this.profilesByBotId.get(action.botId);

    for (const observation of actionObservations(action)) {
      this.markTested(observation.category, observation.label, {
        botId: context.botId ?? action.botId,
        profileId
      });
    }
  }

  recordIssue(issue: DetectedIssue): void {
    const labels = [
      issue.scene,
      issue.area,
      issue.category,
      issue.title,
      ...issue.lastActions
    ].filter((value): value is string => Boolean(value));

    for (const item of this.items.values()) {
      const matched = labels.some((label) => {
        const normalizedLabel = normalizeComparable(label);
        const normalizedItem = normalizeComparable(item.label);
        return normalizedLabel.includes(normalizedItem) || normalizedItem.includes(normalizedLabel);
      });

      if (matched && !item.issueIds.includes(issue.issueId)) {
        item.issueIds.push(issue.issueId);
      }
    }

    if ((issue.scene || issue.area) && issue.botId) {
      this.markTested('scenes', issue.scene ?? issue.area ?? 'Unknown', {
        botId: issue.botId,
        profileId: this.profilesByBotId.get(issue.botId),
        issueId: issue.issueId
      });
    }
  }

  getSummary(): ContentCoverageSummary {
    const items = [...this.items.values()].map((item) => ({
      ...item,
      botIds: [...item.botIds].sort(),
      botTypes: [...item.botTypes].sort(),
      issueIds: [...item.issueIds].sort()
    }));
    const knownItems = items.filter((item) => item.known);
    const testedKnown = knownItems.filter((item) => item.tested);
    const testedContent = items.filter((item) => item.tested).sort(sortItem);
    const untestedContent = knownItems.filter((item) => !item.tested).sort(sortItem);
    const contentWithIssues = items.filter((item) => item.issueIds.length > 0).sort(sortItem);
    const byCategory = coverageCategories.map((category) => {
      const categoryKnown = knownItems.filter((item) => item.category === category);
      const categoryTested = categoryKnown.filter((item) => item.tested);
      const observedCount = items.filter((item) => item.category === category && item.tested).length;

      return {
        category,
        knownCount: categoryKnown.length,
        testedKnownCount: categoryTested.length,
        observedCount,
        percentage: categoryKnown.length === 0 ? 0 : Math.round((categoryTested.length / categoryKnown.length) * 100)
      };
    });
    const byBotType = [...new Set(testedContent.flatMap((item) => item.botTypes))].sort().map((botType) => {
      const content = testedContent
        .filter((item) => item.botTypes.includes(botType))
        .map((item) => ({ category: item.category, label: item.label, contentId: item.contentId }));

      return {
        botType,
        testedCount: content.length,
        content
      };
    });

    return {
      percentage: knownItems.length === 0 ? 0 : Math.round((testedKnown.length / knownItems.length) * 100),
      totalKnown: knownItems.length,
      testedKnown: testedKnown.length,
      totalObserved: testedContent.length,
      testedContent,
      untestedContent,
      contentWithIssues,
      byCategory,
      byBotType
    };
  }

  private markTested(
    category: CoverageCategory,
    observedLabel: string,
    context: CoverageEventContext & { issueId?: string } = {}
  ): void {
    const knownLabel = findKnownLabel(this.knownByCategory[category], observedLabel);
    const item = this.ensureItem(category, knownLabel ?? observedLabel, knownLabel !== undefined);
    item.tested = true;

    if (context.botId && !item.botIds.includes(context.botId)) {
      item.botIds.push(context.botId);
    }

    if (context.profileId && !item.botTypes.includes(context.profileId)) {
      item.botTypes.push(context.profileId);
    }

    if (context.issueId && !item.issueIds.includes(context.issueId)) {
      item.issueIds.push(context.issueId);
    }
  }

  private ensureItem(category: CoverageCategory, label: string, known: boolean): CoverageContentItem {
    const contentId = `${category}:${normalizeId(label)}`;
    const existing = this.items.get(contentId);

    if (existing) {
      existing.known = existing.known || known;
      return existing;
    }

    const item: CoverageContentItem = {
      category,
      contentId,
      label,
      known,
      tested: false,
      botIds: [],
      botTypes: [],
      issueIds: []
    };
    this.items.set(contentId, item);
    return item;
  }
}

function sortItem(a: CoverageContentItem, b: CoverageContentItem): number {
  return a.category.localeCompare(b.category) || a.label.localeCompare(b.label);
}
