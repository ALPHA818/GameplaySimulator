export interface SimulatorEngine {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export class PlaceholderSimulatorEngine implements SimulatorEngine {
  async start(): Promise<void> {
    throw new Error('Simulator engine is not implemented yet.');
  }

  async stop(): Promise<void> {
    throw new Error('Simulator engine is not implemented yet.');
  }
}
