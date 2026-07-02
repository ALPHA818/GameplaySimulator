import type { GameAdapter } from '../base/GameAdapter';

export interface BrowserAdapter extends GameAdapter {
  browserName?: string;
  targetUrl?: string;
}
