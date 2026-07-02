import { z } from 'zod';
import { AdapterTypeSchema, EngineTypeSchema, LaunchConfigSchema } from './adapter';
import { SeveritySchema } from './issue';

export const ControlBindingSchema = z.object({
  controlId: z.string().min(1),
  label: z.string().min(1),
  inputType: z.enum(['keyboard', 'mouse', 'gamepad', 'touch', 'api', 'custom']),
  binding: z.string().optional(),
  action: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const TestingTargetSchema = z.object({
  targetId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  priority: z.number().default(0),
  tags: z.array(z.string().min(1)).default([])
});

export const SignalDefinitionSchema = z.object({
  signalId: z.string().min(1),
  name: z.string().min(1),
  source: z.enum(['state', 'visual', 'audio', 'log', 'telemetry', 'input', 'custom']),
  description: z.string().optional(),
  severity: SeveritySchema.optional(),
  pattern: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const KnownContentSchema = z.object({
  locations: z.array(z.string().min(1)).default([]),
  characters: z.array(z.string().min(1)).default([]),
  items: z.array(z.string().min(1)).default([]),
  quests: z.array(z.string().min(1)).default([]),
  mechanics: z.array(z.string().min(1)).default([]),
  notes: z.array(z.string().min(1)).default([])
});

export const GameProfileSchema = z.object({
  gameId: z.string().min(1),
  gameName: z.string().min(1),
  version: z.string().min(1),
  buildId: z.string().min(1).optional(),
  engine: z.object({
    type: EngineTypeSchema,
    version: z.string().min(1).optional()
  }),
  launch: LaunchConfigSchema,
  adapter: z.object({
    type: AdapterTypeSchema,
    supportsMultipleInstances: z.boolean(),
    supportsStateRead: z.boolean(),
    supportsDirectActions: z.boolean(),
    supportsScreenshots: z.boolean(),
    supportsVideo: z.boolean(),
    supportsSaveIsolation: z.boolean()
  }),
  controls: z.array(ControlBindingSchema).default([]),
  testingTargets: z.array(TestingTargetSchema).default([]),
  progressSignals: z.array(SignalDefinitionSchema).default([]),
  failureSignals: z.array(SignalDefinitionSchema).default([]),
  knownContent: KnownContentSchema.default({
    locations: [],
    characters: [],
    items: [],
    quests: [],
    mechanics: [],
    notes: []
  })
});

export type ControlBinding = z.infer<typeof ControlBindingSchema>;
export type TestingTarget = z.infer<typeof TestingTargetSchema>;
export type SignalDefinition = z.infer<typeof SignalDefinitionSchema>;
export type KnownContent = z.infer<typeof KnownContentSchema>;
export type GameProfile = z.infer<typeof GameProfileSchema>;
