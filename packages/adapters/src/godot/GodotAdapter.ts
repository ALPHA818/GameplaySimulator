import type { GameAdapter } from '../base/GameAdapter';

export interface GodotAdapter extends GameAdapter {
  godotVersion?: string;
}
