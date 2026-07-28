import { z } from 'zod';

const NonEmptyTextSchema = z.string().trim().min(1);
const OptionalTextSchema = NonEmptyTextSchema.optional();
const TimestampSchema = z.iso.datetime({ offset: true });
const UniqueTextListSchema = z.array(NonEmptyTextSchema).superRefine((values, context) => {
  const seen = new Set<string>();

  values.forEach((value, index) => {
    if (seen.has(value)) {
      context.addIssue({
        code: 'custom',
        path: [index],
        message: 'Values must not be repeated.'
      });
    }

    seen.add(value);
  });
});

export const BotTestDirectiveTypeSchema = z.enum([
  'action',
  'feature',
  'scene',
  'area',
  'ui-flow',
  'game-state',
  'issue-reproduction',
  'sequence',
  'freeform'
]);

export const BotTestDirectiveModeSchema = z.enum([
  'influence',
  'focus',
  'force-next-valid-action',
  'repeat-until-condition',
  'guided-sequence'
]);

export const BotTestDirectivePrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);

export const BotTestDirectiveStatusSchema = z.enum([
  'queued',
  'active',
  'partially-completed',
  'succeeded',
  'failed',
  'unavailable',
  'expired',
  'cancelled'
]);

export const BotDirectiveEventTypeSchema = z.enum([
  'directive_created',
  'directive_queued',
  'directive_assigned',
  'directive_activated',
  'directive_action_selected',
  'directive_state_changed',
  'directive_condition_checked',
  'directive_evidence_captured',
  'directive_step_started',
  'directive_step_completed',
  'directive_step_failed',
  'directive_progress',
  'directive_succeeded',
  'directive_failed',
  'directive_unavailable',
  'directive_expired',
  'directive_cancelled',
  'directive_reassigned'
]);

export const DirectiveTargetSchema = z
  .object({
    allBots: z.boolean(),
    botIds: UniqueTextListSchema,
    profileIds: UniqueTextListSchema,
    gameInstanceIds: UniqueTextListSchema
  })
  .strict()
  .superRefine((target, context) => {
    const hasSpecificTarget =
      target.botIds.length > 0 || target.profileIds.length > 0 || target.gameInstanceIds.length > 0;

    if (!target.allBots && !hasSpecificTarget) {
      context.addIssue({
        code: 'custom',
        path: ['allBots'],
        message: 'Choose all bots or at least one bot, profile, or game instance.'
      });
    }

    if (target.allBots && hasSpecificTarget) {
      context.addIssue({
        code: 'custom',
        path: ['allBots'],
        message: 'allBots cannot be combined with a specific bot, profile, or game instance.'
      });
    }
  });

export const BotDirectiveStepSchema = z
  .object({
    stepId: NonEmptyTextSchema,
    name: NonEmptyTextSchema,
    description: OptionalTextSchema,
    actionType: NonEmptyTextSchema,
    actionKeywords: UniqueTextListSchema.default([]),
    targetScene: OptionalTextSchema,
    targetArea: OptionalTextSchema,
    expectedState: z.record(z.string(), z.unknown()).optional(),
    successCondition: NonEmptyTextSchema,
    fallbackAction: OptionalTextSchema,
    maxAttempts: z.number().int().positive(),
    waitAfterMs: z.number().int().min(0)
  })
  .strict();

export const BotTestDirectiveSchema = z
  .object({
    directiveId: NonEmptyTextSchema,
    sessionId: NonEmptyTextSchema,
    name: NonEmptyTextSchema,
    description: NonEmptyTextSchema,
    directiveType: BotTestDirectiveTypeSchema,
    directiveMode: BotTestDirectiveModeSchema,
    priority: BotTestDirectivePrioritySchema,
    status: BotTestDirectiveStatusSchema,
    target: DirectiveTargetSchema,
    actionKeywords: UniqueTextListSchema.default([]),
    avoidedActionKeywords: UniqueTextListSchema.default([]),
    targetFeature: OptionalTextSchema,
    targetScene: OptionalTextSchema,
    targetArea: OptionalTextSchema,
    targetUiFlowId: OptionalTextSchema,
    targetIssueId: OptionalTextSchema,
    expectedState: z.record(z.string(), z.unknown()).optional(),
    successConditions: UniqueTextListSchema.default([]),
    failureConditions: UniqueTextListSchema.default([]),
    steps: z.array(BotDirectiveStepSchema).default([]),
    maxActions: z.number().int().positive().optional(),
    maxAttempts: z.number().int().positive().optional(),
    timeoutMs: z.number().int().positive().optional(),
    repeatUntilSuccess: z.boolean(),
    manualSuccessConfirmation: z.boolean().optional(),
    createdAt: TimestampSchema,
    activatedAt: TimestampSchema.optional(),
    completedAt: TimestampSchema.optional(),
    expiresAt: TimestampSchema.optional(),
    createdBy: NonEmptyTextSchema,
    notes: OptionalTextSchema
  })
  .strict()
  .superRefine((directive, context) => {
    const avoidedActions = new Set(directive.avoidedActionKeywords);
    directive.actionKeywords.forEach((keyword, index) => {
      if (avoidedActions.has(keyword)) {
        context.addIssue({
          code: 'custom',
          path: ['actionKeywords', index],
          message: 'An action cannot be both requested and avoided.'
        });
      }
    });

    if (directive.directiveMode === 'force-next-valid-action') {
      if (directive.directiveType !== 'action') {
        context.addIssue({
          code: 'custom',
          path: ['directiveType'],
          message: 'force-next-valid-action directives must use the action directive type.'
        });
      }

      if (directive.actionKeywords.length !== 1) {
        context.addIssue({
          code: 'custom',
          path: ['actionKeywords'],
          message: 'Provide exactly one reported action type for force-next-valid-action.'
        });
      }
    }

    if (directive.directiveMode === 'guided-sequence' || directive.directiveType === 'sequence') {
      if (directive.directiveMode !== 'guided-sequence' || directive.directiveType !== 'sequence') {
        context.addIssue({
          code: 'custom',
          path: ['directiveMode'],
          message: 'Sequence directives must use guided-sequence mode.'
        });
      }

      if (directive.steps.length === 0) {
        context.addIssue({
          code: 'custom',
          path: ['steps'],
          message: 'A guided sequence must contain at least one step.'
        });
      }

      const stepIds = new Set<string>();
      directive.steps.forEach((step, index) => {
        if (stepIds.has(step.stepId)) {
          context.addIssue({
            code: 'custom',
            path: ['steps', index, 'stepId'],
            message: 'Sequence step IDs must be unique.'
          });
        }
        stepIds.add(step.stepId);
      });
    } else if (directive.steps.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['steps'],
        message: 'Steps are only valid for guided sequence directives.'
      });
    }

    if (
      directive.directiveMode === 'repeat-until-condition' &&
      directive.successConditions.length === 0 &&
      directive.expectedState === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['successConditions'],
        message: 'Repeat directives need a success condition or expected state.'
      });
    }

    const requiredTarget: Partial<Record<BotTestDirectiveType, keyof typeof directive>> = {
      feature: 'targetFeature',
      scene: 'targetScene',
      area: 'targetArea',
      'ui-flow': 'targetUiFlowId',
      'issue-reproduction': 'targetIssueId'
    };
    const requiredField = requiredTarget[directive.directiveType];

    if (requiredField && !directive[requiredField]) {
      context.addIssue({
        code: 'custom',
        path: [requiredField],
        message: `${requiredField} is required for ${directive.directiveType} directives.`
      });
    }

    if (directive.directiveType === 'game-state' && directive.expectedState === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['expectedState'],
        message: 'expectedState is required for game-state directives.'
      });
    }

    if (directive.expiresAt && Date.parse(directive.expiresAt) <= Date.parse(directive.createdAt)) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'expiresAt must be later than createdAt.'
      });
    }
  });

export const BotDirectiveProgressSchema = z
  .object({
    directiveId: NonEmptyTextSchema,
    botId: NonEmptyTextSchema,
    instanceId: NonEmptyTextSchema,
    status: BotTestDirectiveStatusSchema,
    currentStepId: OptionalTextSchema,
    actionsAttempted: z.number().int().min(0),
    attempts: z.number().int().min(0),
    matchedActions: z.array(NonEmptyTextSchema),
    unrelatedActions: z.array(NonEmptyTextSchema).optional(),
    successfulActions: z.number().int().min(0).optional(),
    failedActions: z.number().int().min(0).optional(),
    reachedScenes: z.array(NonEmptyTextSchema).optional(),
    reachedAreas: z.array(NonEmptyTextSchema).optional(),
    observedStateChanges: z.array(NonEmptyTextSchema).optional(),
    conditionsMet: z.array(NonEmptyTextSchema).optional(),
    issueIds: z.array(NonEmptyTextSchema).optional(),
    screenshotPaths: z.array(NonEmptyTextSchema).optional(),
    videoPaths: z.array(NonEmptyTextSchema).optional(),
    failureReason: OptionalTextSchema,
    lastAction: OptionalTextSchema,
    lastResult: OptionalTextSchema,
    progressMessage: OptionalTextSchema,
    startedAt: TimestampSchema.optional(),
    updatedAt: TimestampSchema,
    completedAt: TimestampSchema.optional()
  })
  .strict();

export const BotDirectiveEventSchema = z
  .object({
    eventId: NonEmptyTextSchema,
    eventType: BotDirectiveEventTypeSchema,
    sessionId: NonEmptyTextSchema,
    directiveId: NonEmptyTextSchema,
    botId: OptionalTextSchema,
    instanceId: OptionalTextSchema,
    timestamp: TimestampSchema,
    payload: z.record(z.string(), z.unknown())
  })
  .strict();

export interface DirectiveAvailableAction {
  actionType: string;
}

export type DirectiveActionAvailability =
  | {
      available: true;
      actionType: string;
    }
  | {
      available: false;
      requestedActionType?: string;
      reason: string;
    };

export function resolveAvailableActionType(
  requestedActionType: string,
  availableActions: readonly DirectiveAvailableAction[]
): DirectiveActionAvailability {
  const match = availableActions.find((action) => action.actionType === requestedActionType);
  if (!match) {
    return {
      available: false,
      requestedActionType,
      reason: `The adapter does not currently report ${requestedActionType} as an available action.`
    };
  }

  return {
    available: true,
    actionType: match.actionType
  };
}

export function resolveDirectiveActionAvailability(
  directive: BotTestDirective,
  availableActions: readonly DirectiveAvailableAction[]
): DirectiveActionAvailability {
  if (directive.directiveMode !== 'force-next-valid-action') {
    return {
      available: false,
      reason: 'Only force-next-valid-action directives request one exact action.'
    };
  }

  const requestedActionType = directive.actionKeywords[0];
  if (!requestedActionType) {
    return {
      available: false,
      reason: 'The directive does not name an exact action type.'
    };
  }

  return resolveAvailableActionType(requestedActionType, availableActions);
}

export type BotTestDirectiveType = z.infer<typeof BotTestDirectiveTypeSchema>;
export type BotTestDirectiveMode = z.infer<typeof BotTestDirectiveModeSchema>;
export type BotTestDirectivePriority = z.infer<typeof BotTestDirectivePrioritySchema>;
export type BotTestDirectiveStatus = z.infer<typeof BotTestDirectiveStatusSchema>;
export type BotDirectiveEventType = z.infer<typeof BotDirectiveEventTypeSchema>;
export type DirectiveTarget = z.infer<typeof DirectiveTargetSchema>;
export type BotDirectiveStep = z.infer<typeof BotDirectiveStepSchema>;
export type BotTestDirective = z.infer<typeof BotTestDirectiveSchema>;
export type BotDirectiveProgress = z.infer<typeof BotDirectiveProgressSchema>;
export type BotDirectiveEvent = z.infer<typeof BotDirectiveEventSchema>;
