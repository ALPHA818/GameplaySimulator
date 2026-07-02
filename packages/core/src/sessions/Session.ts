import type { SessionStatus } from '../types/runtime';

export interface Session {
  id: string;
  name: string;
  gameProfileId: string;
  status: SessionStatus;
  createdAt: string;
  startedAt?: string;
  stoppedAt?: string;
}
