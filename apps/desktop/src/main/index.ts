import { app, BrowserWindow, shell } from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerAppIpc } from './ipc/app';
import { registerResourceIpc } from './ipc/resources';
import { registerSessionIpc } from './ipc/sessions';
import { registerSimulationIpc } from './ipc/simulation';
import { registerWorkspaceIpc } from './ipc/workspace';
import { SimulationService } from './services/simulationService';
import { WorkspaceRepository } from './services/WorkspaceRepository';
import { resolveApplicationDataPaths } from './services/ApplicationPaths';
import { LegacyRunsMigrator } from './services/LegacyRunsMigrator';
import { ApplicationLogger } from './services/ApplicationLogger';
import { runBoundedShutdown } from './services/ShutdownCoordinator';
import {
  configureWebContentsSecurity,
  secureWebPreferences,
  type SecureWebContentsLike
} from './security/ElectronSecurity';

let mainWindow: BrowserWindow | null = null;
let quitAfterShutdown = false;
let simulationService: SimulationService | null = null;
let applicationLogger: ApplicationLogger | null = null;
const pendingFailures: Array<{ kind: string; error: unknown; details?: Record<string, unknown> }> = [];

function recordApplicationFailure(
  kind: string,
  error: unknown,
  details: Record<string, unknown> = {}
): void {
  if (applicationLogger) {
    try {
      applicationLogger.logFailure(kind, error, details);
    } catch (logError) {
      console.error('GameplaySimulator could not write an application failure log.', logError);
    }
    return;
  }

  pendingFailures.push({ kind, error, details });
}

process.on('uncaughtException', (error) => {
  recordApplicationFailure('uncaught_exception', error);
});

process.on('unhandledRejection', (reason) => {
  recordApplicationFailure('unhandled_rejection', reason);
});

app.on('render-process-gone', (_event, webContents, details) => {
  recordApplicationFailure('renderer_process_gone', new Error(details.reason), {
    exitCode: details.exitCode,
    reason: details.reason
  });

  if (!quitAfterShutdown && !webContents.isDestroyed()) {
    setTimeout(() => webContents.reload(), 250);
  }
});

app.on('child-process-gone', (_event, details) => {
  recordApplicationFailure('child_process_gone', new Error(details.reason), {
    type: details.type,
    name: details.name,
    exitCode: details.exitCode,
    serviceName: details.serviceName
  });
});

app.disableHardwareAcceleration();

const releaseSmokeTest = process.env.GAMEPLAY_SIMULATOR_RELEASE_SMOKE_TEST === '1';
const releaseSmokeUserData = process.env.GAMEPLAY_SIMULATOR_RELEASE_SMOKE_USER_DATA;

if (releaseSmokeTest && releaseSmokeUserData) {
  app.setPath('userData', resolve(releaseSmokeUserData));
}

function createMainWindow(): void {
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  const rendererFile = join(__dirname, '../renderer/index.html');
  const rendererEntryUrl = rendererUrl ?? pathToFileURL(rendererFile).toString();
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 920,
    minHeight: 620,
    title: 'GameplaySimulator',
    backgroundColor: '#111318',
    webPreferences: {
      ...secureWebPreferences,
      preload: join(__dirname, '../preload/index.js'),
    }
  });

  configureWebContentsSecurity(mainWindow.webContents as unknown as SecureWebContentsLike, {
    rendererEntryUrl,
    openExternal: (url) => shell.openExternal(url),
    onExternalOpenError: (error, url) => {
      recordApplicationFailure('external_navigation_failed', error, { url });
    }
  });
  mainWindow.once('closed', () => {
    mainWindow = null;
  });

  if (rendererUrl) {
    void mainWindow.loadURL(rendererUrl);
  } else {
    void mainWindow.loadFile(rendererFile);
  }
}

app.whenReady().then(() => {
  const paths = resolveApplicationDataPaths({
    userDataPath: app.getPath('userData'),
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged
  });
  mkdirSync(paths.workspaceRoot, { recursive: true });
  mkdirSync(paths.runsRoot, { recursive: true });
  mkdirSync(paths.logsRoot, { recursive: true });
  applicationLogger = new ApplicationLogger(paths.logsRoot);
  for (const failure of pendingFailures.splice(0)) {
    recordApplicationFailure(failure.kind, failure.error, failure.details);
  }

  if (app.isPackaged) {
    try {
      new LegacyRunsMigrator(paths.runsRoot, paths.legacyRunsRoots).migrateOnce();
    } catch (error) {
      applicationLogger.logFailure('legacy_runs_migration_failed', error);
    }
  }

  const service = new SimulationService({
    reportRoot: paths.runsRoot,
    openPath: releaseSmokeTest
      ? async (path) => existsSync(path) ? '' : 'The requested path does not exist.'
      : (path) => shell.openPath(path)
  });
  simulationService = service;
  const workspaceRepository = new WorkspaceRepository(paths.userDataRoot);
  registerAppIpc(applicationLogger, (path) => shell.openPath(path));
  registerSimulationIpc(service);
  registerResourceIpc(service);
  registerSessionIpc(service);
  registerWorkspaceIpc(workspaceRepository);
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('before-quit', (event) => {
  if (quitAfterShutdown) {
    return;
  }

  event.preventDefault();
  const service = simulationService;

  if (!service) {
    quitAfterShutdown = true;
    app.quit();
    return;
  }

  void runBoundedShutdown(service, {
    onFailure: (kind, error) => recordApplicationFailure(kind, error)
  }).finally(() => {
    quitAfterShutdown = true;
    app.quit();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
