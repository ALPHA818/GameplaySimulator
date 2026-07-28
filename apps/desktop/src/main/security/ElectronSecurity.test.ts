import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  configureWebContentsSecurity,
  isApprovedExternalUrl,
  isTrustedRendererNavigation,
  secureWebPreferences,
  type SecureWebContentsLike
} from './ElectronSecurity';

class FakeSecureWebContents implements SecureWebContentsLike {
  windowOpenHandler?: (details: { url: string }) => { action: 'allow' | 'deny' };
  readonly listeners = new Map<string, (event: { preventDefault(): void }, url: string) => void>();
  permissionRequestHandler?: (
    webContents: unknown,
    permission: string,
    callback: (allowed: boolean) => void,
    details: unknown
  ) => void;
  permissionCheckHandler?: (
    webContents: unknown,
    permission: string,
    requestingOrigin: string,
    details: unknown
  ) => boolean;
  readonly session = {
    setPermissionRequestHandler: (
      handler: (
        webContents: unknown,
        permission: string,
        callback: (allowed: boolean) => void,
        details: unknown
      ) => void
    ) => {
      this.permissionRequestHandler = handler;
    },
    setPermissionCheckHandler: (
      handler: (
        webContents: unknown,
        permission: string,
        requestingOrigin: string,
        details: unknown
      ) => boolean
    ) => {
      this.permissionCheckHandler = handler;
    }
  };

  setWindowOpenHandler(
    handler: (details: { url: string }) => { action: 'allow' | 'deny' }
  ): void {
    this.windowOpenHandler = handler;
  }

  on(
    event: 'will-navigate' | 'will-redirect',
    listener: (event: { preventDefault(): void }, url: string) => void
  ): void {
    this.listeners.set(event, listener);
  }
}

describe('Electron renderer security', () => {
  it('keeps renderer isolation, disables Node access, and enables the sandbox', () => {
    expect(secureWebPreferences).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false
    });
  });

  it('approves only explicit external protocols', () => {
    expect(isApprovedExternalUrl('https://example.com/report')).toBe(true);
    expect(isApprovedExternalUrl('http://127.0.0.1:4317/help')).toBe(true);
    expect(isApprovedExternalUrl('mailto:qa@example.com')).toBe(true);
    expect(isApprovedExternalUrl('file:///tmp/private.txt')).toBe(false);
    expect(isApprovedExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isApprovedExternalUrl('data:text/html,unsafe')).toBe(false);
    expect(isApprovedExternalUrl('custom-protocol://unsafe')).toBe(false);
  });

  it('ships a restrictive renderer content security policy', () => {
    const html = readFileSync(
      resolve(process.cwd(), 'apps/desktop/src/renderer/index.html'),
      'utf8'
    );

    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain("default-src 'self'");
    expect(html).toContain("object-src 'none'");
    expect(html).toContain("frame-ancestors 'none'");
    expect(html).toContain("script-src 'self'");
    expect(html).not.toContain("script-src 'unsafe-inline'");
  });

  it('allows only the renderer entry origin or file and denies permissions', async () => {
    const webContents = new FakeSecureWebContents();
    const openExternal = vi.fn(async () => undefined);
    const entryUrl = 'file:///opt/gameplay-simulator/renderer/index.html';
    configureWebContentsSecurity(webContents, {
      rendererEntryUrl: entryUrl,
      openExternal
    });

    expect(isTrustedRendererNavigation(`${entryUrl}#reports`, entryUrl)).toBe(true);
    expect(isTrustedRendererNavigation('file:///tmp/other.html', entryUrl)).toBe(false);
    expect(webContents.windowOpenHandler?.({ url: 'javascript:alert(1)' })).toEqual({
      action: 'deny'
    });
    expect(webContents.windowOpenHandler?.({ url: 'https://example.com/docs' })).toEqual({
      action: 'deny'
    });
    await Promise.resolve();
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith('https://example.com/docs');

    const preventDefault = vi.fn();
    webContents.listeners.get('will-navigate')?.(
      { preventDefault },
      'file:///tmp/secret.txt'
    );
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(openExternal).toHaveBeenCalledTimes(1);

    let permissionAllowed: boolean | undefined;
    webContents.permissionRequestHandler?.(
      {},
      'media',
      (allowed) => {
        permissionAllowed = allowed;
      },
      {}
    );
    expect(permissionAllowed).toBe(false);
    expect(webContents.permissionCheckHandler?.({}, 'geolocation', entryUrl, {})).toBe(false);
  });
});
