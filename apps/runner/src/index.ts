export interface RunnerHealth {
  status: 'idle';
  message: string;
}

export function getRunnerHealth(): RunnerHealth {
  return {
    status: 'idle',
    message: 'Runner package is available. Simulation logic is not implemented yet.'
  };
}

export async function startRunner(): Promise<RunnerHealth> {
  return getRunnerHealth();
}
