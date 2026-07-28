import { z } from 'zod';

export const IpcIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine((value) => !/[\0-\x1f\x7f]/.test(value), 'Identifier contains control characters.');

export const IpcPathSchema = z
  .string()
  .min(1)
  .max(32_768)
  .refine((value) => !value.includes('\0'), 'Path contains a null character.');

export const OptionalIpcIdentifierSchema = IpcIdentifierSchema.optional();

export const RendererErrorDetailsSchema = z
  .object({
    kind: z.string().trim().min(1).max(200).optional(),
    name: z.string().trim().min(1).max(500).optional(),
    message: z.string().max(20_000).optional(),
    stack: z.string().max(100_000).optional(),
    componentStack: z.string().max(100_000).optional()
  })
  .strict();
