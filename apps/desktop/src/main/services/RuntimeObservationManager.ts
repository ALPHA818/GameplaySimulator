import type { ObservationMode, RuntimeObservationConfig } from '@core/config/runtimeObservationConfig';

export interface ObservationBotReference {
  botId: string;
  status: string;
  gameInstanceId?: string;
}

export interface ObservationSelectionChange {
  previousBotId?: string;
  watchedBotId?: string;
  watchedGameInstanceId?: string;
  observationMode: ObservationMode;
  reason: 'default' | 'manual' | 'next' | 'previous' | 'stopped' | 'stop-following';
  message: string;
}

const activeStatuses = new Set(['queued', 'starting', 'running', 'waiting']);

export class RuntimeObservationManager {
  private watchedBotId?: string;
  private observationMode: ObservationMode;
  private followingEnabled = true;
  private lastMessage = 'Waiting for a running bot to observe.';

  constructor(private readonly config: RuntimeObservationConfig) {
    this.watchedBotId = config.selectedBotId;
    this.observationMode = config.observationMode;
  }

  get mode(): ObservationMode {
    return this.observationMode;
  }

  get selectedBotId(): string | undefined {
    return this.watchedBotId;
  }

  get message(): string {
    return this.lastMessage;
  }

  get isFollowing(): boolean {
    return this.followingEnabled;
  }

  reconcile(bots: ObservationBotReference[]): ObservationSelectionChange | null {
    if (!this.followingEnabled) {
      return null;
    }

    const runningBots = bots.filter((bot) => activeStatuses.has(bot.status));
    const current = runningBots.find((bot) => bot.botId === this.watchedBotId);

    if (current) {
      return null;
    }

    const previousBotId = this.watchedBotId;
    const next = runningBots[0];
    this.watchedBotId = next?.botId;

    if (!next) {
      this.lastMessage = previousBotId
        ? `Watched bot ${previousBotId} stopped. Waiting for another running bot.`
        : 'Waiting for a running bot to observe.';
      return previousBotId
        ? {
            previousBotId,
            observationMode: this.observationMode,
            reason: 'stopped',
            message: this.lastMessage
          }
        : null;
    }

    this.lastMessage = previousBotId
      ? `Watched bot ${previousBotId} stopped. Switched to ${next.botId}.`
      : `Watching the first running bot, ${next.botId}.`;

    return {
      previousBotId,
      watchedBotId: next.botId,
      watchedGameInstanceId: next.gameInstanceId,
      observationMode: this.observationMode,
      reason: previousBotId ? 'stopped' : 'default',
      message: this.lastMessage
    };
  }

  follow(botId: string, bots: ObservationBotReference[]): ObservationSelectionChange {
    const bot = bots.find((candidate) => candidate.botId === botId);

    if (!bot || !activeStatuses.has(bot.status)) {
      throw new Error(`Bot "${botId}" is not currently available to observe.`);
    }

    const previousBotId = this.watchedBotId;
    this.followingEnabled = true;
    this.watchedBotId = bot.botId;
    this.observationMode = 'follow-selected-bot';
    this.lastMessage = previousBotId === bot.botId
      ? `Continuing to watch ${bot.botId}.`
      : `Changed the watched bot from ${previousBotId ?? 'none'} to ${bot.botId}.`;

    return {
      previousBotId,
      watchedBotId: bot.botId,
      watchedGameInstanceId: bot.gameInstanceId,
      observationMode: this.observationMode,
      reason: 'manual',
      message: this.lastMessage
    };
  }

  move(direction: 'next' | 'previous', bots: ObservationBotReference[]): ObservationSelectionChange | null {
    const runningBots = bots.filter((bot) => activeStatuses.has(bot.status));

    if (runningBots.length === 0) {
      this.lastMessage = 'No running bot is available to watch.';
      return null;
    }

    const currentIndex = runningBots.findIndex((bot) => bot.botId === this.watchedBotId);
    const offset = direction === 'next' ? 1 : -1;
    const nextIndex = currentIndex === -1
      ? 0
      : (currentIndex + offset + runningBots.length) % runningBots.length;
    const next = runningBots[nextIndex];
    const previousBotId = this.watchedBotId;
    this.followingEnabled = true;
    this.watchedBotId = next.botId;
    this.observationMode = 'follow-selected-bot';
    this.lastMessage = `Showing the ${direction} running bot, ${next.botId}.`;

    return {
      previousBotId,
      watchedBotId: next.botId,
      watchedGameInstanceId: next.gameInstanceId,
      observationMode: this.observationMode,
      reason: direction,
      message: this.lastMessage
    };
  }

  stopFollowing(): ObservationSelectionChange {
    const previousBotId = this.watchedBotId;
    this.followingEnabled = false;
    this.watchedBotId = undefined;
    this.observationMode = 'background';
    this.lastMessage = 'Stopped following a bot. The session continues in the background.';

    return {
      previousBotId,
      observationMode: this.observationMode,
      reason: 'stop-following',
      message: this.lastMessage
    };
  }
}
