import {
  BotDirectiveEventSchema,
  BotDirectiveProgressSchema,
  BotTestDirectiveSchema,
  type BotDirectiveEvent,
  type BotDirectiveEventType,
  type BotDirectiveProgress,
  type BotTestDirective,
  type BotTestDirectiveStatus
} from '../types';

export interface BotDirectiveAssignment {
  botId: string;
  profileId: string;
  instanceId: string;
}

export interface BotDirectiveProgressUpdate {
  currentStepId?: string;
  actionsAttempted?: number;
  attempts?: number;
  matchedActions?: string[];
  unrelatedActions?: string[];
  successfulActions?: number;
  failedActions?: number;
  reachedScenes?: string[];
  reachedAreas?: string[];
  observedStateChanges?: string[];
  conditionsMet?: string[];
  issueIds?: string[];
  screenshotPaths?: string[];
  videoPaths?: string[];
  failureReason?: string;
  lastAction?: string;
  lastResult?: string;
  progressMessage?: string;
}

export interface BotDirectiveManagerSnapshot {
  sessionId: string;
  directives: BotTestDirective[];
  progress: BotDirectiveProgress[];
  events: BotDirectiveEvent[];
}

export interface BotDirectiveManagerOptions {
  sessionId: string;
  bots?: BotDirectiveAssignment[];
  now?: () => string;
  onEvent?: (event: BotDirectiveEvent) => void;
}

interface ManagedDirective {
  directive: BotTestDirective;
  order: number;
}

const priorityRank: Record<BotTestDirective['priority'], number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3
};

const terminalStatuses = new Set<BotTestDirectiveStatus>([
  'succeeded',
  'failed',
  'unavailable',
  'expired',
  'cancelled'
]);

function isTerminal(status: BotTestDirectiveStatus): boolean {
  return terminalStatuses.has(status);
}

function cloneDirective(directive: BotTestDirective): BotTestDirective {
  return BotTestDirectiveSchema.parse(directive);
}

function cloneProgress(progress: BotDirectiveProgress): BotDirectiveProgress {
  return BotDirectiveProgressSchema.parse(progress);
}

function cloneEvent(event: BotDirectiveEvent): BotDirectiveEvent {
  return BotDirectiveEventSchema.parse(event);
}

export class BotDirectiveManager {
  private readonly directives = new Map<string, ManagedDirective>();
  private readonly progress = new Map<string, Map<string, BotDirectiveProgress>>();
  private readonly events: BotDirectiveEvent[] = [];
  private bots = new Map<string, BotDirectiveAssignment>();
  private nextOrder = 0;
  private nextEventId = 0;
  private readonly now: () => string;
  private readonly onEvent?: (event: BotDirectiveEvent) => void;

  constructor(private readonly options: BotDirectiveManagerOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.onEvent = options.onEvent;
    this.setAvailableBots(options.bots ?? []);
  }

  setAvailableBots(bots: BotDirectiveAssignment[]): void {
    const next = new Map<string, BotDirectiveAssignment>();

    for (const bot of bots) {
      if (!bot.botId.trim() || !bot.profileId.trim() || !bot.instanceId.trim()) {
        throw new Error('Directive bot assignments require botId, profileId, and instanceId.');
      }
      if (next.has(bot.botId)) {
        throw new Error(`Bot ${bot.botId} is registered more than once.`);
      }
      next.set(bot.botId, { ...bot });
    }

    this.bots = next;
  }

  createDirective(input: unknown): BotTestDirective {
    const directive = BotTestDirectiveSchema.parse(input);

    if (directive.sessionId !== this.options.sessionId) {
      throw new Error('Directive sessionId must match the manager sessionId.');
    }
    if (this.directives.has(directive.directiveId)) {
      throw new Error(`Directive ${directive.directiveId} already exists.`);
    }

    this.directives.set(directive.directiveId, {
      directive,
      order: this.nextOrder++
    });
    this.emit('directive_created', directive, undefined, {
      name: directive.name,
      directiveType: directive.directiveType,
      directiveMode: directive.directiveMode,
      priority: directive.priority
    });

    return cloneDirective(directive);
  }

  queueDirective(directiveId: string): BotTestDirective {
    const managed = this.requireDirective(directiveId);
    const timestamp = this.now();

    managed.directive = {
      ...managed.directive,
      status: 'queued',
      activatedAt: undefined,
      completedAt: undefined
    };

    for (const [botId, current] of this.progressFor(directiveId)) {
      this.progressFor(directiveId).set(botId, {
        ...current,
        status: 'queued',
        currentStepId: undefined,
        startedAt: undefined,
        completedAt: undefined,
        updatedAt: timestamp,
        progressMessage: 'Directive queued.'
      });
    }

    this.emit('directive_queued', managed.directive, undefined, {});
    return cloneDirective(managed.directive);
  }

  assignDirective(
    directiveId: string,
    assignments: BotDirectiveAssignment[] = this.assignmentsForTarget(directiveId)
  ): BotDirectiveProgress[] {
    const managed = this.requireDirective(directiveId);
    const timestamp = this.now();

    if (assignments.length === 0) {
      return [];
    }

    const records = this.progressFor(directiveId);
    const assignedBotIds = new Set<string>();
    for (const assignment of assignments) {
      if (assignedBotIds.has(assignment.botId)) {
        throw new Error(`Bot ${assignment.botId} is assigned more than once.`);
      }
      assignedBotIds.add(assignment.botId);

      const registered = this.bots.get(assignment.botId);
      if (!registered) {
        throw new Error(`Bot ${assignment.botId} is not registered for this session.`);
      }
      if (!this.targetMatches(managed.directive, registered)) {
        throw new Error(`Bot ${assignment.botId} does not match directive ${directiveId}.`);
      }
      if (
        assignment.profileId !== registered.profileId ||
        assignment.instanceId !== registered.instanceId
      ) {
        throw new Error(`Assignment details for bot ${assignment.botId} do not match the registered bot.`);
      }

      const existing = records.get(assignment.botId);
      const progress = BotDirectiveProgressSchema.parse({
        directiveId,
        botId: assignment.botId,
        instanceId: assignment.instanceId,
        status: existing?.status ?? 'queued',
        currentStepId: existing?.currentStepId,
        actionsAttempted: existing?.actionsAttempted ?? 0,
        attempts: existing?.attempts ?? 0,
        matchedActions: existing?.matchedActions ?? [],
        unrelatedActions: existing?.unrelatedActions ?? [],
        successfulActions: existing?.successfulActions ?? 0,
        failedActions: existing?.failedActions ?? 0,
        reachedScenes: existing?.reachedScenes ?? [],
        reachedAreas: existing?.reachedAreas ?? [],
        observedStateChanges: existing?.observedStateChanges ?? [],
        conditionsMet: existing?.conditionsMet ?? [],
        issueIds: existing?.issueIds ?? [],
        screenshotPaths: existing?.screenshotPaths ?? [],
        videoPaths: existing?.videoPaths ?? [],
        failureReason: existing?.failureReason,
        lastAction: existing?.lastAction,
        lastResult: existing?.lastResult,
        progressMessage: existing?.progressMessage ?? 'Directive assigned and waiting.',
        startedAt: existing?.startedAt,
        updatedAt: timestamp,
        completedAt: existing?.completedAt
      });
      records.set(assignment.botId, progress);
      this.emit('directive_assigned', managed.directive, progress, {
        profileId: assignment.profileId
      });
    }

    return [...records.values()].map(cloneProgress);
  }

  activateDirective(directiveId: string, botId?: string): BotDirectiveProgress[] {
    const managed = this.requireDirective(directiveId);
    const records = this.progressFor(directiveId);
    const selected = botId
      ? [this.requireProgress(directiveId, botId)]
      : [...records.values()].filter((item) => item.status === 'queued');
    const activated: BotDirectiveProgress[] = [];

    for (const current of selected) {
      if (current.status !== 'queued') {
        if (botId) {
          throw new Error(`Directive ${directiveId} is not queued for bot ${current.botId}.`);
        }
        continue;
      }

      const active = this.getActiveProgressForBot(current.botId);
      if (active && active.directiveId !== directiveId) {
        if (botId) {
          throw new Error(`Bot ${current.botId} already has an active directive.`);
        }
        continue;
      }

      const next = this.firstQueuedDirectiveForBot(current.botId);
      if (next?.directiveId !== directiveId) {
        if (botId) {
          throw new Error(`A higher-priority directive is queued for bot ${current.botId}.`);
        }
        continue;
      }

      const timestamp = this.now();
      const progress = BotDirectiveProgressSchema.parse({
        ...current,
        status: 'active',
        startedAt: current.startedAt ?? timestamp,
        updatedAt: timestamp,
        completedAt: undefined,
        progressMessage: 'Directive active.'
      });
      records.set(current.botId, progress);
      activated.push(cloneProgress(progress));
      this.emit('directive_activated', managed.directive, progress, {});
    }

    if (activated.length > 0) {
      managed.directive = {
        ...managed.directive,
        status: 'active',
        activatedAt: managed.directive.activatedAt ?? this.now(),
        completedAt: undefined
      };
    }

    return activated;
  }

  getDirective(directiveId: string): BotTestDirective | undefined {
    const directive = this.directives.get(directiveId)?.directive;
    return directive ? cloneDirective(directive) : undefined;
  }

  getDirectivesForBot(botId: string): BotTestDirective[] {
    return this.sortedManagedDirectives()
      .filter(({ directive }) => this.progress.get(directive.directiveId)?.has(botId))
      .map(({ directive }) => cloneDirective(directive));
  }

  getActiveDirectiveForBot(botId: string): BotTestDirective | undefined {
    const active = this.getActiveProgressForBot(botId);
    return active ? this.getDirective(active.directiveId) : undefined;
  }

  getQueuedDirectives(botId?: string): BotTestDirective[] {
    return this.sortedManagedDirectives()
      .filter(({ directive }) => {
        const records = this.progress.get(directive.directiveId);
        if (botId) {
          return records?.get(botId)?.status === 'queued';
        }
        return (
          directive.status === 'queued' ||
          directive.status === 'partially-completed' ||
          [...(records?.values() ?? [])].some((item) => item.status === 'queued')
        );
      })
      .map(({ directive }) => cloneDirective(directive));
  }

  getProgress(directiveId: string, botId?: string): BotDirectiveProgress[] {
    const values = [...this.progressFor(directiveId).values()];
    return values.filter((item) => !botId || item.botId === botId).map(cloneProgress);
  }

  updateDirectiveProgress(
    directiveId: string,
    botId: string,
    update: BotDirectiveProgressUpdate
  ): BotDirectiveProgress {
    const managed = this.requireDirective(directiveId);
    const current = this.requireProgress(directiveId, botId);
    if (isTerminal(current.status)) {
      throw new Error(`Directive ${directiveId} is already complete for bot ${botId}.`);
    }

    const next = BotDirectiveProgressSchema.parse({
      ...current,
      ...update,
      updatedAt: this.now()
    });
    this.progressFor(directiveId).set(botId, next);

    if (update.lastAction && update.lastAction !== current.lastAction) {
      this.emit('directive_action_selected', managed.directive, next, {
        action: update.lastAction,
        result: update.lastResult
      });
    }
    if (update.currentStepId && update.currentStepId !== current.currentStepId) {
      this.emit('directive_step_started', managed.directive, next, {
        stepId: update.currentStepId
      });
    }
    this.emit('directive_progress', managed.directive, next, {
      message: next.progressMessage,
      actionsAttempted: next.actionsAttempted,
      attempts: next.attempts
    });

    return cloneProgress(next);
  }

  markDirectiveStepCompleted(directiveId: string, botId: string, stepId: string): BotDirectiveProgress {
    const managed = this.requireDirective(directiveId);
    const progress = this.requireProgress(directiveId, botId);
    this.emit('directive_step_completed', managed.directive, progress, { stepId });
    return cloneProgress(progress);
  }

  markDirectiveStepFailed(
    directiveId: string,
    botId: string,
    stepId: string,
    message: string
  ): BotDirectiveProgress {
    const managed = this.requireDirective(directiveId);
    const progress = this.requireProgress(directiveId, botId);
    this.emit('directive_step_failed', managed.directive, progress, { stepId, message });
    return cloneProgress(progress);
  }

  recordStateChange(
    directiveId: string,
    botId: string,
    summary: string,
    location: { scene?: string; area?: string } = {}
  ): BotDirectiveProgress {
    const current = this.requireProgress(directiveId, botId);
    const next = this.updateDirectiveProgress(directiveId, botId, {
      observedStateChanges: [...new Set([...(current.observedStateChanges ?? []), summary])],
      reachedScenes: location.scene
        ? [...new Set([...(current.reachedScenes ?? []), location.scene])]
        : current.reachedScenes,
      reachedAreas: location.area
        ? [...new Set([...(current.reachedAreas ?? []), location.area])]
        : current.reachedAreas,
      progressMessage: summary
    });
    this.emit('directive_state_changed', this.requireDirective(directiveId).directive, next, {
      summary,
      scene: location.scene,
      area: location.area
    });
    return next;
  }

  recordConditionCheck(
    directiveId: string,
    botId: string,
    condition: string,
    met: boolean,
    message?: string
  ): BotDirectiveProgress {
    const current = this.requireProgress(directiveId, botId);
    const next = this.updateDirectiveProgress(directiveId, botId, {
      conditionsMet: met
        ? [...new Set([...(current.conditionsMet ?? []), condition])]
        : current.conditionsMet,
      progressMessage: message ?? `${condition}: ${met ? 'met' : 'not met'}.`
    });
    this.emit('directive_condition_checked', this.requireDirective(directiveId).directive, next, {
      condition,
      met,
      message
    });
    return next;
  }

  recordEvidence(
    directiveId: string,
    botId: string,
    kind: 'screenshot' | 'video',
    path: string
  ): BotDirectiveProgress {
    const current = this.requireProgress(directiveId, botId);
    const next = BotDirectiveProgressSchema.parse({
      ...current,
      ...(kind === 'screenshot'
        ? { screenshotPaths: [...new Set([...(current.screenshotPaths ?? []), path])] }
        : { videoPaths: [...new Set([...(current.videoPaths ?? []), path])] }),
      updatedAt: this.now()
    });
    this.progressFor(directiveId).set(botId, next);
    this.emit('directive_evidence_captured', this.requireDirective(directiveId).directive, next, {
      kind,
      path
    });
    return next;
  }

  recordIssue(directiveId: string, botId: string, issueId: string): BotDirectiveProgress {
    const current = this.requireProgress(directiveId, botId);
    const next = BotDirectiveProgressSchema.parse({
      ...current,
      issueIds: [...new Set([...(current.issueIds ?? []), issueId])],
      updatedAt: this.now()
    });
    this.progressFor(directiveId).set(botId, next);
    this.emit('directive_progress', this.requireDirective(directiveId).directive, next, {
      message: `Issue ${issueId} was found while testing this direction.`,
      issueId
    });
    return cloneProgress(next);
  }

  markDirectiveSucceeded(directiveId: string, botId?: string, message = 'Directive succeeded.'): BotTestDirective {
    return this.completeProgress(directiveId, botId, 'succeeded', 'directive_succeeded', message);
  }

  markDirectiveFailed(directiveId: string, botId?: string, message = 'Directive failed.'): BotTestDirective {
    return this.completeProgress(directiveId, botId, 'failed', 'directive_failed', message);
  }

  markDirectiveUnavailable(
    directiveId: string,
    botId?: string,
    message = 'The required action is unavailable.'
  ): BotTestDirective {
    return this.completeProgress(directiveId, botId, 'unavailable', 'directive_unavailable', message);
  }

  cancelDirective(directiveId: string, message = 'Directive cancelled by the user.'): BotTestDirective {
    const managed = this.requireDirective(directiveId);
    this.completeProgress(directiveId, undefined, 'cancelled', 'directive_cancelled', message);
    managed.directive = {
      ...managed.directive,
      status: 'cancelled',
      completedAt: this.now()
    };
    return cloneDirective(managed.directive);
  }

  cancelDirectiveForBot(
    directiveId: string,
    botId: string,
    message = 'Directive cancelled for this bot by the user.'
  ): BotTestDirective {
    return this.completeProgress(
      directiveId,
      botId,
      'cancelled',
      'directive_cancelled',
      message
    );
  }

  expireDirectives(at = this.now()): BotTestDirective[] {
    const expired: BotTestDirective[] = [];
    const atTime = Date.parse(at);

    for (const { directive } of this.sortedManagedDirectives()) {
      if (
        directive.expiresAt &&
        !isTerminal(directive.status) &&
        Date.parse(directive.expiresAt) <= atTime
      ) {
        this.completeProgress(
          directive.directiveId,
          undefined,
          'expired',
          'directive_expired',
          'Directive expired before it could finish.'
        );
        const managed = this.requireDirective(directive.directiveId);
        managed.directive = {
          ...managed.directive,
          status: 'expired',
          completedAt: at
        };
        expired.push(cloneDirective(managed.directive));
      }
    }

    return expired;
  }

  reassignDirective(
    directiveId: string,
    fromBotId: string,
    to: BotDirectiveAssignment
  ): BotDirectiveProgress {
    const managed = this.requireDirective(directiveId);
    const current = this.requireProgress(directiveId, fromBotId);
    const registered = this.bots.get(to.botId);

    if (!registered || !this.targetMatches(managed.directive, registered)) {
      throw new Error(`Bot ${to.botId} is not an available target for directive ${directiveId}.`);
    }
    if (fromBotId === to.botId) {
      throw new Error('A directive must be reassigned to a different bot.');
    }
    if (this.progressFor(directiveId).has(to.botId)) {
      throw new Error(`Directive ${directiveId} is already assigned to bot ${to.botId}.`);
    }
    if (to.profileId !== registered.profileId || to.instanceId !== registered.instanceId) {
      throw new Error(`Assignment details for bot ${to.botId} do not match the registered bot.`);
    }
    if (this.getActiveProgressForBot(to.botId)) {
      throw new Error(`Bot ${to.botId} already has an active directive.`);
    }

    const timestamp = this.now();
    this.progressFor(directiveId).set(fromBotId, {
      ...current,
      status: 'cancelled',
      updatedAt: timestamp,
      completedAt: timestamp,
      progressMessage: `Directive reassigned to ${to.botId}.`
    });
    const next = BotDirectiveProgressSchema.parse({
      ...current,
      botId: to.botId,
      instanceId: to.instanceId,
      status: 'queued',
      startedAt: undefined,
      completedAt: undefined,
      updatedAt: timestamp,
      progressMessage: `Reassigned from ${fromBotId}.`
    });
    this.progressFor(directiveId).set(to.botId, next);
    managed.directive = { ...managed.directive, status: 'queued', completedAt: undefined };
    this.emit('directive_reassigned', managed.directive, next, { fromBotId, toBotId: to.botId });
    return cloneProgress(next);
  }

  reorderDirectives(directiveIds: string[]): BotTestDirective[] {
    const seen = new Set<string>();
    directiveIds.forEach((directiveId) => {
      if (seen.has(directiveId)) {
        throw new Error(`Directive ${directiveId} appears more than once in the requested order.`);
      }
      seen.add(directiveId);
      this.requireDirective(directiveId);
    });

    for (const directiveId of directiveIds) {
      this.requireDirective(directiveId).order = this.nextOrder++;
    }

    return this.getQueuedDirectives();
  }

  clearCompletedDirectives(): number {
    let removed = 0;

    for (const [directiveId, managed] of this.directives) {
      if (!isTerminal(managed.directive.status)) {
        continue;
      }
      this.directives.delete(directiveId);
      this.progress.delete(directiveId);
      removed += 1;
    }

    return removed;
  }

  getEvents(): BotDirectiveEvent[] {
    return this.events.map(cloneEvent);
  }

  drainEvents(): BotDirectiveEvent[] {
    const events = this.getEvents();
    this.events.length = 0;
    return events;
  }

  getSnapshot(): BotDirectiveManagerSnapshot {
    return {
      sessionId: this.options.sessionId,
      directives: this.sortedManagedDirectives().map(({ directive }) => cloneDirective(directive)),
      progress: [...this.progress.values()].flatMap((records) => [...records.values()].map(cloneProgress)),
      events: this.getEvents()
    };
  }

  private completeProgress(
    directiveId: string,
    botId: string | undefined,
    status: Extract<BotTestDirectiveStatus, 'succeeded' | 'failed' | 'unavailable' | 'expired' | 'cancelled'>,
    eventType: Extract<
      BotDirectiveEventType,
      | 'directive_succeeded'
      | 'directive_failed'
      | 'directive_unavailable'
      | 'directive_expired'
      | 'directive_cancelled'
    >,
    message: string
  ): BotTestDirective {
    const managed = this.requireDirective(directiveId);
    const records = this.progressFor(directiveId);
    const selected = botId ? [this.requireProgress(directiveId, botId)] : [...records.values()];
    const timestamp = this.now();

    if (selected.length === 0) {
      managed.directive = {
        ...managed.directive,
        status,
        completedAt: timestamp
      };
      this.emit(eventType, managed.directive, undefined, { message });
      return cloneDirective(managed.directive);
    }

    for (const current of selected) {
      if (isTerminal(current.status)) {
        continue;
      }
      const next = BotDirectiveProgressSchema.parse({
        ...current,
        status,
        progressMessage: message,
        updatedAt: timestamp,
        completedAt: timestamp,
        failureReason: status === 'succeeded' || status === 'cancelled' ? undefined : message
      });
      records.set(current.botId, next);
      this.emit(eventType, managed.directive, next, { message });
    }

    managed.directive = {
      ...managed.directive,
      status: this.deriveDirectiveStatus(records),
      completedAt: [...records.values()].every((item) => isTerminal(item.status)) ? timestamp : undefined
    };
    return cloneDirective(managed.directive);
  }

  private deriveDirectiveStatus(records: Map<string, BotDirectiveProgress>): BotTestDirectiveStatus {
    const statuses = [...records.values()].map((item) => item.status);
    if (statuses.length === 0) {
      return 'queued';
    }
    if (statuses.every((status) => status === 'succeeded')) {
      return 'succeeded';
    }
    if (statuses.every((status) => status === 'unavailable')) {
      return 'unavailable';
    }
    if (statuses.every((status) => status === 'expired')) {
      return 'expired';
    }
    if (statuses.every((status) => status === 'cancelled')) {
      return 'cancelled';
    }
    if (statuses.every((status) => status === 'failed')) {
      return 'failed';
    }
    if (statuses.some((status) => status === 'active')) {
      return 'active';
    }
    if (statuses.some(isTerminal)) {
      return 'partially-completed';
    }
    return 'queued';
  }

  private firstQueuedDirectiveForBot(botId: string): BotTestDirective | undefined {
    return this.getQueuedDirectives(botId)[0];
  }

  private getActiveProgressForBot(botId: string): BotDirectiveProgress | undefined {
    for (const records of this.progress.values()) {
      const item = records.get(botId);
      if (item?.status === 'active') {
        return item;
      }
    }
    return undefined;
  }

  private assignmentsForTarget(directiveId: string): BotDirectiveAssignment[] {
    const directive = this.requireDirective(directiveId).directive;
    return [...this.bots.values()].filter((bot) => this.targetMatches(directive, bot));
  }

  private targetMatches(directive: BotTestDirective, bot: BotDirectiveAssignment): boolean {
    const target = directive.target;
    return (
      target.allBots ||
      target.botIds.includes(bot.botId) ||
      target.profileIds.includes(bot.profileId) ||
      target.gameInstanceIds.includes(bot.instanceId)
    );
  }

  private sortedManagedDirectives(): ManagedDirective[] {
    return [...this.directives.values()].sort(
      (left, right) =>
        priorityRank[left.directive.priority] - priorityRank[right.directive.priority] ||
        left.order - right.order
    );
  }

  private progressFor(directiveId: string): Map<string, BotDirectiveProgress> {
    this.requireDirective(directiveId);
    let records = this.progress.get(directiveId);
    if (!records) {
      records = new Map();
      this.progress.set(directiveId, records);
    }
    return records;
  }

  private requireDirective(directiveId: string): ManagedDirective {
    const managed = this.directives.get(directiveId);
    if (!managed) {
      throw new Error(`Directive ${directiveId} does not exist.`);
    }
    return managed;
  }

  private requireProgress(directiveId: string, botId: string): BotDirectiveProgress {
    const progress = this.progressFor(directiveId).get(botId);
    if (!progress) {
      throw new Error(`Directive ${directiveId} is not assigned to bot ${botId}.`);
    }
    return progress;
  }

  private emit(
    eventType: BotDirectiveEventType,
    directive: BotTestDirective,
    progress: BotDirectiveProgress | undefined,
    payload: Record<string, unknown>
  ): void {
    const event = BotDirectiveEventSchema.parse({
      eventId: `${this.options.sessionId}-directive-event-${++this.nextEventId}`,
      eventType,
      sessionId: this.options.sessionId,
      directiveId: directive.directiveId,
      botId: progress?.botId,
      instanceId: progress?.instanceId,
      timestamp: this.now(),
      payload
    });
    this.events.push(event);
    this.onEvent?.(cloneEvent(event));
  }
}
