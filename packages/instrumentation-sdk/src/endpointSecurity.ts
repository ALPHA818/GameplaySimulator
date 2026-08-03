const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function parseLoopbackInstrumentationEndpoint(endpoint: string): URL {
  let url: URL;

  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('Instrumentation endpoint must be a valid loopback HTTP URL.');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Instrumentation endpoint must use HTTP or HTTPS.');
  }

  if (url.username || url.password) {
    throw new Error('Instrumentation endpoint must not include a username or password.');
  }

  if (!LOOPBACK_HOSTNAMES.has(url.hostname.toLowerCase())) {
    throw new Error(
      'Instrumentation endpoint must use 127.0.0.1, localhost, or ::1. Remote endpoints are unavailable in this release.'
    );
  }

  return url;
}

export function isLoopbackInstrumentationEndpoint(endpoint: string | undefined): boolean {
  if (!endpoint) {
    return false;
  }

  try {
    parseLoopbackInstrumentationEndpoint(endpoint);
    return true;
  } catch {
    return false;
  }
}
