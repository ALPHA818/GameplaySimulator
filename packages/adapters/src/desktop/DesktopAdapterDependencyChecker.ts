import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type DesktopDependencyStatus = 'available' | 'missing' | 'limited' | 'not_implemented';

export interface DesktopDependencyCheck {
  id: string;
  label: string;
  status: DesktopDependencyStatus;
  message: string;
  installHint?: string;
  command?: string;
}

export interface DesktopAdapterDependencyReport {
  platform: NodeJS.Platform;
  canLaunchProcesses: boolean;
  canCheckProcessHealth: boolean;
  canFocusWindow: boolean;
  canSendKeyboardInput: boolean;
  canSendMouseInput: boolean;
  canCaptureScreenshots: boolean;
  inputDriverAvailable: boolean;
  screenshotToolAvailable: boolean;
  focusToolAvailable: boolean;
  screenshotTool?: string;
  checks: DesktopDependencyCheck[];
  warnings: string[];
}

export interface DesktopAdapterDependencyCheckerOptions {
  platform?: NodeJS.Platform;
  commandExists?: (command: string) => Promise<boolean>;
}

async function defaultCommandExists(command: string): Promise<boolean> {
  const lookupCommand = process.platform === 'win32' ? 'where' : 'which';
  const args = [command];

  try {
    await execFileAsync(lookupCommand, args);
    return true;
  } catch {
    return false;
  }
}

function check(
  id: string,
  label: string,
  status: DesktopDependencyStatus,
  message: string,
  installHint?: string,
  command?: string
): DesktopDependencyCheck {
  return {
    id,
    label,
    status,
    message,
    installHint,
    command
  };
}

function warningsFor(checks: DesktopDependencyCheck[]): string[] {
  const warnings: string[] = [];

  if (checks.some((item) => item.id === 'input-driver' && item.status !== 'available')) {
    warnings.push('Desktop input driver missing');
  }

  if (checks.some((item) => item.id === 'screenshot-tool' && item.status !== 'available')) {
    warnings.push('Screenshot tool missing');
  }

  if (checks.some((item) => item.id === 'platform-input' && item.status === 'not_implemented')) {
    warnings.push('This platform can launch games but cannot send input yet');
  }

  if (checks.some((item) => item.command === 'xdotool' && item.status === 'missing')) {
    warnings.push('Install xdotool to enable Linux desktop input');
  }

  return warnings;
}

export class DesktopAdapterDependencyChecker {
  private readonly platform: NodeJS.Platform;
  private readonly commandExists: (command: string) => Promise<boolean>;

  constructor(options: DesktopAdapterDependencyCheckerOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.commandExists = options.commandExists ?? defaultCommandExists;
  }

  async checkDependencies(): Promise<DesktopAdapterDependencyReport> {
    if (this.platform === 'linux') {
      return this.checkLinux();
    }

    if (this.platform === 'darwin') {
      return this.checkMac();
    }

    if (this.platform === 'win32') {
      return this.checkWindows();
    }

    const checks = [
      check(
        'platform-input',
        'Desktop input driver',
        'not_implemented',
        `Desktop input is not implemented for ${this.platform}.`
      ),
      check(
        'screenshot-tool',
        'Screenshot tool',
        'not_implemented',
        `Screenshot capture is not implemented for ${this.platform}.`
      )
    ];

    return {
      platform: this.platform,
      canLaunchProcesses: true,
      canCheckProcessHealth: true,
      canFocusWindow: false,
      canSendKeyboardInput: false,
      canSendMouseInput: false,
      canCaptureScreenshots: false,
      inputDriverAvailable: false,
      screenshotToolAvailable: false,
      focusToolAvailable: false,
      checks,
      warnings: warningsFor(checks)
    };
  }

  private async checkLinux(): Promise<DesktopAdapterDependencyReport> {
    const hasXdotool = await this.commandExists('xdotool');
    const screenshotTools = ['gnome-screenshot', 'scrot', 'import'];
    const screenshotTool = await this.firstAvailable(screenshotTools);
    const checks = [
      check(
        'input-driver',
        'Desktop input driver',
        hasXdotool ? 'available' : 'missing',
        hasXdotool
          ? 'xdotool is available for Linux focus, keyboard, and mouse input.'
          : 'xdotool is missing, so Linux desktop focus and input will fail.',
        'Install xdotool to enable Linux desktop input.',
        'xdotool'
      ),
      check(
        'screenshot-tool',
        'Screenshot tool',
        screenshotTool ? 'available' : 'missing',
        screenshotTool
          ? `${screenshotTool} is available for screenshot capture.`
          : 'No supported screenshot tool was found.',
        'Install gnome-screenshot, scrot, or ImageMagick import.',
        screenshotTool
      )
    ];

    return {
      platform: this.platform,
      canLaunchProcesses: true,
      canCheckProcessHealth: true,
      canFocusWindow: hasXdotool,
      canSendKeyboardInput: hasXdotool,
      canSendMouseInput: hasXdotool,
      canCaptureScreenshots: Boolean(screenshotTool),
      inputDriverAvailable: hasXdotool,
      screenshotToolAvailable: Boolean(screenshotTool),
      focusToolAvailable: hasXdotool,
      screenshotTool,
      checks,
      warnings: warningsFor(checks)
    };
  }

  private async checkMac(): Promise<DesktopAdapterDependencyReport> {
    const hasOsascript = await this.commandExists('osascript');
    const hasScreencapture = await this.commandExists('screencapture');
    const checks = [
      check(
        'focus-tool',
        'Focus window',
        hasOsascript ? 'available' : 'missing',
        hasOsascript
          ? 'osascript is available for focusing a game process.'
          : 'osascript is missing, so the adapter cannot focus a game window.',
        'osascript is normally included with macOS.',
        'osascript'
      ),
      check(
        'platform-input',
        'Desktop input driver',
        'not_implemented',
        'macOS keyboard and mouse input are limited until a native input driver is added.'
      ),
      check(
        'screenshot-tool',
        'Screenshot tool',
        hasScreencapture ? 'available' : 'missing',
        hasScreencapture
          ? 'screencapture is available for screenshot capture.'
          : 'screencapture is missing, so screenshots will not work.',
        'screencapture is normally included with macOS.',
        'screencapture'
      )
    ];

    return {
      platform: this.platform,
      canLaunchProcesses: true,
      canCheckProcessHealth: true,
      canFocusWindow: hasOsascript,
      canSendKeyboardInput: false,
      canSendMouseInput: false,
      canCaptureScreenshots: hasScreencapture,
      inputDriverAvailable: false,
      screenshotToolAvailable: hasScreencapture,
      focusToolAvailable: hasOsascript,
      screenshotTool: hasScreencapture ? 'screencapture' : undefined,
      checks,
      warnings: warningsFor(checks)
    };
  }

  private async checkWindows(): Promise<DesktopAdapterDependencyReport> {
    const checks = [
      check(
        'process-launch',
        'Process launch',
        'available',
        'Windows process launch and process health checks are available.'
      ),
      check(
        'platform-input',
        'Desktop input driver',
        'not_implemented',
        'Windows keyboard and mouse input are not implemented until a native driver is added.'
      ),
      check(
        'screenshot-tool',
        'Screenshot tool',
        'not_implemented',
        'Windows screenshot capture is not implemented until a native screenshot driver is added.'
      )
    ];

    return {
      platform: this.platform,
      canLaunchProcesses: true,
      canCheckProcessHealth: true,
      canFocusWindow: false,
      canSendKeyboardInput: false,
      canSendMouseInput: false,
      canCaptureScreenshots: false,
      inputDriverAvailable: false,
      screenshotToolAvailable: false,
      focusToolAvailable: false,
      checks,
      warnings: warningsFor(checks)
    };
  }

  private async firstAvailable(commands: string[]): Promise<string | undefined> {
    for (const command of commands) {
      if (await this.commandExists(command)) {
        return command;
      }
    }

    return undefined;
  }
}
