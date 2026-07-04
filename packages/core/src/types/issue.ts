import { z } from 'zod';

export const SeveritySchema = z.enum(['info', 'warning', 'error', 'critical']);

export const IssueCategorySchema = z.enum([
  'crash',
  'hang',
  'visual',
  'audio',
  'input',
  'navigation',
  'gameplay',
  'performance',
  'progression',
  'save_load',
  'network',
  'accessibility',
  'content',
  'ui',
  'quest',
  'inventory',
  'economy',
  'combat',
  'world_boundary',
  'dialogue',
  'softlock',
  'exploit',
  'unknown'
]);

export const DetectedIssueSchema = z.object({
  id: z.string().min(1).optional(),
  issueId: z.string().min(1),
  timestamp: z.string().min(1).optional(),
  sessionId: z.string().min(1),
  instanceId: z.string().min(1).optional(),
  gameInstanceId: z.string().min(1).optional(),
  botId: z.string().min(1).optional(),
  severity: SeveritySchema,
  category: IssueCategorySchema,
  title: z.string().min(1),
  description: z.string().optional(),
  scene: z.string().optional(),
  area: z.string().optional(),
  lastActions: z.array(z.string().min(1)).default([]),
  stateSummary: z.string().optional(),
  expectedBehavior: z.string().optional(),
  actualBehavior: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  screenshotPath: z.string().optional(),
  videoPath: z.string().optional(),
  rawEvidence: z.unknown().optional(),
  evidencePaths: z.array(z.string()).default([]),
  actionTimelineIds: z.array(z.string()).default([]),
  firstSeenAt: z.string().min(1),
  lastSeenAt: z.string().min(1).optional(),
  reproducible: z.boolean().optional()
});

export type Severity = z.infer<typeof SeveritySchema>;
export type IssueCategory = z.infer<typeof IssueCategorySchema>;
export type DetectedIssue = z.infer<typeof DetectedIssueSchema>;
