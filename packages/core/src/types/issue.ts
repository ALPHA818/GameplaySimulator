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
  'unknown'
]);

export const DetectedIssueSchema = z.object({
  issueId: z.string().min(1),
  sessionId: z.string().min(1),
  gameInstanceId: z.string().min(1).optional(),
  botId: z.string().min(1).optional(),
  severity: SeveritySchema,
  category: IssueCategorySchema,
  title: z.string().min(1),
  description: z.string().optional(),
  evidencePaths: z.array(z.string()).default([]),
  actionTimelineIds: z.array(z.string()).default([]),
  firstSeenAt: z.string().min(1),
  lastSeenAt: z.string().min(1).optional(),
  reproducible: z.boolean().optional()
});

export type Severity = z.infer<typeof SeveritySchema>;
export type IssueCategory = z.infer<typeof IssueCategorySchema>;
export type DetectedIssue = z.infer<typeof DetectedIssueSchema>;
