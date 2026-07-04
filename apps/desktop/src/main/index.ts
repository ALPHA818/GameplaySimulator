import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { registerAppIpc } from './ipc/app';
import { registerResourceIpc } from './ipc/resources';
import { registerSessionIpc } from './ipc/sessions';
import { registerSimulationIpc } from './ipc/simulation';
import { SimulationService } from './services/simulationService';

let mainWindow: BrowserWindow | null = null;
const simulationService = new SimulationService({
  openPath: (path) => shell.openPath(path)
});

app.disableHardwareAcceleration();

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 920,
    minHeight: 620,
    title: 'GameplaySimulator',
    backgroundColor: '#111318',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;

  if (rendererUrl) {
    void mainWindow.loadURL(rendererUrl);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  registerAppIpc();
  registerSimulationIpc(simulationService);
  registerResourceIpc(simulationService);
  registerSessionIpc(simulationService);
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
