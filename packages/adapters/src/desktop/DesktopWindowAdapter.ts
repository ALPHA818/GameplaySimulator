import type {
  ActionResult,
  AdapterType,
  ControlBinding,
  GameAction,
  GameInstanceConfig,
  GameStateSnapshot
} from '@core/types';
import { execFile, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { BaseGameAdapter } from '../base/BaseGameAdapter';
import type {
  AdapterCapabilities,
  AdapterHealth,
  AvailableGameAction,
  GameAdapterInstance,
  ScreenshotCapture
} from '../base/GameAdapter';

const execFileAsync = promisify(execFile);

export interface DesktopProcessInfo {
  pid: number;
  executablePath?: string;
  command?: string;
  alive: boolean;
  startedAt?: string;
  exitedAt?: string;
  exitCode?: number | null;
  signalCode?: NodeJS.Signals | null;
  cpuPercent?: number;
  memoryPercent?: number;
  elapsed?: string;
}

export interface DesktopWindowInfo {
  windowId?: string;
  title?: string;
  focused: boolean;
  focusMethod?: string;
}

export interface KeyboardInputRequest {
  binding: string;
  action: GameAction;
  instanceId: string;
  botId: string;
}

export interface MouseInputRequest {
  binding: string;
  action: GameAction;
  instanceId: string;
  botId: string;
}

export interface ControllerInputRequest {
  binding: string;
  action: GameAction;
  instanceId: string;
  botId: string;
}

export interface DesktopInputDriver {
  focusWindow(processInfo: DesktopProcessInfo): Promise<DesktopWindowInfo>;
  sendKeyboardInput(request: KeyboardInputRequest): Promise<void>;
  sendMouseInput(request: MouseInputRequest): Promise<void>;
  sendControllerInput?(request: ControllerInputRequest): Promise<void>;
}

export interface DesktopScreenshotDriver {
  captureWindow(request: {
    instanceId: string;
    botId: string;
    processInfo: DesktopProcessInfo;
    windowInfo?: DesktopWindowInfo;
    outputPath: string;
  }): Promise<{ path: string; mimeType: string }>;
}

export interface DesktopWindowAdapterOptions {
  id?: string;
  name?: string;
  adapterType?: AdapterType;
  executablePath?: string;
  workingDirectory?: string;
  controlBindings?: ControlBinding[];
  screenshotDirectory?: string;
  inputDriver?: DesktopInputDriver;
  screenshotDriver?: DesktopScreenshotDriver;
  processStopTimeoutMs?: number;
  capabilities?: Partial<AdapterCapabilities>;
}

interface DesktopInstanceRuntime {
  child?: ChildProcess;
  processInfo: DesktopProcessInfo;
  windowInfo?: DesktopWindowInfo;
  lastKnownAction?: {
    actionId: string;
    type: string;
    binding?: string;
    performedAt: string;
    status: ActionResult['status'];
    message?: string;
  };
  lastScreenshotPath?: string;
}

function now(): string {
  return new Date().toISOString();
}

function hasExited(child: ChildProcess | undefined): boolean {
  return !child || child.exitCode !== null || child.signalCode !== null;
}

function pidIsAlive(pid: number | undefined): boolean {
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function normalizeActionName(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
}

function bindingIsMouse(binding: string): boolean {
  return ['mouseleft', 'mouseright', 'mousemiddle', 'mouse-left', 'mouse-right', 'mouse-middle'].includes(
    binding.trim().toLowerCase()
  );
}

function ensureExecutablePath(path: string | undefined): string {
  if (!path || path.trim().length === 0) {
    throw new Error('DesktopWindowAdapter requires an executablePath to launch a game instance.');
  }

  return path;
}

function safeNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeKeyboardBinding(binding: string): string {
  const trimmed = binding.trim();
  const aliases: Record<string, string> = {
    ' ': 'space',
    spacebar: 'space',
    escape: 'Escape',
    esc: 'Escape',
    enter: 'Return',
    arrowup: 'Up',
    arrowdown: 'Down',
    arrowleft: 'Left',
    arrowright: 'Right',
    mouseleft: 'click-1',
    mouseright: 'click-3',
    mousemiddle: 'click-2'
  };
  const normalized = aliases[trimmed.toLowerCase().replace(/\s+/g, '')] ?? trimmed;

  return normalized.length === 1 ? normalized.toLowerCase() : normalized;
}

class PlatformDesktopInputDriver implements DesktopInputDriver {
  async focusWindow(processInfo: DesktopProcessInfo): Promise<DesktopWindowInfo> {
    if (!processInfo.pid) {
      return { focused: false };
    }

    if (process.platform === 'linux') {
      try {
        const { stdout } = await execFileAsync('xdotool', ['search', '--pid', String(processInfo.pid)]);
        const windowId = stdout.trim().split(/\s+/)[0];

        if (!windowId) {
          return { focused: false, focusMethod: 'xdotool' };
        }

        await execFileAsync('xdotool', ['windowactivate', '--sync', windowId]);

        return { windowId, focused: true, focusMethod: 'xdotool' };
      } catch {
        return { focused: false, focusMethod: 'xdotool-unavailable' };
      }
    }

    if (process.platform === 'darwin') {
      try {
        await execFileAsync('osascript', [
          '-e',
          `tell application "System Events" to set frontmost of first process whose unix id is ${processInfo.pid} to true`
        ]);

        return { focused: true, focusMethod: 'osascript' };
      } catch {
        return { focused: false, focusMethod: 'osascript-unavailable' };
      }
    }

    return { focused: false, focusMethod: 'unsupported-platform' };
  }

  async sendKeyboardInput(request: KeyboardInputRequest): Promise<void> {
    if (process.platform !== 'linux') {
      throw new Error(`Keyboard input simulation is not implemented for ${process.platform}.`);
    }

    const key = normalizeKeyboardBinding(request.binding);
    await execFileAsync('xdotool', ['key', key]);
  }

  async sendMouseInput(request: MouseInputRequest): Promise<void> {
    if (process.platform !== 'linux') {
      throw new Error(`Mouse input simulation is not implemented for ${process.platform}.`);
    }

    const binding = normalizeKeyboardBinding(request.binding);
    const click = binding === 'click-3' ? '3' : binding === 'click-2' ? '2' : '1';
    await execFileAsync('xdotool', ['click', click]);
  }
}

class PlatformScreenshotDriver implements DesktopScreenshotDriver {
  async captureWindow(request: {
    processInfo: DesktopProcessInfo;
    windowInfo?: DesktopWindowInfo;
    outputPath: string;
  }): Promise<{ path: string; mimeType: string }> {
    await mkdir(dirname(request.outputPath), { recursive: true });

    if (process.platform === 'linux') {
      if (request.windowInfo?.windowId) {
        try {
          await execFileAsync('import', ['-window', request.windowInfo.windowId, request.outputPath]);
          return { path: request.outputPath, mimeType: 'image/png' };
        } catch {
          // Fall through to full-screen capture helpers.
        }
      }

      try {
        await execFileAsync('gnome-screenshot', ['-f', request.outputPath]);
        return { path: request.outputPath, mimeType: 'image/png' };
      } catch {
        await execFileAsync('scrot', [request.outputPath]);
        return { path: request.outputPath, mimeType: 'image/png' };
      }
    }

    if (process.platform === 'darwin') {
      await execFileAsync('screencapture', ['-x', request.outputPath]);
      return { path: request.outputPath, mimeType: 'image/png' };
    }

    throw new Error(`Screenshot capture is not implemented for ${process.platform}.`);
  }
}

export class DesktopWindowAdapter extends BaseGameAdapter {
  readonly executablePath?: string;
  readonly workingDirectory?: string;
  private readonly controlBindings: ControlBinding[];
  private readonly screenshotDirectory: string;
  private readonly inputDriver: DesktopInputDriver;
  private readonly screenshotDriver: DesktopScreenshotDriver;
  private readonly processStopTimeoutMs: number;
  private readonly desktopInstances = new Map<string, DesktopInstanceRuntime>();

  constructor(options: DesktopWindowAdapterOptions = {}) {
    super({
      id: options.id ?? 'desktop-window',
      name: options.name ?? 'Desktop Window Adapter',
      adapterType: options.adapterType ?? 'desktop',
      capabilities: {
        supportsMultipleInstances: false,
        supportsMultipleBotsPerInstance: false,
        supportsStateRead: false,
        supportsDirectActions: false,
        supportsInputSimulation: true,
        supportsScreenshots: true,
        supportsVideo: false,
        supportsGameLogs: false,
        supportsSaveIsolation: false,
        supportsReset: false,
        supportsCheckpointReload: false,
        ...options.capabilities
      }
    });

    this.executablePath = options.executablePath;
    this.workingDirectory = options.workingDirectory;
    this.controlBindings = options.controlBindings ?? [];
    this.screenshotDirectory = options.screenshotDirectory ?? join(process.cwd(), 'runs', 'screenshots');
    this.inputDriver = options.inputDriver ?? new PlatformDesktopInputDriver();
    this.screenshotDriver = options.screenshotDriver ?? new PlatformScreenshotDriver();
    this.processStopTimeoutMs = options.processStopTimeoutMs ?? 2500;
  }

  override async launchInstance(config: GameInstanceConfig): Promise<GameAdapterInstance> {
    const executablePath = ensureExecutablePath(config.launch.executablePath ?? this.executablePath);
    const args = config.launch.arguments ?? [];
    const workingDirectory = config.launch.workingDirectory ?? this.workingDirectory;
    const child = spawn(executablePath, args, {
      cwd: workingDirectory,
      env: {
        ...process.env,
        ...config.environment
      },
      windowsHide: false,
      stdio: 'ignore'
    });

    const startedAt = now();
    const processInfo: DesktopProcessInfo = {
      pid: child.pid ?? 0,
      executablePath,
      command: [basename(executablePath), ...args].join(' '),
      alive: true,
      startedAt
    };
    const instance: GameAdapterInstance = {
      instanceId: config.instanceId,
      adapterId: this.id,
      gameProfileId: config.gameProfileId,
      launchConfig: config,
      startedAt,
      metadata: {
        adapterType: this.adapterType,
        processId: child.pid,
        executablePath,
        workingDirectory,
        browserSpecific: false
      }
    };

    this.instances.set(config.instanceId, { instance, running: true });
    this.desktopInstances.set(config.instanceId, { child, processInfo });

    child.once('exit', (exitCode, signalCode) => {
      const runtime = this.desktopInstances.get(config.instanceId);

      if (runtime) {
        runtime.processInfo.alive = false;
        runtime.processInfo.exitedAt = now();
        runtime.processInfo.exitCode = exitCode;
        runtime.processInfo.signalCode = signalCode;
      }
    });

    child.on('error', (error) => {
      const runtime = this.desktopInstances.get(config.instanceId);

      if (runtime) {
        runtime.processInfo.alive = false;
        runtime.lastKnownAction = {
          actionId: 'process-error',
          type: 'process-error',
          performedAt: now(),
          status: 'failed',
          message: error.message
        };
      }
    });

    return instance;
  }

  override async stopInstance(instanceId: string): Promise<void> {
    const runtime = this.desktopInstances.get(instanceId);

    if (!runtime) {
      await super.stopInstance(instanceId);
      return;
    }

    if (runtime.child && !hasExited(runtime.child)) {
      runtime.child.kill('SIGTERM');

      await new Promise<void>((resolveStop) => {
        const timeout = setTimeout(() => {
          if (runtime.child && !hasExited(runtime.child)) {
            runtime.child.kill('SIGKILL');
          }

          resolveStop();
        }, this.processStopTimeoutMs);

        runtime.child?.once('exit', () => {
          clearTimeout(timeout);
          resolveStop();
        });
      });
    }

    runtime.processInfo.alive = false;
    runtime.processInfo.exitedAt = runtime.processInfo.exitedAt ?? now();
    await super.stopInstance(instanceId);
  }

  override async stopAll(): Promise<void> {
    await Promise.all([...this.desktopInstances.keys()].map((instanceId) => this.stopInstance(instanceId)));
  }

  override async isRunning(instanceId: string): Promise<boolean> {
    const runtime = this.desktopInstances.get(instanceId);

    if (!runtime) {
      return false;
    }

    const alive = !hasExited(runtime.child) && pidIsAlive(runtime.processInfo.pid);
    runtime.processInfo.alive = alive;

    return alive;
  }

  async findGameProcess(executablePath = this.executablePath): Promise<DesktopProcessInfo | null> {
    if (!executablePath) {
      return null;
    }

    if (process.platform === 'win32') {
      return null;
    }

    try {
      const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,comm=,args=']);
      const executableName = basename(executablePath);
      const line = stdout
        .split('\n')
        .map((item) => item.trim())
        .find((item) => item.includes(executablePath) || item.includes(executableName));

      if (!line) {
        return null;
      }

      const [pidText, command] = line.split(/\s+/, 2);
      const pid = Number(pidText);

      return {
        pid,
        executablePath,
        command,
        alive: pidIsAlive(pid)
      };
    } catch {
      return null;
    }
  }

  async getProcessInfo(instanceId: string): Promise<DesktopProcessInfo | null> {
    const runtime = this.desktopInstances.get(instanceId);

    if (!runtime) {
      return null;
    }

    if (process.platform !== 'win32') {
      try {
        const { stdout } = await execFileAsync('ps', [
          '-p',
          String(runtime.processInfo.pid),
          '-o',
          'pid=,ppid=,comm=,etime=,%cpu=,%mem='
        ]);
        const line = stdout.trim();
        const parts = line.split(/\s+/);

        runtime.processInfo.command = parts[2] ?? runtime.processInfo.command;
        runtime.processInfo.elapsed = parts[3];
        runtime.processInfo.cpuPercent = safeNumber(parts[4]);
        runtime.processInfo.memoryPercent = safeNumber(parts[5]);
      } catch {
        // Keep the last known process info if the OS cannot provide details.
      }
    }

    runtime.processInfo.alive = await this.isRunning(instanceId);
    return { ...runtime.processInfo };
  }

  async focusWindow(instanceId: string): Promise<DesktopWindowInfo> {
    const runtime = this.requireDesktopRuntime(instanceId);
    const processInfo = (await this.getProcessInfo(instanceId)) ?? runtime.processInfo;
    const windowInfo = await this.inputDriver.focusWindow(processInfo);

    runtime.windowInfo = windowInfo;
    return windowInfo;
  }

  override async getAvailableActions(_instanceId: string, _botId: string): Promise<AvailableGameAction[]> {
    return this.controlBindings.map((binding) => ({
      actionType: binding.action ?? binding.controlId,
      label: binding.label,
      description: `Mapped to ${binding.inputType} control ${binding.binding ?? binding.controlId}.`,
      requiresInputSimulation: true,
      requiresStateRead: false,
      requiresDirectAction: false,
      payloadSchema: binding.metadata
    }));
  }

  override async performAction(instanceId: string, botId: string, action: GameAction): Promise<ActionResult> {
    const startedAt = now();
    const runtime = this.requireDesktopRuntime(instanceId);
    const running = await this.isRunning(instanceId);

    if (!running) {
      return this.recordAction(runtime, action, botId, 'failed', startedAt, 'Desktop game process is not running.');
    }

    const binding = this.resolveControlBinding(action);

    if (!binding?.binding) {
      return this.recordAction(
        runtime,
        action,
        botId,
        'failed',
        startedAt,
        `No desktop control mapping found for action "${action.type}".`
      );
    }

    const windowInfo = await this.focusWindow(instanceId);

    try {
      if (binding.inputType === 'keyboard') {
        await this.inputDriver.sendKeyboardInput({ binding: binding.binding, action, instanceId, botId });
      } else if (binding.inputType === 'mouse' || bindingIsMouse(binding.binding)) {
        await this.inputDriver.sendMouseInput({ binding: binding.binding, action, instanceId, botId });
      } else if (binding.inputType === 'gamepad' && this.inputDriver.sendControllerInput) {
        await this.inputDriver.sendControllerInput({ binding: binding.binding, action, instanceId, botId });
      } else {
        return this.recordAction(
          runtime,
          action,
          botId,
          'skipped',
          startedAt,
          `Control type "${binding.inputType}" is reserved for a later input driver.`
        );
      }

      runtime.windowInfo = windowInfo;
      return this.recordAction(
        runtime,
        action,
        botId,
        'succeeded',
        startedAt,
        `Sent ${binding.inputType} input "${binding.binding}".`,
        binding.binding
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Desktop input failed.';

      return this.recordAction(runtime, action, botId, 'failed', startedAt, message, binding.binding);
    }
  }

  override async captureScreenshot(instanceId: string, botId: string): Promise<ScreenshotCapture> {
    const runtime = this.requireDesktopRuntime(instanceId);
    const processInfo = (await this.getProcessInfo(instanceId)) ?? runtime.processInfo;
    const windowInfo = runtime.windowInfo ?? (await this.focusWindow(instanceId));
    const outputPath = join(this.screenshotDirectory, `${instanceId}-${botId}-${Date.now()}.png`);
    const result = await this.screenshotDriver.captureWindow({
      instanceId,
      botId,
      processInfo,
      windowInfo,
      outputPath
    });

    runtime.lastScreenshotPath = result.path;

    return {
      instanceId,
      botId,
      capturedAt: now(),
      path: result.path,
      mimeType: result.mimeType
    };
  }

  override async getState(instanceId: string, botId: string): Promise<GameStateSnapshot> {
    const runtime = this.requireDesktopRuntime(instanceId);
    const processInfo = (await this.getProcessInfo(instanceId)) ?? runtime.processInfo;
    const running = await this.isRunning(instanceId);

    return {
      snapshotId: `${instanceId}-${botId}-${Date.now()}`,
      sessionId: 'desktop-session',
      gameId: this.instances.get(instanceId)?.instance.gameProfileId ?? 'desktop-game',
      gameInstanceId: instanceId,
      botId,
      capturedAt: now(),
      state: {
        adapterId: this.id,
        adapterType: this.adapterType,
        structuredStateAvailable: false,
        processStatus: running ? 'running' : 'stopped',
        processInfo,
        windowStatus: runtime.windowInfo ?? { focused: false },
        screenshotPath: runtime.lastScreenshotPath,
        lastKnownAction: runtime.lastKnownAction,
        telemetry: {
          cpuPercent: processInfo.cpuPercent,
          memoryPercent: processInfo.memoryPercent,
          elapsed: processInfo.elapsed
        }
      },
      metrics: {
        cpuPercent: processInfo.cpuPercent ?? 0,
        memoryPercent: processInfo.memoryPercent ?? 0
      },
      screenshotPath: runtime.lastScreenshotPath
    };
  }

  override async getHealth(instanceId: string): Promise<AdapterHealth> {
    const runtime = this.desktopInstances.get(instanceId);

    if (!runtime) {
      return super.getHealth(instanceId);
    }

    const processInfo = await this.getProcessInfo(instanceId);
    const running = await this.isRunning(instanceId);

    return {
      instanceId,
      status: running ? 'running' : 'stopped',
      checkedAt: now(),
      message: running ? 'Desktop process is running.' : 'Desktop process is not running.',
      details: {
        adapterId: this.id,
        adapterType: this.adapterType,
        processInfo,
        windowInfo: runtime.windowInfo,
        lastKnownAction: runtime.lastKnownAction,
        noInjection: true,
        browserSpecific: false
      }
    };
  }

  private requireDesktopRuntime(instanceId: string): DesktopInstanceRuntime {
    const runtime = this.desktopInstances.get(instanceId);

    if (!runtime) {
      throw new Error(`Desktop instance "${instanceId}" was not launched by this adapter.`);
    }

    return runtime;
  }

  private resolveControlBinding(action: GameAction): ControlBinding | undefined {
    const actionName = normalizeActionName(action.type);
    const targetName = normalizeActionName(action.target);
    const payloadControlId =
      typeof action.payload.controlId === 'string' ? normalizeActionName(action.payload.controlId) : undefined;
    const payloadBinding = typeof action.payload.binding === 'string' ? action.payload.binding : undefined;

    if (payloadBinding) {
      return {
        controlId: action.type,
        label: action.type,
        inputType: bindingIsMouse(payloadBinding) ? 'mouse' : 'keyboard',
        binding: payloadBinding,
        action: action.type,
        metadata: {}
      };
    }

    return this.controlBindings.find((binding) => {
      const bindingAction = normalizeActionName(binding.action);
      const bindingControlId = normalizeActionName(binding.controlId);
      const bindingLabel = normalizeActionName(binding.label);

      return (
        bindingAction === actionName ||
        bindingControlId === actionName ||
        bindingLabel === actionName ||
        (targetName.length > 0 && (bindingAction === targetName || bindingControlId === targetName)) ||
        (payloadControlId !== undefined &&
          (bindingAction === payloadControlId || bindingControlId === payloadControlId))
      );
    });
  }

  private recordAction(
    runtime: DesktopInstanceRuntime,
    action: GameAction,
    botId: string,
    status: ActionResult['status'],
    startedAt: string,
    message: string,
    binding?: string
  ): ActionResult {
    const completedAt = now();

    runtime.lastKnownAction = {
      actionId: action.actionId,
      type: action.type,
      binding,
      performedAt: completedAt,
      status,
      message
    };

    return {
      actionId: action.actionId,
      botId,
      status,
      startedAt,
      completedAt,
      durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
      message,
      issueIds: []
    };
  }
}
