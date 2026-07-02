import type { GameAdapter } from '../base/GameAdapter';

export interface UnityAdapter extends GameAdapter {
  unityVersion?: string;
}
