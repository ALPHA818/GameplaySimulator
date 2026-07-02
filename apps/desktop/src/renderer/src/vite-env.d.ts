/// <reference types="vite/client" />

import type { GameProfile, RuntimeViabilityReport, SimulationRunConfig } from '@core/types';

declare global {
  interface Window {
    gameplaySimulator: {
      app: {
        getVersion: () => Promise<string>;
      };
      sessions: {
        getStatus: () => Promise<{
          status: string;
          label: string;
          activeSessionId: string | null;
        }>;
      };
      resources: {
        estimateViability: (payload: {
          runConfig: SimulationRunConfig;
          gameProfile: GameProfile;
        }) => Promise<RuntimeViabilityReport>;
      };
    };
  }
}
