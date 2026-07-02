import type { GameAdapter } from '../base/GameAdapter';

export interface InstrumentedAdapter extends GameAdapter {
  instrumentationEndpoint?: string;
}
