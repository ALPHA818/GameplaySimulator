import { z } from 'zod';
import { AdapterTypeSchema, EngineTypeSchema, LaunchConfigSchema } from './adapter';
import { SeveritySchema } from './issue';

export const InstrumentationTransportSchema = z.enum([
  'local-http',
  'local-websocket',
  'local-file-bridge',
  'plugin-bridge'
]);

export const BrowserDomScanModeSchema = z.enum(['off', 'fallback', 'always']);

export const SaveIsolationModeSchema = z.enum([
  'none',
  'copy-directory',
  'temp-directory',
  'launch-argument-profile',
  'environment-variable',
  'adapter-managed'
]);

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

export const UIFlowMouseTargetSchema = z.object({
  selector: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  description: z.string().optional()
});

export const UIFlowStepSchema = z.object({
  stepId: z.string().min(1).optional(),
  expectedScreen: z.string().min(1).optional(),
  actionType: z.string().min(1),
  targetLabel: z.string().min(1).optional(),
  keyBinding: z.string().min(1).optional(),
  mouseTarget: z.union([z.string().min(1), UIFlowMouseTargetSchema]).optional(),
  waitAfterMs: z.number().int().min(0).optional(),
  successCondition: z.string().min(1).optional(),
  fallbackAction: z.string().min(1).optional(),
  maxRetries: z.number().int().min(0).optional()
});

export const UIFlowSchema = z.object({
  flowId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  startState: z.string().min(1).optional(),
  endState: z.string().min(1).optional(),
  steps: z.array(UIFlowStepSchema).default([])
});

export const KnownContentSchema = z.object({
  scenes: z.array(z.string().min(1)).default([]),
  levels: z.array(z.string().min(1)).default([]),
  locations: z.array(z.string().min(1)).default([]),
  characters: z.array(z.string().min(1)).default([]),
  npcs: z.array(z.string().min(1)).default([]),
  items: z.array(z.string().min(1)).default([]),
  quests: z.array(z.string().min(1)).default([]),
  mainQuests: z.array(z.string().min(1)).default([]),
  sideQuests: z.array(z.string().min(1)).default([]),
  optionalStories: z.array(z.string().min(1)).default([]),
  shops: z.array(z.string().min(1)).default([]),
  bosses: z.array(z.string().min(1)).default([]),
  menus: z.array(z.string().min(1)).default([]),
  dialogueBranches: z.array(z.string().min(1)).default([]),
  minigames: z.array(z.string().min(1)).default([]),
  endings: z.array(z.string().min(1)).default([]),
  hiddenAreas: z.array(z.string().min(1)).default([]),
  postGameContent: z.array(z.string().min(1)).default([]),
  collectibles: z.array(z.string().min(1)).default([]),
  achievements: z.array(z.string().min(1)).default([]),
  mechanics: z.array(z.string().min(1)).default([]),
  notes: z.array(z.string().min(1)).default([])
});

export const SaveIsolationConfigSchema = z.object({
  mode: SaveIsolationModeSchema.default('none'),
  sourceSavePath: z.string().min(1).optional(),
  workingSaveRoot: z.string().min(1).optional(),
  profileArgumentTemplate: z.string().min(1).optional(),
  environmentVariableName: z.string().min(1).optional(),
  cleanupTempSaves: z.boolean().default(false),
  preserveBotSaves: z.boolean().default(true)
});

const emptyKnownContent = {
  scenes: [],
  levels: [],
  locations: [],
  characters: [],
  npcs: [],
  items: [],
  quests: [],
  mainQuests: [],
  sideQuests: [],
  optionalStories: [],
  shops: [],
  bosses: [],
  menus: [],
  dialogueBranches: [],
  minigames: [],
  endings: [],
  hiddenAreas: [],
  postGameContent: [],
  collectibles: [],
  achievements: [],
  mechanics: [],
  notes: []
};

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
    supportsSaveIsolation: z.boolean(),
    instrumentationEndpoint: z.string().min(1).optional(),
    instrumentationTransport: InstrumentationTransportSchema.optional(),
    browserName: z.string().min(1).optional(),
    browserDomScanMode: BrowserDomScanModeSchema.optional()
  }),
  controls: z.array(ControlBindingSchema).default([]),
  testingTargets: z.array(TestingTargetSchema).default([]),
  progressSignals: z.array(SignalDefinitionSchema).default([]),
  failureSignals: z.array(SignalDefinitionSchema).default([]),
  uiFlows: z.array(UIFlowSchema).default([]),
  saveIsolation: SaveIsolationConfigSchema.optional(),
  knownContent: KnownContentSchema.default(emptyKnownContent)
});

export type ControlBinding = z.infer<typeof ControlBindingSchema>;
export type InstrumentationTransportType = z.infer<typeof InstrumentationTransportSchema>;
export type BrowserDomScanMode = z.infer<typeof BrowserDomScanModeSchema>;
export type SaveIsolationMode = z.infer<typeof SaveIsolationModeSchema>;
export type SaveIsolationConfig = z.infer<typeof SaveIsolationConfigSchema>;
export type TestingTarget = z.infer<typeof TestingTargetSchema>;
export type SignalDefinition = z.infer<typeof SignalDefinitionSchema>;
export type UIFlowMouseTarget = z.infer<typeof UIFlowMouseTargetSchema>;
export type UIFlowStep = z.infer<typeof UIFlowStepSchema>;
export type UIFlow = z.infer<typeof UIFlowSchema>;
export type KnownContent = z.infer<typeof KnownContentSchema>;
export type GameProfile = z.infer<typeof GameProfileSchema>;
