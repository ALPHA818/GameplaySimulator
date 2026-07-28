export const secureWebPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false
} as const;

export const approvedExternalProtocols = new Set(['https:', 'http:', 'mailto:']);

interface NavigationEventLike {
  preventDefault(): void;
}

interface PermissionSessionLike {
  setPermissionRequestHandler(
    handler: (
      webContents: unknown,
      permission: string,
      callback: (allowed: boolean) => void,
      details: unknown
    ) => void
  ): void;
  setPermissionCheckHandler(
    handler: (
      webContents: unknown,
      permission: string,
      requestingOrigin: string,
      details: unknown
    ) => boolean
  ): void;
}

export interface SecureWebContentsLike {
  session: PermissionSessionLike;
  setWindowOpenHandler(
    handler: (details: { url: string }) => { action: 'allow' | 'deny' }
  ): void;
  on(
    event: 'will-navigate' | 'will-redirect',
    listener: (event: NavigationEventLike, url: string) => void
  ): void;
}

export interface WebContentsSecurityOptions {
  rendererEntryUrl: string;
  openExternal: (url: string) => Promise<unknown>;
  onExternalOpenError?: (error: unknown, url: string) => void;
}

function parsedUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function isApprovedExternalUrl(value: string): boolean {
  const url = parsedUrl(value);
  return Boolean(url && approvedExternalProtocols.has(url.protocol));
}

export function isTrustedRendererNavigation(value: string, rendererEntryUrl: string): boolean {
  const candidate = parsedUrl(value);
  const renderer = parsedUrl(rendererEntryUrl);

  if (!candidate || !renderer || candidate.protocol !== renderer.protocol) {
    return false;
  }

  if (renderer.protocol === 'file:') {
    return candidate.pathname === renderer.pathname;
  }

  return candidate.origin === renderer.origin;
}

export function configureWebContentsSecurity(
  webContents: SecureWebContentsLike,
  options: WebContentsSecurityOptions
): void {
  const openApprovedExternalUrl = (url: string): void => {
    if (!isApprovedExternalUrl(url)) {
      return;
    }

    void options.openExternal(url).catch((error) => {
      options.onExternalOpenError?.(error, url);
    });
  };

  webContents.setWindowOpenHandler(({ url }) => {
    if (!isTrustedRendererNavigation(url, options.rendererEntryUrl)) {
      openApprovedExternalUrl(url);
    }

    return { action: 'deny' };
  });

  const handleNavigation = (event: NavigationEventLike, url: string): void => {
    if (isTrustedRendererNavigation(url, options.rendererEntryUrl)) {
      return;
    }

    event.preventDefault();
    openApprovedExternalUrl(url);
  };

  webContents.on('will-navigate', handleNavigation);
  webContents.on('will-redirect', handleNavigation);
  webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  webContents.session.setPermissionCheckHandler(() => false);
}
