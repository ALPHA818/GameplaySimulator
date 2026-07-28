import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimulationService } from '../services/simulationService';
import { registerSimulationIpc } from './simulation';

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;

const ipcHandlers = vi.hoisted(() => new Map<string, IpcHandler>());

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: IpcHandler) => {
      ipcHandlers.set(channel, handler);
    }
  }
}));

describe('simulation IPC input validation', () => {
  beforeEach(() => {
    ipcHandlers.clear();
  });

  it('rejects malformed identifiers and paths before calling the service', async () => {
    const startSession = vi.fn();
    const openEvidence = vi.fn();
    registerSimulationIpc({
      startSession,
      openEvidence
    } as unknown as SimulationService);

    expect(() =>
      ipcHandlers.get('simulation:startSession')?.({}, 'session\0escape')
    ).toThrow();
    expect(() =>
      ipcHandlers.get('simulation:openEvidence')?.(
        {},
        'session-001',
        '/tmp/evidence\0.png'
      )
    ).toThrow();

    expect(startSession).not.toHaveBeenCalled();
    expect(openEvidence).not.toHaveBeenCalled();
  });

  it('rejects malformed GitHub repository names and tokens at the IPC boundary', async () => {
    const postGitHubIssues = vi.fn();
    registerSimulationIpc({
      postGitHubIssues
    } as unknown as SimulationService);

    expect(() =>
      ipcHandlers.get('simulation:postGitHubIssues')?.({}, {
        sessionId: 'session-001',
        issueIds: ['issue-001'],
        minimumSeverity: 'error',
        minimumConfidence: 0.8,
        owner: 'game-owner',
        repo: 'game-repository',
        token: 'github_pat_valid-prefix\0unsafe'
      })
    ).toThrow();
    expect(() =>
      ipcHandlers.get('simulation:postGitHubIssues')?.({}, {
        sessionId: 'session-001',
        issueIds: ['issue-001'],
        minimumSeverity: 'error',
        minimumConfidence: 0.8,
        owner: '../outside',
        repo: 'repo name',
        token: 'github_pat_validtoken'
      })
    ).toThrow();

    expect(postGitHubIssues).not.toHaveBeenCalled();
  });
});
