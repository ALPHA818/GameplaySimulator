import { z } from 'zod';

export const SessionLabelSchema = z.enum([
  'Smoke Test',
  'Regression',
  'UI Flow',
  'Stress Test',
  'Custom'
]);

export const SessionBundlePathsSchema = z.object({
  sessionDirectory: z.string().min(1),
  metadataJson: z.string().min(1),
  summaryJson: z.string().min(1),
  summaryMarkdown: z.string().min(1),
  importantEventsJsonl: z.string().min(1),
  fullStructuredLogsJsonl: z.string().min(1),
  issuesJson: z.string().min(1),
  issueTimelineJson: z.string().min(1),
  screenshotsDirectory: z.string().min(1),
  reportsDirectory: z.string().min(1),
  exportsDirectory: z.string().min(1),
  replayDirectory: z.string().min(1)
});

export const SessionBundleCountsSchema = z.object({
  totalLogs: z.number().int().min(0),
  importantEvents: z.number().int().min(0),
  issues: z.number().int().min(0),
  bots: z.number().int().min(0),
  instances: z.number().int().min(0),
  screenshots: z.number().int().min(0)
});

export const SessionBundleSchema = z.object({
  schemaVersion: z.literal(1),
  sessionId: z.string().min(1),
  label: SessionLabelSchema.default('Custom'),
  gameName: z.string().min(1),
  gameId: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  buildId: z.string().min(1).optional(),
  adapterType: z.string().min(1).optional(),
  status: z.string().min(1),
  createdAt: z.string().min(1),
  startedAt: z.string().min(1).optional(),
  stoppedAt: z.string().min(1).optional(),
  generatedAt: z.string().min(1),
  paths: SessionBundlePathsSchema,
  counts: SessionBundleCountsSchema
});

export type SessionLabel = z.infer<typeof SessionLabelSchema>;
export type SessionBundlePaths = z.infer<typeof SessionBundlePathsSchema>;
export type SessionBundleCounts = z.infer<typeof SessionBundleCountsSchema>;
export type SessionBundle = z.infer<typeof SessionBundleSchema>;
