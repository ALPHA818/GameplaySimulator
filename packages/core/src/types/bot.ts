import { z } from 'zod';
import { IssueCategorySchema } from './issue';

export const ResourceWeightSchema = z.enum(['light', 'medium', 'heavy', 'very_heavy']);

export const ScalingModeSchema = z.enum(['fixed', 'auto']);

export const BotProfileGroupSchema = z.enum(['general', 'specialized', 'custom']);

export const BotSpecializationCategorySchema = z.enum([
  'gameplay-systems',
  'ui-input',
  'content-progression',
  'persistence',
  'performance-stability',
  'accessibility',
  'platform',
  'network-multiplayer',
  'world-simulation',
  'engine-specific'
]);

export const BotProfileComplexitySchema = z.enum(['low', 'medium', 'high', 'advanced']);

export const BotCapabilityIdSchema = z.enum([
  'state-read',
  'direct-actions',
  'input-simulation',
  'screenshots',
  'video',
  'game-logs',
  'save-isolation',
  'reset',
  'checkpoint-reload',
  'multiple-instances',
  'live-observation',
  'window-focus',
  'keyboard-input',
  'mouse-input',
  'gamepad-input',
  'touch-input',
  'ui-flows',
  'performance-metrics',
  'network-instrumentation',
  'audio-signals',
  'file-test-sandbox'
]);

export const BotGoalSchema = z.object({
  goalId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  priority: z.number().default(0),
  successCriteria: z.array(z.string().min(1)).default([]),
  targetIssueCategories: z.array(IssueCategorySchema).default([])
});

export const BotProfileSchema = z.object({
  profileId: z.string().min(1),
  displayName: z.string().min(1),
  botType: z.string().min(1),
  profileGroup: BotProfileGroupSchema.optional(),
  specializationCategory: BotSpecializationCategorySchema.optional(),
  requiredCapabilities: z.array(z.string().min(1)).optional(),
  recommendedGameTypes: z.array(z.string().min(1)).optional(),
  incompatibleGameTypes: z.array(z.string().min(1)).optional(),
  bestUsedFor: z.array(z.string().min(1)).optional(),
  limitations: z.array(z.string().min(1)).optional(),
  beginnerRecommended: z.boolean().optional(),
  beginnerExplanation: z.string().min(1).optional(),
  defaultEnabled: z.boolean().optional(),
  estimatedComplexity: BotProfileComplexitySchema.optional(),
  playstyle: z.string().min(1).optional(),
  description: z.string().optional(),
  aggression: z.number().min(0).max(1).optional(),
  curiosity: z.number().min(0).max(1).optional(),
  riskTolerance: z.number().min(0).max(1).optional(),
  repetitionTolerance: z.number().min(0).max(1).optional(),
  bugHuntingBias: z.number().min(0).max(1).optional(),
  preferredActions: z.array(z.string().min(1)).optional(),
  avoidedActions: z.array(z.string().min(1)).optional(),
  targetScenes: z.array(z.string().min(1)).optional(),
  targetFeatures: z.array(z.string().min(1)).optional(),
  targetIssueCategories: z.array(IssueCategorySchema).optional(),
  successCriteria: z.array(z.string().min(1)).optional(),
  goals: z.array(BotGoalSchema).default([]),
  recommendedMinCount: z.number().int().min(0).default(1),
  recommendedMaxCount: z.number().int().min(1).default(1),
  defaultResourceWeight: ResourceWeightSchema.default('medium'),
  tags: z.array(z.string().min(1)).default([]),
  config: z.record(z.string(), z.unknown()).default({})
});

export const CustomBotProfileSchema = BotProfileSchema.extend({
  description: z.string().trim().min(1, 'Describe what this bot tests.'),
  profileGroup: z.literal('custom'),
  specializationCategory: BotSpecializationCategorySchema,
  requiredCapabilities: z.array(BotCapabilityIdSchema).default([]),
  recommendedGameTypes: z.array(z.string().min(1)).default([]),
  preferredActions: z.array(z.string().min(1)).default([]),
  avoidedActions: z.array(z.string().min(1)).default([]),
  targetScenes: z.array(z.string().min(1)).default([]),
  targetFeatures: z.array(z.string().min(1)).default([]),
  targetIssueCategories: z.array(IssueCategorySchema).default([]),
  successCriteria: z.array(z.string().min(1)).default([]),
  limitations: z.array(z.string().min(1)).default([]),
  defaultEnabled: z.literal(false).default(false)
}).superRefine((profile, context) => {
  if (profile.recommendedMaxCount < profile.recommendedMinCount) {
    context.addIssue({
      code: 'custom',
      path: ['recommendedMaxCount'],
      message: 'Recommended maximum count cannot be below the recommended minimum count.'
    });
  }
});

export const BotPoolConfigSchema = z
  .object({
    profileId: z.string().min(1),
    enabled: z.boolean(),
    minCount: z.number().int().min(0),
    desiredCount: z.number().int().min(0),
    maxCount: z.number().int().min(0),
    scalingMode: ScalingModeSchema,
    priority: z.number(),
    resourceWeight: ResourceWeightSchema,
    notes: z.string().optional()
  })
  .superRefine((pool, context) => {
    if (pool.minCount > pool.desiredCount) {
      context.addIssue({
        code: 'custom',
        path: ['desiredCount'],
        message: 'desiredCount must be greater than or equal to minCount.'
      });
    }

    if (pool.desiredCount > pool.maxCount) {
      context.addIssue({
        code: 'custom',
        path: ['desiredCount'],
        message: 'desiredCount must be less than or equal to maxCount.'
      });
    }

    if (pool.scalingMode === 'fixed' && pool.minCount !== pool.desiredCount) {
      context.addIssue({
        code: 'custom',
        path: ['scalingMode'],
        message: 'fixed bot pools must use the same minCount and desiredCount.'
      });
    }
  });

export const BotStatusSchema = z.enum([
  'idle',
  'queued',
  'starting',
  'running',
  'waiting',
  'blocked',
  'completed',
  'failed',
  'stopped'
]);

export const BotLaunchPlanSchema = z.object({
  botId: z.string().min(1),
  profileId: z.string().min(1),
  displayName: z.string().min(1),
  playstyle: z.string().min(1),
  assignedGameInstanceId: z.string().min(1).optional(),
  seed: z.number().int().nonnegative(),
  resourceWeight: ResourceWeightSchema,
  launchIndex: z.number().int().min(1)
});

export type ResourceWeight = z.infer<typeof ResourceWeightSchema>;
export type ScalingMode = z.infer<typeof ScalingModeSchema>;
export type BotProfileGroup = z.infer<typeof BotProfileGroupSchema>;
export type BotSpecializationCategory = z.infer<typeof BotSpecializationCategorySchema>;
export type BotProfileComplexity = z.infer<typeof BotProfileComplexitySchema>;
export type BotCapabilityId = z.infer<typeof BotCapabilityIdSchema>;
export type BotGoal = z.infer<typeof BotGoalSchema>;
export type BotProfile = z.infer<typeof BotProfileSchema>;
export type CustomBotProfile = z.infer<typeof CustomBotProfileSchema>;
export type BotPoolConfig = z.infer<typeof BotPoolConfigSchema>;
export type BotStatus = z.infer<typeof BotStatusSchema>;
export type BotLaunchPlan = z.infer<typeof BotLaunchPlanSchema>;
