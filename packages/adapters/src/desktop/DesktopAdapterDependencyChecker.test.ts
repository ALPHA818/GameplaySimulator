import { describe, expect, it } from 'vitest';
import { DesktopAdapterDependencyChecker } from './DesktopAdapterDependencyChecker';

function checker(platform: NodeJS.Platform, availableCommands: string[]) {
  const available = new Set(availableCommands);
  return new DesktopAdapterDependencyChecker({
    platform,
    commandExists: async (command) => available.has(command)
  });
}

describe('DesktopAdapterDependencyChecker', () => {
  it('detects Linux desktop input and screenshot tools', async () => {
    const report = await checker('linux', ['xdotool', 'scrot']).checkDependencies();

    expect(report.canSendKeyboardInput).toBe(true);
    expect(report.canFocusWindow).toBe(true);
    expect(report.screenshotTool).toBe('scrot');
    expect(report.screenshotScope).toBe('full-desktop');
    expect(report.canCaptureGameWindow).toBe(false);
    expect(report.canCaptureFullDesktop).toBe(true);
    expect(report.warnings).toHaveLength(0);
  });

  it('reports game-window capture only when Linux can identify and capture that window', async () => {
    const report = await checker('linux', ['xdotool', 'import', 'scrot']).checkDependencies();

    expect(report.screenshotTool).toBe('import');
    expect(report.screenshotScope).toBe('game-window');
    expect(report.canCaptureGameWindow).toBe(true);
    expect(report.canCaptureFullDesktop).toBe(true);
  });

  it('warns when Linux input and screenshot dependencies are missing', async () => {
    const report = await checker('linux', []).checkDependencies();

    expect(report.canSendKeyboardInput).toBe(false);
    expect(report.canCaptureScreenshots).toBe(false);
    expect(report.warnings).toContain('Desktop input driver missing');
    expect(report.warnings).toContain('Screenshot tool missing');
    expect(report.warnings).toContain('Install xdotool to enable Linux desktop input');
  });

  it('marks macOS input as limited until implemented', async () => {
    const report = await checker('darwin', ['osascript', 'screencapture']).checkDependencies();

    expect(report.canFocusWindow).toBe(true);
    expect(report.canCaptureScreenshots).toBe(true);
    expect(report.screenshotScope).toBe('full-desktop');
    expect(report.canSendKeyboardInput).toBe(false);
    expect(report.warnings).toContain('This platform can launch games but cannot send input yet');
  });

  it('marks Windows process launch as available and input as not implemented', async () => {
    const report = await checker('win32', []).checkDependencies();

    expect(report.canLaunchProcesses).toBe(true);
    expect(report.canCheckProcessHealth).toBe(true);
    expect(report.canSendMouseInput).toBe(false);
    expect(report.warnings).toContain('This platform can launch games but cannot send input yet');
  });
});
