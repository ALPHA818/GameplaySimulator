import { z } from 'zod';

export const AdapterTypeSchema = z.enum([
  'instrumented',
  'desktop',
  'browser',
  'unity',
  'godot',
  'unreal',
  'rpg_maker',
  'gamemaker',
  'custom'
]);

export const EngineTypeSchema = z.enum(['unity', 'godot', 'unreal', 'browser', 'custom', 'unknown']);

export const LaunchPlatformSchema = z.enum(['windows', 'linux', 'mac', 'browser']);

export const LaunchConfigSchema = z.object({
  executablePath: z.string().min(1).optional(),
  workingDirectory: z.string().min(1).optional(),
  arguments: z.array(z.string()).default([]),
  url: z.string().url().optional(),
  platform: LaunchPlatformSchema
});

export type AdapterType = z.infer<typeof AdapterTypeSchema>;
export type EngineType = z.infer<typeof EngineTypeSchema>;
export type LaunchPlatform = z.infer<typeof LaunchPlatformSchema>;
export type LaunchConfig = z.infer<typeof LaunchConfigSchema>;
