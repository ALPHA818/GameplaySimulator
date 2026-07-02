import { z } from 'zod';

export const BotTypeSchema = z.enum(['explorer', 'regression', 'stress', 'scripted']);

export const BotDefinitionSchema = z.object({
  id: z.string().min(1),
  type: BotTypeSchema,
  displayName: z.string().min(1),
  description: z.string().optional()
});

export type BotType = z.infer<typeof BotTypeSchema>;
export type BotDefinition = z.infer<typeof BotDefinitionSchema>;
