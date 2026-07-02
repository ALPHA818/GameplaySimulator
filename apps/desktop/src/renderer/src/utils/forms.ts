import type { ZodError } from 'zod';

export type FieldErrors = Record<string, string>;

const friendlyMessages: Record<string, string> = {
  gameId: 'Profile ID is required.',
  gameName: 'Game name is required.',
  version: 'Version is required.',
  'engine.type': 'Choose an engine type.',
  'launch.platform': 'Choose a launch platform.',
  'launch.url': 'Enter a valid URL.',
  'adapter.type': 'Choose an adapter type.',
  sessionId: 'Session ID is required.',
  gameProfilePath: 'Choose a game profile.',
  globalBotLimit: 'Global bot limit must allow the selected bot pools.',
  perGameInstanceBotLimit: 'Per-instance bot limit must be at least 1.',
  actionDelayMs: 'Action delay must be 0 or higher.',
  'resourceLimits.maxCpuPercent': 'CPU limit must be between 1 and 100.',
  'resourceLimits.maxRamPercent': 'RAM limit must be between 1 and 100.',
  'resourceLimits.maxGpuPercent': 'GPU limit must be between 1 and 100.',
  'resourceLimits.reserveRamMb': 'Reserved RAM must be 0 or higher.',
  'resourceLimits.maxGameInstances': 'Game instance limit must be at least 1.'
};

export function zodFieldErrors(error: ZodError): FieldErrors {
  return error.issues.reduce<FieldErrors>((errors, issue) => {
    const path = issue.path.join('.');
    const key = path || 'form';

    if (!errors[key]) {
      errors[key] = friendlyMessages[key] ?? issue.message;
    }

    return errors;
  }, {});
}

export function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function splitArguments(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
