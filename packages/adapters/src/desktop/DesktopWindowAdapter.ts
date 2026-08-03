import type {
  ActionResult,
  AdapterType,
  ControlBinding,
  GameAction,
  GameInstanceConfig,
  GameStateSnapshot
} from '@core/types';
import {
  defaultRuntimeObservationConfig,
  type RuntimeObservationConfig
} from '@core/config/runtimeObservationConfig';
import { execFile, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { tmpdir, totalmem } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import type { LogEntry } from '@core/logging/LogEntry';
import { assertResolvedPathWithin } from '@core/security/pathContainment';
import { BaseGameAdapter } from '../base/BaseGameAdapter';
import type {
  AdapterCapabilities,
  AdapterHealth,
  AvailableGameAction,
  GameAdapterInstance,
  ObservationTargetUpdate,
  ScreenshotCapture,
  ScreenshotCaptureScope,
  WindowFocusResult
} from '../base/GameAdapter';
import {
  DesktopAdapterDependencyChecker,
  type DesktopAdapterDependencyReport
} from './DesktopAdapterDependencyChecker';

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
    allowFullDesktopCapture: boolean;
  }): Promise<{ path: string; mimeType: string; scope: ScreenshotCaptureScope }>;
}

export interface DesktopWindowAdapterOptions {
  id?: string;
  name?: string;
  adapterType?: AdapterType;
  executablePath?: string;
  workingDirectory?: string;
  launchArguments?: string[];
  controlBindings?: ControlBinding[];
  screenshotDirectory?: string;
  inputDriver?: DesktopInputDriver;
  screenshotDriver?: DesktopScreenshotDriver;
  dependencyChecker?: DesktopAdapterDependencyChecker;
  processStopTimeoutMs?: number;
  allowFullDesktopCapture?: boolean;
  requireScreenshotEvidence?: boolean;
  capabilities?: Partial<AdapterCapabilities>;
  runtimeObservation?: RuntimeObservationConfig;
}

interface DesktopStopEvent {
  eventType:
    | 'graceful_stop_requested'
    | 'graceful_stop_completed'
    | 'forced_kill_requested'
    | 'forced_kill_completed'
    | 'stop_failed';
  timestamp: string;
  signal?: NodeJS.Signals;
  message: string;
}

interface DesktopInstanceRuntime {
  child?: ChildProcess;
  launcherPid: number;
  processGroupId?: number;
  ownedProcessIds: Set<number>;
  liveProcessIds: Set<number>;
  ownershipTimer?: NodeJS.Timeout;
  processInfo: DesktopProcessInfo;
  windowInfo?: DesktopWindowInfo;
  lastHeartbeatAt?: string;
  lastSuccessfulInputAt?: string;
  lastKnownAction?: {
    actionId: string;
    type: string;
    binding?: string;
    performedAt: string;
    status: ActionResult['status'];
    message?: string;
  };
  lastScreenshotPath?: string;
  lastScreenshotScope?: ScreenshotCaptureScope;
  stopEvents: DesktopStopEvent[];
}

function now(): string {
  return new Date().toISOString();
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

interface SystemProcessRecord {
  pid: number;
  parentPid: number;
  processGroupId?: number;
}

async function listSystemProcesses(): Promise<SystemProcessRecord[]> {
  if (process.platform === 'win32') {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress'
    ]);
    const parsed = JSON.parse(stdout) as
      | { ProcessId: number; ParentProcessId: number }
      | Array<{ ProcessId: number; ParentProcessId: number }>;
    return (Array.isArray(parsed) ? parsed : [parsed]).map((item) => ({
      pid: Number(item.ProcessId),
      parentPid: Number(item.ParentProcessId)
    }));
  }

  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,pgid=']);
  return stdout
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter((parts) => parts.length >= 3 && parts.every(Number.isFinite))
    .map(([pid, parentPid, processGroupId]) => ({ pid, parentPid, processGroupId }));
}

function descendantsOf(
  processes: SystemProcessRecord[],
  knownProcessIds: ReadonlySet<number>
): Set<number> {
  const descendants = new Set(knownProcessIds);
  let changed = true;

  while (changed) {
    changed = false;
    for (const item of processes) {
      if (!descendants.has(item.pid) && descendants.has(item.parentPid)) {
        descendants.add(item.pid);
        changed = true;
      }
    }
  }

  return descendants;
}

function normalizeActionName(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
}

function safePathSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
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

  const executablePath = path.trim();

  if (!isAbsolute(executablePath)) {
    throw new Error('DesktopWindowAdapter requires an absolute executablePath.');
  }

  if (executablePath.includes('\0')) {
    throw new Error('DesktopWindowAdapter executablePath contains a null character.');
  }

  return executablePath;
}

function safeNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value.replace(/[,%]/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function memoryPercentFromKb(memoryKb: number | undefined): number | undefined {
  if (memoryKb === undefined) {
    return undefined;
  }

  const totalKb = totalmem() / 1024;

  return totalKb > 0 ? Number(((memoryKb / totalKb) * 100).toFixed(2)) : undefined;
}

function parseWindowsTasklistMemoryKb(output: string): number | undefined {
  const line = output
    .split('\n')
    .map((item) => item.trim())
    .find((item) => item.length > 0 && !item.toLowerCase().startsWith('"image name"'));

  if (!line) {
    return undefined;
  }

  const columns = line
    .split('","')
    .map((item) => item.replace(/^"|"$/g, '').trim());
  const memoryColumn = columns[4];

  if (!memoryColumn) {
    return undefined;
  }

  const kb = Number(memoryColumn.replace(/[^0-9]/g, ''));

  return Number.isFinite(kb) ? kb : undefined;
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

async function findExternalDesktopProcess(executablePath: string): Promise<DesktopProcessInfo | null> {
  const executableName = basename(executablePath);

  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('tasklist.exe', [
        '/fi',
        `IMAGENAME eq ${executableName}`,
        '/fo',
        'csv',
        '/nh'
      ]);
      const columns = stdout.trim().split('"').filter((value) => value && value !== ',');
      const pid = Number(columns[1]);

      return Number.isFinite(pid) && pid > 0
        ? { pid, executablePath, command: executableName, alive: pidIsAlive(pid) }
        : null;
    }

    const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,comm=,args=']);
    const line = stdout
      .split('\n')
      .map((item) => item.trim())
      .find((item) => item.includes(executablePath) || item.includes(executableName));

    if (!line) {
      return null;
    }

    const [pidText, command] = line.split(/\s+/, 2);
    const pid = Number(pidText);

    return Number.isFinite(pid) && pid > 0
      ? { pid, executablePath, command, alive: pidIsAlive(pid) }
      : null;
  } catch {
    return null;
  }
}

export function createExternalDesktopWindowFocusHandler(
  executablePath: string
): (instanceId: string) => Promise<WindowFocusResult> {
  const inputDriver = new PlatformDesktopInputDriver();

  return async (instanceId) => {
    const processInfo = await findExternalDesktopProcess(executablePath);

    if (!processInfo?.alive) {
      return {
        instanceId,
        supported: true,
        visible: false,
        focused: false,
        message: 'The instrumented game process was not found, so its external window could not be focused.'
      };
    }

    const windowInfo = await inputDriver.focusWindow(processInfo);

    return {
      instanceId,
      supported: true,
      visible: true,
      focused: windowInfo.focused,
      message: windowInfo.focused
        ? 'The external instrumented game window was brought to the front.'
        : 'The external instrumented game window is visible, but the operating system could not focus it.',
      windowId: windowInfo.windowId,
      title: windowInfo.title
    };
  };
}

class PlatformScreenshotDriver implements DesktopScreenshotDriver {
  async captureWindow(request: {
    processInfo: DesktopProcessInfo;
    windowInfo?: DesktopWindowInfo;
    outputPath: string;
    allowFullDesktopCapture: boolean;
  }): Promise<{ path: string; mimeType: string; scope: ScreenshotCaptureScope }> {
    await mkdir(dirname(request.outputPath), { recursive: true });

    if (process.platform === 'linux') {
      let windowId = request.windowInfo?.windowId;
      if (!windowId) {
        try {
          const { stdout } = await execFileAsync('xdotool', [
            'search',
            '--pid',
            String(request.processInfo.pid)
          ]);
          windowId = stdout.trim().split(/\s+/)[0];
        } catch {
          windowId = undefined;
        }
      }

      if (windowId) {
        try {
          await execFileAsync('import', ['-window', windowId, request.outputPath]);
          return { path: request.outputPath, mimeType: 'image/png', scope: 'game-window' };
        } catch {
          // A full-desktop fallback is allowed only with explicit session consent.
        }
      }

      if (!request.allowFullDesktopCapture) {
        throw new Error(
          'Game-window screenshot capture is unavailable. Full-desktop capture is disabled because this session did not grant privacy consent.'
        );
      }

      try {
        await execFileAsync('gnome-screenshot', ['-f', request.outputPath]);
        return { path: request.outputPath, mimeType: 'image/png', scope: 'full-desktop' };
      } catch {
        await execFileAsync('scrot', [request.outputPath]);
        return { path: request.outputPath, mimeType: 'image/png', scope: 'full-desktop' };
      }
    }

    if (process.platform === 'darwin') {
      if (!request.allowFullDesktopCapture) {
        throw new Error(
          'macOS screenshot capture would include the full desktop. Enable full-desktop capture consent for this session to allow it.'
        );
      }
      await execFileAsync('screencapture', ['-x', request.outputPath]);
      return { path: request.outputPath, mimeType: 'image/png', scope: 'full-desktop' };
    }

    throw new Error(`Screenshot capture is not implemented for ${process.platform}.`);
  }
}

export class DesktopWindowAdapter extends BaseGameAdapter {
  readonly executablePath?: string;
  readonly workingDirectory?: string;
  readonly launchArguments: string[];
  private readonly controlBindings: ControlBinding[];
  private readonly screenshotDirectory: string;
  private readonly inputDriver: DesktopInputDriver;
  private readonly screenshotDriver: DesktopScreenshotDriver;
  private readonly usesPlatformInputDriver: boolean;
  private readonly usesPlatformScreenshotDriver: boolean;
  private readonly dependencyChecker: DesktopAdapterDependencyChecker;
  private readonly processStopTimeoutMs: number;
  private readonly allowFullDesktopCapture: boolean;
  private readonly requireScreenshotEvidence: boolean;
  private readonly runtimeObservation: RuntimeObservationConfig;
  private readonly desktopInstances = new Map<string, DesktopInstanceRuntime>();
  private readonly stoppedInstanceLogs = new Map<string, LogEntry[]>();
  private followedBotId?: string;
  private dependencyReport?: DesktopAdapterDependencyReport;

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
        supportsLiveObservation: true,
        supportsWindowFocus: true,
        supportsMultipleVisibleWindows: false,
        observationCapability: 'visible-window',
        ...options.capabilities
      }
    });

    this.executablePath = options.executablePath;
    this.workingDirectory = options.workingDirectory;
    this.launchArguments = options.launchArguments ? [...options.launchArguments] : [];
    this.controlBindings = options.controlBindings ?? [];
    this.screenshotDirectory = options.screenshotDirectory ??
      join(tmpdir(), 'gameplay-simulator', 'desktop-screenshots');
    this.usesPlatformInputDriver = options.inputDriver === undefined;
    this.usesPlatformScreenshotDriver = options.screenshotDriver === undefined;
    this.inputDriver = options.inputDriver ?? new PlatformDesktopInputDriver();
    this.screenshotDriver = options.screenshotDriver ?? new PlatformScreenshotDriver();
    this.dependencyChecker = options.dependencyChecker ?? new DesktopAdapterDependencyChecker();
    this.processStopTimeoutMs = options.processStopTimeoutMs ?? 2500;
    this.allowFullDesktopCapture = options.allowFullDesktopCapture ?? false;
    this.requireScreenshotEvidence = options.requireScreenshotEvidence ?? false;
    this.runtimeObservation = options.runtimeObservation ?? defaultRuntimeObservationConfig;
  }

  async checkDependencies(): Promise<DesktopAdapterDependencyReport> {
    this.dependencyReport = await this.dependencyChecker.checkDependencies();
    if (this.usesPlatformInputDriver) {
      this.capabilities.supportsInputSimulation =
        this.dependencyReport.canSendKeyboardInput || this.dependencyReport.canSendMouseInput;
      this.capabilities.supportsWindowFocus = this.dependencyReport.canFocusWindow;
    }
    if (this.usesPlatformScreenshotDriver) {
      this.capabilities.supportsScreenshots =
        this.dependencyReport.canCaptureGameWindow ||
        (this.allowFullDesktopCapture && this.dependencyReport.canCaptureFullDesktop);
    }
    return this.dependencyReport;
  }

  override async launchInstance(config: GameInstanceConfig): Promise<GameAdapterInstance> {
    this.stoppedInstanceLogs.delete(config.instanceId);
    const dependencyReport = await this.checkDependencies();
    const needsKeyboard = this.controlBindings.some((binding) => binding.inputType === 'keyboard');
    const needsMouse = this.controlBindings.some((binding) => binding.inputType === 'mouse');

    if (
      this.usesPlatformInputDriver &&
      (
        (needsKeyboard && !dependencyReport.canSendKeyboardInput) ||
        (needsMouse && !dependencyReport.canSendMouseInput)
      )
    ) {
      const inputCheck = dependencyReport.checks.find((item) =>
        ['input-driver', 'platform-input'].includes(item.id)
      );
      throw new Error(
        [
          inputCheck?.message ?? 'The desktop input driver required by this game profile is unavailable.',
          inputCheck?.installHint
        ].filter(Boolean).join(' ')
      );
    }

    if (
      this.usesPlatformScreenshotDriver &&
      this.requireScreenshotEvidence &&
      (!dependencyReport.canCaptureScreenshots ||
        (dependencyReport.screenshotScope === 'full-desktop' && !this.allowFullDesktopCapture))
    ) {
      const screenshotCheck = dependencyReport.checks.find((item) => item.id === 'screenshot-tool');
      throw new Error(
        dependencyReport.screenshotScope === 'full-desktop'
          ? 'Required screenshot evidence is available only as a full-desktop capture, but this session did not grant privacy consent.'
          : [
              screenshotCheck?.message ?? 'Required desktop screenshot evidence is unavailable.',
              screenshotCheck?.installHint
            ].filter(Boolean).join(' ')
      );
    }
    const executablePath = ensureExecutablePath(config.launch.executablePath ?? this.executablePath);
    const args = config.launch.arguments.length > 0 ? config.launch.arguments : this.launchArguments;
    const workingDirectory = config.launch.workingDirectory ?? this.workingDirectory;

    if (args.some((argument) => argument.includes('\0'))) {
      throw new Error('DesktopWindowAdapter launch arguments cannot contain null characters.');
    }

    if (workingDirectory && (!isAbsolute(workingDirectory) || workingDirectory.includes('\0'))) {
      throw new Error('DesktopWindowAdapter workingDirectory must be an absolute path.');
    }

    const child = spawn(executablePath, args, {
      cwd: workingDirectory,
      env: {
        ...process.env,
        ...config.environment
      },
      windowsHide: false,
      stdio: 'ignore',
      shell: false,
      detached: process.platform !== 'win32'
    });

    await new Promise<void>((resolveLaunch, rejectLaunch) => {
      child.once('spawn', resolveLaunch);
      child.once('error', (error) => {
        rejectLaunch(
          new Error(`Unable to launch desktop executable "${executablePath}": ${error.message}`)
        );
      });
    });

    const startedAt = now();
    const processInfo: DesktopProcessInfo = {
      pid: child.pid ?? 0,
      executablePath,
      command: [basename(executablePath), ...args].join(' '),
      alive: true,
      startedAt
    };
    const launcherPid = child.pid ?? 0;
    const runtime: DesktopInstanceRuntime = {
      child,
      launcherPid,
      processGroupId: process.platform === 'win32' ? undefined : launcherPid,
      ownedProcessIds: new Set(launcherPid > 0 ? [launcherPid] : []),
      liveProcessIds: new Set(launcherPid > 0 ? [launcherPid] : []),
      processInfo,
      lastHeartbeatAt: startedAt,
      stopEvents: []
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
        dependencyReport,
        screenshotCaptureScope:
          dependencyReport.screenshotScope === 'full-desktop' && !this.allowFullDesktopCapture
            ? 'unsupported'
            : dependencyReport.screenshotScope,
        fullDesktopCaptureConsented: this.allowFullDesktopCapture,
        visible: true,
        observationCapability: this.capabilities.observationCapability,
        observationMode: this.runtimeObservation.observationMode,
        browserSpecific: false
      }
    };

    this.instances.set(config.instanceId, { instance, running: true });
    this.desktopInstances.set(config.instanceId, runtime);
    runtime.ownershipTimer = setInterval(() => {
      void this.refreshOwnedProcessIds(runtime);
    }, 200);
    runtime.ownershipTimer.unref();
    await this.refreshOwnedProcessIds(runtime);

    child.once('exit', (exitCode, signalCode) => {
      const runtime = this.desktopInstances.get(config.instanceId);

      if (runtime) {
        runtime.processInfo.exitedAt = now();
        runtime.processInfo.exitCode = exitCode;
        runtime.processInfo.signalCode = signalCode;
        void this.refreshOwnedProcessIds(runtime).then(() => {
          runtime.processInfo.alive = this.liveOwnedProcessIds(runtime).length > 0;
        });
      }
    });

    child.once('error', (error) => {
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

    await this.refreshOwnedProcessIds(runtime);
    if (this.liveOwnedProcessIds(runtime).length > 0) {
      runtime.stopEvents.push({
        eventType: 'graceful_stop_requested',
        timestamp: now(),
        signal: 'SIGTERM',
        message: 'Sent a graceful stop signal to the owned desktop game process tree.'
      });
      await this.signalOwnedProcessTree(runtime, 'SIGTERM', false);
      const gracefullyStopped = await this.waitForOwnedProcessesToStop(
        runtime,
        this.processStopTimeoutMs
      );

      if (gracefullyStopped) {
        runtime.stopEvents.push({
          eventType: 'graceful_stop_completed',
          timestamp: now(),
          signal: 'SIGTERM',
          message: 'The owned desktop game process tree stopped gracefully.'
        });
      } else {
        runtime.stopEvents.push({
          eventType: 'forced_kill_requested',
          timestamp: now(),
          signal: 'SIGKILL',
          message: `Graceful stop timed out after ${this.processStopTimeoutMs} ms; sent a forced stop only to the owned process tree.`
        });
        await this.signalOwnedProcessTree(runtime, 'SIGKILL', true);
        const forceStopped = await this.waitForOwnedProcessesToStop(runtime, 1_000);

        if (forceStopped) {
          runtime.stopEvents.push({
            eventType: 'forced_kill_completed',
            timestamp: now(),
            signal: 'SIGKILL',
            message: 'The owned desktop game process tree exited after the forced stop.'
          });
        }
      }

      if (this.liveOwnedProcessIds(runtime).length > 0) {
        runtime.stopEvents.push({
          eventType: 'stop_failed',
          timestamp: now(),
          message: 'Owned desktop processes did not exit after graceful and forced stop attempts.'
        });
        throw new Error('Owned desktop process tree did not exit after forced stop.');
      }
    }

    runtime.processInfo.alive = false;
    runtime.processInfo.exitedAt = runtime.processInfo.exitedAt ?? now();
    this.archiveAndReleaseRuntime(instanceId, runtime);
    await super.stopInstance(instanceId);
  }

  override async stopAll(): Promise<void> {
    await Promise.all([...this.desktopInstances.keys()].map((instanceId) => this.stopInstance(instanceId)));
  }

  async forceStopAll(): Promise<void> {
    const failures: string[] = [];

    for (const [instanceId, runtime] of this.desktopInstances) {
      await this.refreshOwnedProcessIds(runtime);
      await this.signalOwnedProcessTree(runtime, 'SIGKILL', true);
      await this.waitForOwnedProcessesToStop(runtime, 1_000);

      if (this.liveOwnedProcessIds(runtime).length > 0) {
        runtime.stopEvents.push({
          eventType: 'stop_failed',
          timestamp: now(),
          message: 'Owned desktop process remained alive after the forced shutdown attempt.'
        });
        failures.push(instanceId);
        continue;
      }

      runtime.processInfo.alive = false;
      runtime.processInfo.exitedAt = runtime.processInfo.exitedAt ?? now();
      this.archiveAndReleaseRuntime(instanceId, runtime);
      await super.stopInstance(instanceId);
    }

    if (failures.length > 0) {
      throw new Error(
        `Unable to stop owned desktop process instances: ${failures.join(', ')}.`
      );
    }
  }

  override async isRunning(instanceId: string): Promise<boolean> {
    const runtime = this.desktopInstances.get(instanceId);

    if (!runtime) {
      return false;
    }

    await this.refreshOwnedProcessIds(runtime);
    const aliveProcessIds = this.liveOwnedProcessIds(runtime);
    const alive = aliveProcessIds.length > 0;
    const activePid = aliveProcessIds.includes(runtime.launcherPid)
      ? runtime.launcherPid
      : aliveProcessIds[0];
    if (activePid) {
      runtime.processInfo.pid = activePid;
    }
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
    } else {
      try {
        const { stdout } = await execFileAsync('tasklist.exe', [
          '/fi',
          `PID eq ${runtime.processInfo.pid}`,
          '/fo',
          'csv',
          '/nh'
        ]);
        const memoryKb = parseWindowsTasklistMemoryKb(stdout);
        runtime.processInfo.memoryPercent = memoryPercentFromKb(memoryKb);
      } catch {
        // Keep the last known process info if tasklist is unavailable.
      }

      try {
        const { stdout } = await execFileAsync('powershell.exe', [
          '-NoProfile',
          '-Command',
          `(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $_.IDProcess -eq ${runtime.processInfo.pid} } | Select-Object -First 1 -ExpandProperty PercentProcessorTime)`
        ]);
        runtime.processInfo.cpuPercent = safeNumber(stdout.trim());
      } catch {
        // Keep CPU empty when Windows performance counters are unavailable.
      }
    }

    runtime.processInfo.alive = await this.isRunning(instanceId);
    runtime.lastHeartbeatAt = now();
    return { ...runtime.processInfo };
  }

  async focusWindow(instanceId: string): Promise<WindowFocusResult> {
    const runtime = this.requireDesktopRuntime(instanceId);
    const processInfo = (await this.getProcessInfo(instanceId)) ?? runtime.processInfo;
    const windowInfo = await this.inputDriver.focusWindow(processInfo);

    runtime.windowInfo = windowInfo;
    return {
      instanceId,
      supported: this.capabilities.supportsWindowFocus,
      visible: true,
      focused: windowInfo.focused,
      message: windowInfo.focused
        ? 'This game is already running in a visible desktop window and was brought to the front.'
        : 'The desktop game is visible, but its window could not be focused.',
      windowId: windowInfo.windowId,
      title: windowInfo.title
    };
  }

  async openOrFocusGameWindow(instanceId: string): Promise<WindowFocusResult> {
    if (!(await this.isRunning(instanceId))) {
      return {
        instanceId,
        supported: true,
        visible: false,
        focused: false,
        message: 'The desktop game process is not running, so there is no game window to open or focus.'
      };
    }

    return this.focusWindow(instanceId);
  }

  updateObservationTarget(target: ObservationTargetUpdate): void {
    this.runtimeObservation.observationMode = target.observationMode;
    this.runtimeObservation.selectedBotId = target.botId;
    this.followedBotId = target.botId;
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

    const shouldFocus = this.shouldFocusBeforeAction(botId);
    const focusResult = shouldFocus ? await this.focusWindow(instanceId) : undefined;

    if (shouldFocus && !focusResult?.focused) {
      return this.recordAction(
        runtime,
        action,
        botId,
        'failed',
        startedAt,
        focusResult?.message ?? 'Could not focus the game window.',
        binding.binding
      );
    }

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

      return this.recordAction(
        runtime,
        action,
        botId,
        'succeeded',
        startedAt,
        `Sent ${binding.inputType} input "${binding.binding}"${shouldFocus ? ' after focusing the game window' : ' without changing window focus'}.`,
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
    const windowInfo = runtime.windowInfo;
    const outputPath = join(
      this.screenshotDirectory,
      `${safePathSegment(instanceId)}-${safePathSegment(botId)}-${Date.now()}.png`
    );
    assertResolvedPathWithin(this.screenshotDirectory, outputPath, 'Desktop screenshot path', false);
    const result = await this.screenshotDriver.captureWindow({
      instanceId,
      botId,
      processInfo,
      windowInfo,
      outputPath,
      allowFullDesktopCapture: this.allowFullDesktopCapture
    });

    runtime.lastScreenshotPath = result.path;
    runtime.lastScreenshotScope = result.scope;

    return {
      instanceId,
      botId,
      capturedAt: now(),
      scope: result.scope,
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
        screenshotCaptureScope: runtime.lastScreenshotScope,
        lastKnownAction: runtime.lastKnownAction,
        lastHeartbeatAt: runtime.lastHeartbeatAt,
        lastSuccessfulInputAt: runtime.lastSuccessfulInputAt,
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

    const dependencyReport = this.dependencyReport ?? (await this.checkDependencies());
    const processInfo = await this.getProcessInfo(instanceId);
    const running = await this.isRunning(instanceId);
    const stopRequested = runtime.stopEvents.some((event) =>
      ['graceful_stop_requested', 'forced_kill_requested'].includes(event.eventType)
    );
    const failedExit =
      !running &&
      !stopRequested &&
      (processInfo?.signalCode !== undefined ||
        (typeof processInfo?.exitCode === 'number' && processInfo.exitCode !== 0));
    const status = failedExit ? 'failed' : running ? 'running' : 'stopped';

    return {
      instanceId,
      status,
      checkedAt: now(),
      message: failedExit
        ? 'Desktop process exited unexpectedly.'
        : running
          ? 'Desktop process is running.'
          : 'Desktop process is not running.',
      details: {
        adapterId: this.id,
        adapterType: this.adapterType,
        dependencyReport,
        dependencyWarnings: dependencyReport.warnings,
        screenshotCaptureScope: runtime.lastScreenshotScope ??
          (dependencyReport.screenshotScope === 'full-desktop' && !this.allowFullDesktopCapture
            ? 'unsupported'
            : dependencyReport.screenshotScope),
        fullDesktopCaptureConsented: this.allowFullDesktopCapture,
        launcherPid: runtime.launcherPid,
        ownedProcessIds: [...runtime.ownedProcessIds].sort((a, b) => a - b),
        activeOwnedProcessIds: [...runtime.liveProcessIds].sort((a, b) => a - b),
        processInfo,
        windowInfo: runtime.windowInfo,
        visible: true,
        observationCapability: this.capabilities.observationCapability,
        observationMode: this.runtimeObservation.observationMode,
        lastKnownAction: runtime.lastKnownAction,
        lastHeartbeatAt: runtime.lastHeartbeatAt,
        lastSuccessfulInputAt: runtime.lastSuccessfulInputAt,
        stopEvents: runtime.stopEvents,
        noInjection: true,
        browserSpecific: false
      }
    };
  }

  override async captureLogs(instanceId: string): Promise<LogEntry[]> {
    const runtime = this.desktopInstances.get(instanceId);

    if (!runtime) {
      return this.stoppedInstanceLogs.get(instanceId) ?? super.captureLogs(instanceId);
    }

    return this.logsForRuntime(instanceId, runtime);
  }

  private logsForRuntime(instanceId: string, runtime: DesktopInstanceRuntime): LogEntry[] {
    return runtime.stopEvents.map((event, index) => ({
      id: `${instanceId}-desktop-stop-${index + 1}`,
      level: event.eventType === 'forced_kill_requested' || event.eventType === 'stop_failed' ? 'warn' : 'info',
      message: event.message,
      timestamp: event.timestamp,
      source: this.id
    }));
  }

  private async refreshOwnedProcessIds(runtime: DesktopInstanceRuntime): Promise<void> {
    try {
      const processes = await listSystemProcesses();
      if (runtime.processGroupId !== undefined) {
        const currentGroupMembers = new Set<number>();
        for (const item of processes) {
          if (item.processGroupId === runtime.processGroupId) {
            currentGroupMembers.add(item.pid);
            runtime.ownedProcessIds.add(item.pid);
          }
        }
        runtime.liveProcessIds = currentGroupMembers;
        return;
      }

      const liveKnownIds = new Set(
        [...runtime.liveProcessIds].filter((pid) =>
          processes.some((item) => item.pid === pid)
        )
      );
      if (processes.some((item) => item.pid === runtime.launcherPid)) {
        liveKnownIds.add(runtime.launcherPid);
      }
      const descendants = descendantsOf(processes, liveKnownIds);
      for (const pid of descendants) {
        runtime.ownedProcessIds.add(pid);
      }
      runtime.liveProcessIds = descendants;
    } catch {
      // Keep already observed ownership. Cleanup never expands ownership by process name.
    }
  }

  private liveOwnedProcessIds(runtime: DesktopInstanceRuntime): number[] {
    return [...runtime.liveProcessIds].filter(pidIsAlive);
  }

  private async signalOwnedProcessTree(
    runtime: DesktopInstanceRuntime,
    signal: NodeJS.Signals,
    force: boolean
  ): Promise<void> {
    await this.refreshOwnedProcessIds(runtime);

    if (process.platform === 'win32') {
      const candidates = [
        runtime.launcherPid,
        ...this.liveOwnedProcessIds(runtime).filter((pid) => pid !== runtime.launcherPid)
      ];
      for (const pid of candidates) {
        try {
          await execFileAsync('taskkill.exe', [
            '/PID',
            String(pid),
            '/T',
            ...(force ? ['/F'] : [])
          ]);
        } catch {
          // The explicitly owned process may already have stopped.
        }
      }
      return;
    }

    if (runtime.processGroupId !== undefined) {
      try {
        process.kill(-runtime.processGroupId, signal);
        return;
      } catch {
        // Fall back to only the descendant PIDs observed for this launched instance.
      }
    }

    for (const pid of this.liveOwnedProcessIds(runtime)) {
      try {
        process.kill(pid, signal);
      } catch {
        // The owned process may have stopped after the liveness check.
      }
    }
  }

  private async waitForOwnedProcessesToStop(
    runtime: DesktopInstanceRuntime,
    timeoutMs: number
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await this.refreshOwnedProcessIds(runtime);
      if (this.liveOwnedProcessIds(runtime).length === 0) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    await this.refreshOwnedProcessIds(runtime);
    return this.liveOwnedProcessIds(runtime).length === 0;
  }

  private archiveAndReleaseRuntime(
    instanceId: string,
    runtime: DesktopInstanceRuntime
  ): void {
    this.stoppedInstanceLogs.set(instanceId, this.logsForRuntime(instanceId, runtime));
    if (runtime.ownershipTimer) {
      clearInterval(runtime.ownershipTimer);
      runtime.ownershipTimer = undefined;
    }
    runtime.child?.removeAllListeners();
    runtime.child = undefined;
    this.desktopInstances.delete(instanceId);
  }

  private requireDesktopRuntime(instanceId: string): DesktopInstanceRuntime {
    const runtime = this.desktopInstances.get(instanceId);

    if (!runtime) {
      throw new Error(`Desktop instance "${instanceId}" was not launched by this adapter.`);
    }

    return runtime;
  }

  private shouldFocusBeforeAction(botId: string): boolean {
    if (
      !this.runtimeObservation.showBotGameplay ||
      !this.runtimeObservation.bringGameToFrontOnAction ||
      this.runtimeObservation.observationMode === 'background'
    ) {
      return false;
    }

    if (this.runtimeObservation.observationMode === 'follow-selected-bot') {
      return this.runtimeObservation.selectedBotId === botId;
    }

    if (this.runtimeObservation.observationMode === 'follow-first-bot') {
      this.followedBotId ??= botId;
      return this.followedBotId === botId;
    }

    return true;
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

    if (status === 'succeeded') {
      runtime.lastSuccessfulInputAt = completedAt;
    }

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
