import { z } from 'zod';

export const InstrumentationProtocolVersion = '0.1.0';

export const InstrumentationTransportSchema = z.enum([
  'local-http',
  'local-websocket',
  'local-file-bridge',
  'plugin-bridge'
]);

export const InstrumentationHealthSchema = z.object({
  ok: z.boolean(),
  gameId: z.string().min(1).optional(),
  gameName: z.string().min(1).optional(),
  instanceId: z.string().min(1).optional(),
  protocolVersion: z.string().min(1).default(InstrumentationProtocolVersion),
  engine: z
    .object({
      type: z.string().min(1),
      version: z.string().min(1).optional()
    })
    .optional(),
  capabilities: z
    .object({
      stateRead: z.boolean().default(true),
      directActions: z.boolean().default(true),
      events: z.boolean().default(true),
      logs: z.boolean().default(true)
    })
    .default({
      stateRead: true,
      directActions: true,
      events: true,
      logs: true
    }),
  message: z.string().optional()
});

export const PlayerPositionSchema = z.object({
  playerId: z.string().min(1).default('player'),
  mapId: z.string().min(1).optional(),
  sceneId: z.string().min(1).optional(),
  x: z.number(),
  y: z.number(),
  z: z.number().optional(),
  rotation: z.number().optional()
});

export const VisibleUIControlSchema = z.object({
  label: z.string().min(1),
  selector: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  disabled: z.boolean().default(false),
  x: z.number().optional(),
  y: z.number().optional()
});

export const UIStateSchema = z.object({
  screenId: z.string().min(1).optional(),
  currentScreen: z.string().min(1).optional(),
  focusedElementId: z.string().min(1).optional(),
  focusedElement: z.string().min(1).optional(),
  openMenus: z.array(z.string().min(1)).default([]),
  visibleButtons: z.array(VisibleUIControlSchema).default([]),
  modalStack: z.array(z.string().min(1)).default([]),
  canStartGame: z.boolean().default(false),
  isInGameplay: z.boolean().default(false),
  isPaused: z.boolean().default(false),
  isLoading: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const PerformanceDataSchema = z.object({
  fps: z.number().min(0).optional(),
  frameTimeMs: z.number().min(0).optional(),
  cpuMs: z.number().min(0).optional(),
  gpuMs: z.number().min(0).optional(),
  memoryMb: z.number().min(0).optional(),
  drawCalls: z.number().int().min(0).optional(),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const InventoryItemSchema = z.object({
  itemId: z.string().min(1),
  name: z.string().min(1).optional(),
  quantity: z.number().min(0).default(1),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const QuestStateSchema = z.object({
  questId: z.string().min(1),
  name: z.string().min(1).optional(),
  status: z.enum(['unknown', 'not_started', 'active', 'completed', 'failed']).default('unknown'),
  stepId: z.string().min(1).optional(),
  objectives: z.array(z.string().min(1)).default([]),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const InstrumentedGameStateSchema = z.object({
  gameId: z.string().min(1),
  instanceId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  scene: z.string().optional(),
  tick: z.number().int().min(0).optional(),
  timestamp: z.string().min(1),
  playerPosition: PlayerPositionSchema.optional(),
  uiState: UIStateSchema.optional(),
  performance: PerformanceDataSchema.optional(),
  inventory: z.array(InventoryItemSchema).default([]),
  quests: z.array(QuestStateSchema).default([]),
  state: z.record(z.string(), z.unknown()).default({}),
  logs: z.array(z.string()).default([])
});

export const InstrumentedActionSchema = z.object({
  actionType: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  payloadSchema: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const PerformActionRequestSchema = z.object({
  requestId: z.string().min(1),
  instanceId: z.string().min(1),
  botId: z.string().min(1),
  actionType: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
  timeoutMs: z.number().int().positive().optional()
});

export const PerformActionResponseSchema = z.object({
  requestId: z.string().min(1),
  status: z.enum(['succeeded', 'failed', 'skipped', 'timed_out']),
  message: z.string().optional(),
  state: InstrumentedGameStateSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const InstrumentationEventKindSchema = z.enum([
  'game.event',
  'game.warning',
  'game.error',
  'content.coverage',
  'quest.update',
  'inventory.update',
  'player.position',
  'ui.state',
  'performance.data'
]);

export const InstrumentationEventSchema = z.object({
  eventId: z.string().min(1),
  kind: InstrumentationEventKindSchema,
  instanceId: z.string().min(1),
  timestamp: z.string().min(1),
  severity: z.enum(['info', 'warning', 'error', 'critical']).default('info'),
  name: z.string().min(1),
  message: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).default({})
});

export const InstrumentationEnvelopeSchema = z.object({
  protocolVersion: z.string().min(1).default(InstrumentationProtocolVersion),
  requestId: z.string().min(1).optional(),
  type: z.string().min(1),
  timestamp: z.string().min(1),
  payload: z.unknown()
});

export type InstrumentationTransport = z.infer<typeof InstrumentationTransportSchema>;
export type InstrumentationHealth = z.infer<typeof InstrumentationHealthSchema>;
export type PlayerPosition = z.infer<typeof PlayerPositionSchema>;
export type UIState = z.infer<typeof UIStateSchema>;
export type PerformanceData = z.infer<typeof PerformanceDataSchema>;
export type InventoryItem = z.infer<typeof InventoryItemSchema>;
export type QuestState = z.infer<typeof QuestStateSchema>;
export type InstrumentedGameState = z.infer<typeof InstrumentedGameStateSchema>;
export type InstrumentedAction = z.infer<typeof InstrumentedActionSchema>;
export type PerformActionRequest = z.infer<typeof PerformActionRequestSchema>;
export type PerformActionResponse = z.infer<typeof PerformActionResponseSchema>;
export type InstrumentationEventKind = z.infer<typeof InstrumentationEventKindSchema>;
export type InstrumentationEvent = z.infer<typeof InstrumentationEventSchema>;
export type InstrumentationEnvelope = z.infer<typeof InstrumentationEnvelopeSchema>;
