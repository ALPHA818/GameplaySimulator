import { describe, expect, it } from 'vitest';
import {
  isLoopbackInstrumentationEndpoint,
  parseLoopbackInstrumentationEndpoint
} from './endpointSecurity';

describe('instrumentation endpoint security', () => {
  it.each([
    'http://127.0.0.1:4317',
    'http://localhost:4317',
    'http://[::1]:4317'
  ])('accepts loopback endpoint %s', (endpoint) => {
    expect(parseLoopbackInstrumentationEndpoint(endpoint).port).toBe('4317');
    expect(isLoopbackInstrumentationEndpoint(endpoint)).toBe(true);
  });

  it.each([
    'https://example.com/gsi',
    'http://192.168.1.10:4317',
    'http://localhost.example.com:4317',
    'http://localhost@evil.example:4317',
    'file:///tmp/instrumentation.sock'
  ])('rejects non-loopback endpoint %s', (endpoint) => {
    expect(() => parseLoopbackInstrumentationEndpoint(endpoint)).toThrow();
    expect(isLoopbackInstrumentationEndpoint(endpoint)).toBe(false);
  });
});
