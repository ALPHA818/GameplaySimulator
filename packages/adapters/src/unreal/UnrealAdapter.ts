import type { GameAdapter } from '../base/GameAdapter';

export interface UnrealAdapter extends GameAdapter {
  unrealVersion?: string;
}
