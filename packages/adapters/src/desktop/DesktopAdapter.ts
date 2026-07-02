import type { GameAdapter } from '../base/GameAdapter';

export interface DesktopAdapter extends GameAdapter {
  executablePath?: string;
  workingDirectory?: string;
}
