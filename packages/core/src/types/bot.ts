import { z } from 'zod';
import { IssueCategorySchema } from './issue';

export const ResourceWeightSchema = z.enum(['light', 'medium', 'heavy', 'very_heavy']);

export const ScalingModeSchema = z.enum(['fixed', 'auto']);

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
  description: z.string().optional(),
  goals: z.array(BotGoalSchema).default([]),
  recommendedMinCount: z.number().int().min(0).default(1),
  recommendedMaxCount: z.number().int().min(1).default(1),
  defaultResourceWeight: ResourceWeightSchema.default('medium'),
  tags: z.array(z.string().min(1)).default([]),
  config: z.record(z.string(), z.unknown()).default({})
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
export type BotGoal = z.infer<typeof BotGoalSchema>;
export type BotProfile = z.infer<typeof BotProfileSchema>;
export type BotPoolConfig = z.infer<typeof BotPoolConfigSchema>;
export type BotStatus = z.infer<typeof BotStatusSchema>;
export type BotLaunchPlan = z.infer<typeof BotLaunchPlanSchema>;
