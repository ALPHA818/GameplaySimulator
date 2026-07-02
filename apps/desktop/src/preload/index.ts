import { contextBridge, ipcRenderer } from 'electron';
import type { GameProfile, RuntimeViabilityReport, SimulationRunConfig } from '@core/types';

const api = {
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion') as Promise<string>
  },
  sessions: {
    getStatus: () =>
      ipcRenderer.invoke('sessions:getStatus') as Promise<{
        status: string;
        label: string;
        activeSessionId: string | null;
      }>
  },
  resources: {
    estimateViability: (payload: { runConfig: SimulationRunConfig; gameProfile: GameProfile }) =>
      ipcRenderer.invoke('resources:estimateViability', payload) as Promise<RuntimeViabilityReport>
  }
};

contextBridge.exposeInMainWorld('gameplaySimulator', api);

export type GameplaySimulatorApi = typeof api;
