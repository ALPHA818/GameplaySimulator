export type SessionRuntimeStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';

export interface SessionStatusSnapshot {
  status: SessionRuntimeStatus;
  label: string;
  activeSessionId: string | null;
}

export interface SessionService {
  getStatus(): SessionStatusSnapshot;
}

export const sessionService: SessionService = {
  getStatus() {
    return {
      status: 'idle',
      label: 'No session running',
      activeSessionId: null
    };
  }
};
