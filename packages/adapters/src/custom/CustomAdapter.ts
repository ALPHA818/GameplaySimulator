import type { GameAdapter } from '../base/GameAdapter';

export interface CustomAdapter extends GameAdapter {
  protocolName?: string;
}
