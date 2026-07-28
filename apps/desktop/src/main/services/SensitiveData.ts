const sensitiveKeyPattern =
  /(authorization|cookie|credential|password|secret|token)/i;
const githubTokenPattern =
  /\b(?:gh[pousr]_[a-zA-Z0-9_]{8,}|github_pat_[a-zA-Z0-9_]{8,})\b/g;
const bearerTokenPattern = /\b(Bearer)\s+[^\s"',;]+/gi;
const sensitiveQueryValuePattern =
  /([?&](?:access_token|auth_token|github_token|token)=)[^&#\s]*/gi;

export function redactSensitiveText(value: string): string {
  return value
    .replace(githubTokenPattern, '[REDACTED]')
    .replace(bearerTokenPattern, '$1 [REDACTED]')
    .replace(sensitiveQueryValuePattern, '$1[REDACTED]');
}

export function sanitizeForLogging(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0
): unknown {
  if (depth > 12) {
    return '[TRUNCATED]';
  }

  if (typeof value === 'string') {
    return redactSensitiveText(value);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return '[CIRCULAR]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLogging(item, seen, depth + 1));
  }

  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [
      key,
      sensitiveKeyPattern.test(key)
        ? '[REDACTED]'
        : sanitizeForLogging(item, seen, depth + 1)
    ])
  );
}
