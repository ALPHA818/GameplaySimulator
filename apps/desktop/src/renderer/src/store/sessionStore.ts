import { create } from 'zustand';

type SessionRuntimeStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';

interface SessionState {
  status: SessionRuntimeStatus;
  statusLabel: string;
  activeSessionId: string | null;
  setSessionPreview: (label: string) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  status: 'idle',
  statusLabel: 'No session running',
  activeSessionId: null,
  setSessionPreview: (statusLabel) => set({ statusLabel })
}));
