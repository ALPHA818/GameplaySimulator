import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, copyFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import { platform as osPlatform, release as osRelease, tmpdir, version as osVersion } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { chromium, _electron as electron } from 'playwright';
import {
  assertExpectedPackagedState,
  assertSessionReportContainsAction,
  assertSuccessfulPackagedAction
} from './packaged-test-assertions.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const releaseRoot = resolve(projectRoot, 'release');
const packageVersion = JSON.parse(
  await readFile(resolve(projectRoot, 'package.json'), 'utf8')
).version;
const execFileAsync = promisify(execFile);
const sessionId = 'packaged-release-smoke';
const externalGameUrl = process.env.GAMEPLAY_SIMULATOR_RELEASE_SMOKE_GAME_URL?.trim();
const hexcraftReleaseTarget = process.env.GAMEPLAY_SIMULATOR_RELEASE_HEXCRAFT === '1';
const showBotGameplay = process.env.GAMEPLAY_SIMULATOR_RELEASE_SMOKE_VISIBLE === '1';
const forceActionFailure = process.env.GAMEPLAY_SIMULATOR_RELEASE_SMOKE_FORCE_ACTION_FAILURE === '1';
const expectedActionType = hexcraftReleaseTarget ? 'pause' : 'open-menu';
const permittedHexcraftUrl = 'http://127.0.0.1:5173/';

if (hexcraftReleaseTarget && externalGameUrl !== permittedHexcraftUrl) {
  throw new Error(
    `Hexcraft release validation is restricted to ${permittedHexcraftUrl}; received ${externalGameUrl ?? 'no URL'}.`
  );
}

async function findPackagedExecutable() {
  if (process.platform === 'linux') {
    const directory = join(releaseRoot, 'linux-unpacked');
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile() || entry.name.includes('chrome') || entry.name.includes('crashpad')) {
        continue;
      }

      const candidate = join(directory, entry.name);
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Keep looking for the top-level application executable.
      }
    }
  }

  if (process.platform === 'win32') {
    const entries = await readdir(releaseRoot, { withFileTypes: true });
    const executable = entries.find(
      (entry) => entry.isFile() &&
        entry.name === `GameplaySimulator-${packageVersion}-windows-x64.exe`
    );

    if (executable) {
      return join(releaseRoot, executable.name);
    }
  }

  throw new Error(`No distributed GameplaySimulator executable was found for ${process.platform}.`);
}

async function findMatchingFiles(directory, predicate) {
  const matches = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      matches.push(...await findMatchingFiles(entryPath, predicate));
    } else if (entry.isFile() && predicate(entryPath)) {
      matches.push(entryPath);
    }
  }

  return matches;
}

async function startGamePage() {
  const observedState = {
    pageLoads: 0,
    actionCount: 0,
    currentScreen: 'main-menu',
    lastActionType: undefined
  };
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');

    if (request.method === 'POST' && requestUrl.pathname === '/test-action') {
      const chunks = [];
      for await (const chunk of request) {
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (typeof body.type !== 'string' || body.type.length === 0) {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ok: false }));
        return;
      }
      observedState.actionCount += 1;
      observedState.currentScreen = body.type;
      observedState.lastActionType = body.type;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    observedState.pageLoads += 1;
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      connection: 'close'
    });
    response.end(`<!doctype html>
<html>
  <head><title>Packaged GameplaySimulator Test Game</title></head>
  <body>
    <button id="play">Play</button>
    <script>
      window.packagedTestState = { actionCount: 0, currentScreen: 'main-menu' };
      window.__GAMEPLAY_SIM_STATE__ = ({ instanceId, botId }) => ({
        gameId: 'packaged-browser-game',
        sessionId: '${sessionId}',
        instanceId,
        botId,
        scene: window.packagedTestState.currentScreen,
        tick: window.packagedTestState.actionCount,
        timestamp: new Date().toISOString(),
        state: { ...window.packagedTestState }
      });
      window.__GAMEPLAY_SIM_ACTIONS__ = () => [
        { actionType: 'open-menu', label: 'Open Menu' }
      ];
      window.__GAMEPLAY_SIM_PERFORM_ACTION__ = async (action) => {
        if (${JSON.stringify(forceActionFailure)}) {
          return { status: 'failed', message: 'Forced packaged action failure.' };
        }
        if (!action || typeof action.type !== 'string') {
          return { status: 'failed', message: 'The test game received an invalid GameAction.' };
        }
        window.packagedTestState.actionCount += 1;
        window.packagedTestState.currentScreen = action.type;
        const response = await fetch('/test-action', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: action.type })
        });
        if (!response.ok) {
          return { status: 'failed', message: 'The test game could not record the action.' };
        }
        return { status: 'succeeded', message: 'Packaged Chromium action completed.' };
      };
    </script>
  </body>
</html>`);
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });
  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('The packaged browser smoke server did not bind to a port.');
  }

  return {
    url: `http://127.0.0.1:${address.port}/game`,
    getState: () => ({ ...observedState }),
    close: () => new Promise((resolveClose, rejectClose) => {
      server.closeAllConnections?.();
      server.close((error) => error ? rejectClose(error) : resolveClose());
    })
  };
}

async function startInstrumentedExample() {
  const serverPath = resolve(
    projectRoot,
    'examples/instrumented-test-server/src/server.ts'
  );
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', serverPath, '--host=127.0.0.1', '--port=0'],
    {
      cwd: projectRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true
    }
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  let endpoint;
  try {
    endpoint = await waitForCondition(() => {
      const match = stdout.match(/Fake instrumented game server running at (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) {
        return match[1];
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(
          `The instrumented example exited before becoming ready.\nstdout:\n${stdout}\nstderr:\n${stderr}`
        );
      }
      return undefined;
    }, 'the existing instrumented example server to start');
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
    throw error;
  }

  return {
    endpoint,
    async getState(instanceId = 'game-instance-001') {
      const response = await fetch(
        `${endpoint}/gsi/v1/state?instanceId=${encodeURIComponent(instanceId)}&botId=release-check`
      );
      if (!response.ok) {
        throw new Error(`Instrumented example state request failed with HTTP ${response.status}.`);
      }
      return response.json();
    },
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      child.kill('SIGTERM');
      await Promise.race([
        new Promise((resolveExit) => child.once('exit', resolveExit)),
        new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5_000))
      ]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await new Promise((resolveExit) => child.once('exit', resolveExit));
      }
    }
  };
}

function profileFor(url) {
  const usesExternalGame = Boolean(externalGameUrl);

  return {
    gameId: hexcraftReleaseTarget ? 'hexcraft-local-release-target' : 'packaged-browser-game',
    gameName: hexcraftReleaseTarget ? 'Hexcraft Local Development Build' : 'Packaged Browser Game',
    version: hexcraftReleaseTarget ? 'development' : '0.1.0',
    buildId: hexcraftReleaseTarget ? 'local-permitted-release-validation' : 'packaged-smoke',
    engine: { type: 'browser' },
    launch: {
      platform: 'browser',
      url,
      arguments: []
    },
    adapter: {
      type: 'browser',
      browserName: 'chromium',
      browserDomScanMode: 'fallback',
      supportsMultipleInstances: true,
      supportsStateRead: hexcraftReleaseTarget || !usesExternalGame,
      supportsDirectActions: !usesExternalGame,
      supportsScreenshots: true,
      supportsVideo: false,
      supportsSaveIsolation: true
    },
    controls: usesExternalGame
      ? [
          {
            controlId: 'pause',
            label: 'Pause',
            inputType: 'keyboard',
            binding: hexcraftReleaseTarget ? 'Escape' : 'P',
            action: 'pause',
            metadata: {}
          },
          {
            controlId: 'open-inventory',
            label: 'Open Inventory',
            inputType: 'keyboard',
            binding: 'E',
            action: 'open-inventory',
            metadata: {}
          }
        ]
      : [],
    testingTargets: [],
    progressSignals: [],
    failureSignals: [],
    uiFlows: hexcraftReleaseTarget
      ? [
          {
            flowId: 'hexcraft-create-world',
            name: 'Create Hexcraft World',
            description: 'Move from the Hexcraft main menu into a locally controlled test world.',
            startState: 'main-menu',
            endState: 'gameplay',
            steps: [
              {
                stepId: 'choose-create-world',
                expectedScreen: 'main-menu',
                actionType: 'click-create-new-world',
                targetLabel: 'Create New World',
                waitAfterMs: 250,
                successCondition: 'The Create New World screen is visible.',
                maxRetries: 2
              },
              {
                stepId: 'start-world',
                expectedScreen: 'create-new-world',
                actionType: 'click-start-world',
                targetLabel: 'Start World',
                waitAfterMs: 750,
                successCondition: 'Hexcraft enters gameplay.',
                maxRetries: 2
              }
            ]
          }
        ]
      : [],
    knownContent: {
      scenes: hexcraftReleaseTarget
        ? ['main-menu', 'create-new-world', 'gameplay', 'pause-menu']
        : ['main-menu', 'open-menu'],
      levels: [],
      locations: [],
      characters: [],
      npcs: [],
      items: [],
      quests: [],
      mainQuests: [],
      sideQuests: [],
      optionalStories: [],
      shops: [],
      bosses: [],
      menus: ['main-menu'],
      dialogueBranches: [],
      minigames: [],
      endings: [],
      hiddenAreas: [],
      postGameContent: [],
      collectibles: [],
      achievements: [],
      mechanics: [],
      notes: []
    }
  };
}

function invalidBrowserProfile() {
  return {
    ...profileFor('http://127.0.0.1:9/unreachable'),
    gameId: 'packaged-invalid-browser-game',
    gameName: 'Invalid Browser Profile'
  };
}

function invalidDesktopProfile() {
  return {
    ...profileFor('http://127.0.0.1:9/unused'),
    gameId: 'packaged-invalid-desktop-game',
    gameName: 'Invalid Desktop Profile',
    engine: { type: 'unknown' },
    launch: {
      platform: process.platform === 'win32' ? 'windows' : 'linux',
      executablePath: process.platform === 'win32'
        ? 'C:\\GameplaySimulator\\missing-game.exe'
        : '/tmp/gameplay-simulator-missing-game',
      workingDirectory: process.platform === 'win32' ? 'C:\\GameplaySimulator' : '/tmp',
      arguments: []
    },
    adapter: {
      type: 'desktop',
      supportsMultipleInstances: false,
      supportsStateRead: false,
      supportsDirectActions: false,
      supportsScreenshots: false,
      supportsVideo: false,
      supportsSaveIsolation: false
    },
    controls: [
      {
        controlId: 'menu',
        label: 'Menu',
        inputType: 'keyboard',
        binding: 'Escape',
        action: 'open-menu',
        metadata: {}
      }
    ]
  };
}

function instrumentedProfileFor(endpoint) {
  return {
    gameId: 'fake-instrumented-game',
    gameName: 'Packaged Instrumented Example',
    version: '0.1.0',
    buildId: 'packaged-instrumented-smoke',
    engine: { type: 'custom', version: 'example-server' },
    launch: {
      platform: process.platform === 'win32' ? 'windows' : 'linux',
      arguments: []
    },
    adapter: {
      type: 'instrumented',
      instrumentationEndpoint: endpoint,
      instrumentationTransport: 'local-http',
      supportsMultipleInstances: true,
      supportsStateRead: true,
      supportsDirectActions: true,
      supportsScreenshots: false,
      supportsVideo: false,
      supportsSaveIsolation: true
    },
    controls: [],
    testingTargets: [],
    progressSignals: [],
    failureSignals: [],
    uiFlows: [],
    knownContent: {
      scenes: ['Start Area', 'Hidden Grotto'],
      levels: [],
      locations: [],
      characters: [],
      npcs: [],
      items: ['health-potion'],
      quests: ['qa-intro'],
      mainQuests: [],
      sideQuests: [],
      optionalStories: [],
      shops: [],
      bosses: [],
      menus: ['pause-menu'],
      dialogueBranches: [],
      minigames: [],
      endings: [],
      hiddenAreas: ['Hidden Grotto'],
      postGameContent: [],
      collectibles: [],
      achievements: [],
      mechanics: [],
      notes: []
    }
  };
}

const botProfile = {
  profileId: 'packaged-smoke-bot',
  displayName: 'Packaged Smoke Bot',
  botType: 'ui-tester',
  profileGroup: 'custom',
  specializationCategory: 'ui-input',
  playstyle: 'ui-tester',
  description: 'Runs one controlled action through packaged Chromium.',
  preferredActions: externalGameUrl ? ['pause', 'open-inventory'] : ['open-menu'],
  avoidedActions: [],
  requiredCapabilities: hexcraftReleaseTarget
    ? ['state-read', 'screenshots']
    : ['state-read', 'direct-actions', 'screenshots'],
  recommendedGameTypes: ['browser'],
  limitations: [],
  goals: [],
  recommendedMinCount: 1,
  recommendedMaxCount: 1,
  defaultResourceWeight: 'light',
  defaultEnabled: false,
  tags: ['release-smoke'],
  config: {}
};

const instrumentedBotProfile = {
  profileId: 'packaged-instrumented-bot',
  displayName: 'Packaged Instrumented Bot',
  botType: 'explorer',
  profileGroup: 'custom',
  specializationCategory: 'gameplay-systems',
  playstyle: 'explorer',
  description: 'Runs one reported action through the packaged Local HTTP adapter.',
  preferredActions: ['move-forward'],
  avoidedActions: ['trigger-crash', 'trigger-stuck'],
  requiredCapabilities: ['state-read', 'direct-actions'],
  recommendedGameTypes: ['custom'],
  limitations: [],
  goals: [],
  recommendedMinCount: 1,
  recommendedMaxCount: 1,
  defaultResourceWeight: 'light',
  defaultEnabled: false,
  tags: ['release-smoke'],
  config: {}
};

function runConfig() {
  return {
    sessionId,
    sessionName: `Packaged API ${showBotGameplay ? 'visible' : 'background'} smoke`,
    sessionLabel: 'Smoke Test',
    gameProfilePath: `memory://game-profiles/${hexcraftReleaseTarget ? 'hexcraft-local-release-target' : 'packaged-browser-game'}`,
    adapterType: 'browser',
    runMode: 'parallel',
    runUntilStopped: false,
    maxRuntimeMinutes: 1,
    stopOnCriticalIssue: false,
    saveScreenshots: true,
    screenshotEveryNActions: 1,
    saveVideo: false,
    saveActionTimeline: true,
    saveStateSnapshots: true,
    useMockRuntime: false,
    showBotGameplay,
    observationMode: showBotGameplay ? 'follow-first-bot' : 'background',
    bringGameToFrontOnAction: false,
    visibleActionDelayMs: 0,
    showActionInformation: true,
    maxVisibleGameWindows: 1,
    botPools: [
      {
        profileId: botProfile.profileId,
        enabled: true,
        minCount: 1,
        desiredCount: 1,
        maxCount: 1,
        scalingMode: 'fixed',
        priority: 10,
        resourceWeight: 'light'
      }
    ],
    globalBotLimit: 1,
    perGameInstanceBotLimit: 1,
    actionDelayMs: 10,
    maxActionsPerBot: hexcraftReleaseTarget ? 3 : 1,
    startupFlowId: hexcraftReleaseTarget ? 'hexcraft-create-world' : undefined,
    startupFlowTimeoutMs: hexcraftReleaseTarget ? 60_000 : undefined,
    continueOnStartupFlowFailure: false,
    directives: hexcraftReleaseTarget
      ? [
          {
            directiveId: 'hexcraft-open-pause-menu',
            sessionId,
            name: 'Open the Hexcraft pause menu',
            description: 'After the startup flow reaches gameplay, use the reported Pause control once.',
            directiveType: 'action',
            directiveMode: 'force-next-valid-action',
            priority: 'urgent',
            status: 'queued',
            target: {
              allBots: false,
              botIds: [],
              profileIds: [botProfile.profileId],
              gameInstanceIds: []
            },
            actionKeywords: ['pause'],
            avoidedActionKeywords: [],
            successConditions: ['The pause action succeeds and the pause menu is observed.'],
            failureConditions: [],
            steps: [],
            maxActions: 1,
            maxAttempts: 1,
            timeoutMs: 20_000,
            repeatUntilSuccess: false,
            createdAt: new Date().toISOString(),
            createdBy: 'packaged-hexcraft-release-test'
          }
        ]
      : undefined,
    resourceLimits: {
      maxCpuPercent: 90,
      maxRamPercent: 90,
      reserveRamMb: 256,
      maxGameInstances: 1,
      allowAutoScaling: false
    }
  };
}

function instrumentedRunConfig() {
  return {
    ...runConfig(),
    sessionId: 'packaged-instrumented-release-smoke',
    sessionName: 'Packaged Local HTTP instrumented smoke',
    gameProfilePath: 'memory://game-profiles/fake-instrumented-game',
    adapterType: 'instrumented',
    startupFlowId: undefined,
    startupFlowTimeoutMs: undefined,
    maxActionsPerBot: 1,
    saveScreenshots: false,
    screenshotEveryNActions: undefined,
    showBotGameplay: false,
    observationMode: 'background',
    showActionInformation: false,
    directives: [
      {
        directiveId: 'packaged-instrumented-move-forward',
        sessionId: 'packaged-instrumented-release-smoke',
        name: 'Move forward through Local HTTP',
        description: 'Use the move-forward action reported by the instrumented example.',
        directiveType: 'action',
        directiveMode: 'force-next-valid-action',
        priority: 'urgent',
        status: 'queued',
        target: {
          allBots: false,
          botIds: [],
          profileIds: [instrumentedBotProfile.profileId],
          gameInstanceIds: []
        },
        actionKeywords: ['move-forward'],
        avoidedActionKeywords: [],
        successConditions: ['The move-forward action succeeds.'],
        failureConditions: [],
        steps: [],
        repeatUntilSuccess: false,
        createdAt: new Date().toISOString(),
        createdBy: 'packaged-release-test'
      }
    ],
    botPools: [
      {
        profileId: instrumentedBotProfile.profileId,
        enabled: true,
        minCount: 1,
        desiredCount: 1,
        maxCount: 1,
        scalingMode: 'fixed',
        priority: 10,
        resourceWeight: 'light'
      }
    ]
  };
}

async function launchApplication(executablePath, userDataPath) {
  const env = {
    ...process.env,
    GAMEPLAY_SIMULATOR_RELEASE_SMOKE_TEST: '1',
    GAMEPLAY_SIMULATOR_RELEASE_SMOKE_USER_DATA: userDataPath
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_DISABLE_SANDBOX;
  delete env.APPIMAGE_EXTRACT_AND_RUN;

  if (process.platform === 'win32') {
    return launchWindowsPortableApplication(executablePath, userDataPath, env);
  }

  return electron.launch({
    executablePath,
    env
  });
}

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
  if (!address || typeof address === 'string') {
    throw new Error('Could not reserve a loopback port for the packaged Windows UI test.');
  }
  return address.port;
}

async function launchWindowsPortableApplication(executablePath, userDataPath, env) {
  const debugPort = await reserveLoopbackPort();
  const launcher = spawn(
    executablePath,
    [`--remote-debugging-address=127.0.0.1`, `--remote-debugging-port=${debugPort}`],
    {
      env,
      stdio: 'ignore',
      windowsHide: false
    }
  );
  let launchError;
  launcher.once('error', (error) => {
    launchError = error;
  });
  launcher.once('exit', (code) => {
    if (code !== null && code !== 0) {
      launchError = new Error(`The Windows portable launcher exited with code ${code}.`);
    }
  });

  await waitForCondition(async () => {
    if (launchError) {
      throw launchError;
    }
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      return response.ok;
    } catch {
      return false;
    }
  }, 'the distributed Windows portable renderer to expose its test-only DevTools endpoint', 180_000);

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  let closed = false;

  return {
    async firstWindow() {
      return waitForCondition(
        async () => browser.contexts().flatMap((context) => context.pages())[0],
        'the distributed Windows portable application window',
        30_000
      );
    },
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      const pages = browser.contexts().flatMap((context) => context.pages());
      await Promise.allSettled(pages.map((page) => page.close({ runBeforeUnload: true })));
      await browser.close().catch(() => undefined);
      await waitForCondition(async () => {
        try {
          const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
          return !response.ok;
        } catch {
          return true;
        }
      }, 'the distributed Windows portable application to close', 30_000);
    }
  };
}

async function waitForCondition(check, description, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;

  while (Date.now() < deadline) {
    lastValue = await check();
    if (lastValue) {
      return lastValue;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }

  throw new Error(`Timed out waiting for ${description}. Last value: ${JSON.stringify(lastValue)}`);
}

async function removeTemporaryDirectory(directory) {
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: process.platform === 'win32' ? 20 : 0,
    retryDelay: 250
  });
}

async function findPackagedChromiumProcesses() {
  if (process.platform === 'win32') {
    const command = [
      "$items = Get-CimInstance Win32_Process | Where-Object {",
      "  $_.Name -match '^(chrome|chromium).*\\.exe$' -and",
      "  $_.CommandLine -like '*\\resources\\playwright\\*'",
      "} | Select-Object ProcessId, CommandLine",
      '@($items) | ConvertTo-Json -Compress'
    ].join('\n');
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true }
    );
    const parsed = stdout.trim() ? JSON.parse(stdout) : [];
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  if (process.platform !== 'linux') {
    return [];
  }

  const entries = await readdir('/proc', { withFileTypes: true });
  const matches = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) {
      continue;
    }
    try {
      const commandLine = (await readFile(join('/proc', entry.name, 'cmdline')))
        .toString('utf8')
        .replaceAll('\0', ' ');
      if (
        commandLine.includes('/resources/playwright/') &&
        /(?:^|\s)(?:.*\/)?(?:chrome|chromium)(?:\s|$)/i.test(commandLine)
      ) {
        matches.push({ pid: Number(entry.name), commandLine });
      }
    } catch {
      // A process may exit while /proc is being inspected.
    }
  }

  return matches;
}

async function findPackagedApplicationProcesses() {
  if (process.platform !== 'win32') {
    return [];
  }

  const command = [
    "$items = Get-CimInstance Win32_Process | Where-Object {",
    "  $_.Name -like 'GameplaySimulator*.exe'",
    '} | Select-Object ProcessId, Name, CommandLine',
    '@($items) | ConvertTo-Json -Compress'
  ].join('\n');
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', command],
    { windowsHide: true }
  );
  const parsed = stdout.trim() ? JSON.parse(stdout) : [];
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function windowsAuthenticodeStatus(artifactPath) {
  if (process.platform !== 'win32') {
    return undefined;
  }

  const command = [
    '$signature = Get-AuthenticodeSignature -LiteralPath $env:GAMEPLAY_SIMULATOR_ARTIFACT',
    "[PSCustomObject]@{ Status = $signature.Status.ToString(); StatusMessage = $signature.StatusMessage; Signer = $signature.SignerCertificate.Subject } | ConvertTo-Json -Compress"
  ].join('\n');
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', command],
    {
      env: {
        ...process.env,
        GAMEPLAY_SIMULATOR_ARTIFACT: artifactPath
      },
      windowsHide: true
    }
  );
  return stdout.trim() ? JSON.parse(stdout) : { Status: 'Unknown' };
}

async function windowsLaunchIdentity() {
  if (process.platform !== 'win32') {
    return undefined;
  }

  const command = [
    '$identity = [Security.Principal.WindowsIdentity]::GetCurrent()',
    '$principal = [Security.Principal.WindowsPrincipal]::new($identity)',
    '$isElevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
    "[PSCustomObject]@{ User = $identity.Name; Elevated = $isElevated } | ConvertTo-Json -Compress"
  ].join('\n');
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', command],
    { windowsHide: true }
  );
  return stdout.trim() ? JSON.parse(stdout) : { User: 'Unknown', Elevated: 'Unknown' };
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  await new Promise((resolveHash, rejectHash) => {
    const stream = createReadStream(filePath);
    stream.once('error', rejectHash);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('end', resolveHash);
  });
  return hash.digest('hex');
}

const requestedExecutable = process.argv[2]
  ? resolve(projectRoot, process.argv[2])
  : undefined;
const sourceExecutablePath = requestedExecutable ?? await findPackagedExecutable();
let portableCopyRoot;
let executablePath = sourceExecutablePath;

if (process.platform === 'win32') {
  const expectedPortableName = `GameplaySimulator-${packageVersion}-windows-x64.exe`;
  if (basename(sourceExecutablePath) !== expectedPortableName) {
    throw new Error(
      `Windows packaged validation requires ${expectedPortableName}, not ${basename(sourceExecutablePath)}.`
    );
  }
  portableCopyRoot = await mkdtemp(join(tmpdir(), 'GameplaySimulator Portable Path With Spaces '));
  executablePath = join(portableCopyRoot, basename(sourceExecutablePath));
  await copyFile(sourceExecutablePath, executablePath);
}

const userDataPath = await mkdtemp(join(tmpdir(), 'GameplaySimulator Packaged User Data '));
const gamePage = externalGameUrl
  ? {
      url: externalGameUrl,
      getState: () => undefined,
      close: async () => undefined
    }
  : await startGamePage();
const selectedGameProfile = profileFor(gamePage.url);
const instrumentedExample = await startInstrumentedExample();
let firstApplication;
let secondApplication;
let thirdApplication;
let fourthApplication;
let fifthApplication;

try {
  firstApplication = await launchApplication(executablePath, userDataPath);
  const firstWindow = await firstApplication.firstWindow();
  await firstWindow.waitForFunction(
    () => !document.body.textContent?.includes('Loading workspace')
  );
  const firstResult = await firstWindow.evaluate(async ({
    gameProfile,
    bot,
    config,
    requireHexcraftEvidence,
    instrumentedGameProfile,
    instrumentedBot,
    instrumentedConfig,
    badBrowserProfile,
    badDesktopProfile
  }) => {
    const workspace = await window.gameplaySimulator.workspace.load();
    try {
      await window.gameplaySimulator.workspace.save({
        ...workspace.data,
        gameProfiles: [gameProfile, instrumentedGameProfile],
        customBotProfiles: [bot, instrumentedBot],
        runConfigs: [config, instrumentedConfig],
        lastValidatedRunConfig: config
      });
    } catch (error) {
      throw new Error(`Workspace save failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    let invalidBrowserResult;
    let invalidDesktopResult;
    try {
      invalidBrowserResult = await window.gameplaySimulator.simulation.testGameProfile({
        gameProfile: badBrowserProfile,
        showTestWindow: false
      });
      invalidDesktopResult = await window.gameplaySimulator.simulation.testGameProfile({
        gameProfile: badDesktopProfile,
        showTestWindow: false
      });
    } catch (error) {
      throw new Error(`Invalid-profile checks failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    let created;
    try {
      created = await window.gameplaySimulator.simulation.createSession({
        runConfig: config,
        gameProfile,
        botProfiles: [bot]
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${message} Renderer profile flow IDs: ${JSON.stringify(gameProfile.uiFlows?.map((flow) => flow.flowId) ?? [])}.`
      );
    }
    const runtimeSessionId = created.sessionId;
    const started = await window.gameplaySimulator.simulation.startSession(runtimeSessionId);
    const initialObservation =
      await window.gameplaySimulator.simulation.getLiveObservationState(runtimeSessionId);

    const deadline = Date.now() + 20_000;
    let botStatuses = [];
    let status = started;
    while (Date.now() < deadline) {
      botStatuses = await window.gameplaySimulator.simulation.getBotStatuses(runtimeSessionId);
      status = await window.gameplaySimulator.simulation.getSessionStatus(runtimeSessionId);
      const normalBotCompletedAction = botStatuses.some(
        (botStatus) => botStatus.profileId === bot.profileId && Boolean(botStatus.lastResult)
      );
      let requiredStateObserved = !requireHexcraftEvidence;
      if (requireHexcraftEvidence && normalBotCompletedAction) {
        const runtimeLogs = await window.gameplaySimulator.simulation.getStructuredLogs(
          runtimeSessionId,
          { limit: 500 }
        );
        requiredStateObserved = runtimeLogs.logs.some(
          (log) => log.eventType === 'state_snapshot' && log.raw?.payload?.scene === 'pause-menu'
        );
      }
      if (
        (normalBotCompletedAction && requiredStateObserved) ||
        status.status === 'stopped' ||
        status.status === 'failed'
      ) {
        break;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }

    if (botStatuses.some((botStatus) => Boolean(botStatus.lastResult))) {
      const artifactDeadline = Date.now() + 10_000;
      while (Date.now() < artifactDeadline) {
        const structured = await window.gameplaySimulator.simulation.getStructuredLogs(
          runtimeSessionId,
          { limit: 500 }
        );
        const actionWasLogged = structured.logs.some(
          (log) => log.eventType === 'action_performed'
        );
        const screenshotWasLogged = structured.logs.some(
          (log) => typeof log.raw?.payload?.screenshotPath === 'string'
        );
        if (actionWasLogged && screenshotWasLogged) {
          break;
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      }
    }

    if (['created', 'starting', 'running', 'paused'].includes(status.status)) {
      status = await window.gameplaySimulator.simulation.stopSession(runtimeSessionId);
    }
    if (status.status === 'stopping') {
      const stopDeadline = Date.now() + 20_000;
      while (Date.now() < stopDeadline && status.status === 'stopping') {
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
        status = await window.gameplaySimulator.simulation.getSessionStatus(runtimeSessionId);
      }
    }
    if (!['stopped', 'failed'].includes(status.status)) {
      throw new Error(`The packaged browser session did not reach a terminal state: ${JSON.stringify(status)}`);
    }

    const instrumentedCreated = await window.gameplaySimulator.simulation.createSession({
      runConfig: instrumentedConfig,
      gameProfile: instrumentedGameProfile,
      botProfiles: [instrumentedBot]
    });
    const instrumentedSessionId = instrumentedCreated.sessionId;
    const instrumentedStarted = await window.gameplaySimulator.simulation.startSession(
      instrumentedSessionId
    );
    const instrumentedDeadline = Date.now() + 20_000;
    let instrumentedStatus = instrumentedStarted;
    let instrumentedBots = [];
    while (Date.now() < instrumentedDeadline) {
      instrumentedBots = await window.gameplaySimulator.simulation.getBotStatuses(
        instrumentedSessionId
      );
      instrumentedStatus = await window.gameplaySimulator.simulation.getSessionStatus(
        instrumentedSessionId
      );
      if (
        instrumentedBots.some((botStatus) => Boolean(botStatus.lastResult)) ||
        ['stopped', 'failed'].includes(instrumentedStatus.status)
      ) {
        break;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    if (['created', 'starting', 'running', 'paused'].includes(instrumentedStatus.status)) {
      instrumentedStatus = await window.gameplaySimulator.simulation.stopSession(
        instrumentedSessionId
      );
    }
    if (instrumentedStatus.status === 'stopping') {
      const stopDeadline = Date.now() + 20_000;
      while (Date.now() < stopDeadline && instrumentedStatus.status === 'stopping') {
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
        instrumentedStatus = await window.gameplaySimulator.simulation.getSessionStatus(
          instrumentedSessionId
        );
      }
    }
    if (!['stopped', 'failed'].includes(instrumentedStatus.status)) {
      throw new Error(
        `The packaged instrumented session did not reach a terminal state: ${JSON.stringify(instrumentedStatus)}`
      );
    }
    const instrumentedLogs = await window.gameplaySimulator.simulation.getStructuredLogs(
      instrumentedSessionId,
      { limit: 500 }
    );

    return {
      runtimeSessionId,
      createdStatus: created.status,
      started,
      status,
      sessions: await window.gameplaySimulator.simulation.listSessions(),
      botStatuses,
      instances: await window.gameplaySimulator.simulation.getInstanceStatuses(runtimeSessionId),
      structuredLogs: await window.gameplaySimulator.simulation.getStructuredLogs(
        runtimeSessionId,
        { limit: 500 }
      ),
      instrumented: {
        runtimeSessionId: instrumentedSessionId,
        createdStatus: instrumentedCreated.status,
        started: instrumentedStarted,
        status: instrumentedStatus,
        botStatuses: instrumentedBots,
        structuredLogs: instrumentedLogs
      },
      initialObservation,
      invalidBrowserResult,
      invalidDesktopResult
    };
  }, {
    gameProfile: selectedGameProfile,
    bot: botProfile,
    config: runConfig(),
    requireHexcraftEvidence: hexcraftReleaseTarget,
    instrumentedGameProfile: instrumentedProfileFor(instrumentedExample.endpoint),
    instrumentedBot: instrumentedBotProfile,
    instrumentedConfig: instrumentedRunConfig(),
    badBrowserProfile: invalidBrowserProfile(),
    badDesktopProfile: invalidDesktopProfile()
  });

  for (const [label, result] of [
    ['invalid browser URL', firstResult.invalidBrowserResult],
    ['invalid desktop executable', firstResult.invalidDesktopResult]
  ]) {
    if (result.ok || result.status !== 'failed' || result.errors.length === 0) {
      throw new Error(`The ${label} did not return a readable profile error: ${JSON.stringify(result)}`);
    }
  }
  if (firstResult.status?.status !== 'stopped') {
    const diagnosticLogs = firstResult.structuredLogs.logs.filter((log) =>
      ['error', 'warn'].includes(log.level) ||
      ['adapter_launch_failed', 'instance_crash', 'instance_health_warning', 'session_failed']
        .includes(log.eventType)
    ).slice(-30);
    throw new Error(
      `Packaged browser session did not stop successfully: ${JSON.stringify({
        status: firstResult.status,
        started: firstResult.started,
        botStatuses: firstResult.botStatuses,
        instances: firstResult.instances,
        diagnosticLogs
      })}`
    );
  }
  if (firstResult.createdStatus.status !== 'created' || firstResult.started.status !== 'running') {
    throw new Error(
      `Packaged profile/session creation did not succeed: ${JSON.stringify({
        created: firstResult.createdStatus,
        started: firstResult.started
      })}`
    );
  }
  if (
    firstResult.instrumented.createdStatus.status !== 'created' ||
    firstResult.instrumented.started.status !== 'running' ||
    firstResult.instrumented.status.status !== 'stopped'
  ) {
    throw new Error(
      `The packaged instrumented session did not complete successfully: ${JSON.stringify(firstResult.instrumented)}`
    );
  }
  assertSuccessfulPackagedAction({
    botStatuses: firstResult.instrumented.botStatuses,
    structuredLogs: firstResult.instrumented.structuredLogs.logs,
    expectedActionType: 'move-forward'
  });
  const instrumentedState = await instrumentedExample.getState();
  if (instrumentedState.playerPosition?.y !== 1) {
    throw new Error(
      `The packaged instrumented action did not change the example state: ${JSON.stringify(instrumentedState)}`
    );
  }
  const directSession = firstResult.sessions.find(
    (session) => session.sessionId === firstResult.runtimeSessionId
  );
  if (!directSession) {
    throw new Error('Packaged session metadata was not saved.');
  }
  const instrumentedSession = firstResult.sessions.find(
    (session) => session.sessionId === firstResult.instrumented.runtimeSessionId
  );
  if (!instrumentedSession) {
    throw new Error('The packaged instrumented session metadata was not saved.');
  }
  if (!externalGameUrl && gamePage.getState().pageLoads < 1) {
    throw new Error('The packaged browser game page was never opened.');
  }
  if (!externalGameUrl) {
    assertSuccessfulPackagedAction({
      botStatuses: firstResult.botStatuses,
      structuredLogs: firstResult.structuredLogs.logs,
      expectedActionType
    });
    assertExpectedPackagedState(gamePage.getState(), expectedActionType);
  }
  if (hexcraftReleaseTarget) {
    assertSuccessfulPackagedAction({
      botStatuses: firstResult.botStatuses,
      structuredLogs: firstResult.structuredLogs.logs,
      expectedActionType
    });
    const requiredStartupActions = ['click-create-new-world', 'click-start-world'];
    for (const actionType of requiredStartupActions) {
      const actionLog = firstResult.structuredLogs.logs.find(
        (log) => log.eventType === 'action_performed' &&
          log.raw?.payload?.actionType === actionType &&
          log.raw?.payload?.status === 'succeeded'
      );
      if (!actionLog) {
        const startupLogs = firstResult.structuredLogs.logs.filter(
          (log) => log.botId === 'startup-flow-001' ||
            ['flow_started', 'flow_step_started', 'flow_step_failed', 'flow_completed', 'flow_abandoned'].includes(log.eventType)
        );
        throw new Error(
          `Hexcraft startup flow did not complete action ${actionType}: ${JSON.stringify({
            botStatuses: firstResult.botStatuses,
            startupLogs
          })}`
        );
      }
    }
    const pauseState = firstResult.structuredLogs.logs.find(
      (log) => log.eventType === 'state_snapshot' && log.raw?.payload?.scene === 'pause-menu'
    );
    if (!pauseState) {
      throw new Error('Hexcraft did not expose the pause-menu state after the guided pause action.');
    }
  }
  const launchedInstance = firstResult.instances[0];
  if (!launchedInstance || launchedInstance.status !== 'stopped') {
    throw new Error(
      `The packaged browser instance did not close cleanly: ${JSON.stringify(firstResult.instances)}`
    );
  }
  const structuredEventTypes = firstResult.structuredLogs.logs.map((log) => log.eventType);
  if (showBotGameplay && firstResult.initialObservation.badge !== 'Watching') {
    throw new Error(
      `The packaged browser session did not launch visibly: ${JSON.stringify({
        instances: firstResult.instances,
        observation: firstResult.initialObservation
      })}`
    );
  }
  if (showBotGameplay && !structuredEventTypes.includes('visible_window_started')) {
    throw new Error('The visible packaged browser did not log visible_window_started.');
  }
  if (showBotGameplay && !structuredEventTypes.includes('visible_window_stopped')) {
    throw new Error('The visible packaged browser did not log visible_window_stopped.');
  }
  if (!showBotGameplay && structuredEventTypes.includes('visible_window_started')) {
    throw new Error('The background packaged browser unexpectedly opened a visible window.');
  }

  await waitForCondition(
    async () => (await findPackagedChromiumProcesses()).length === 0,
    'the packaged Chromium process to close',
    10_000
  );

  const directSessionDirectory = directSession.reportPaths.sessionDirectory;
  const directSummaryPath = directSession.reportPaths.summaryMarkdown ??
    join(directSessionDirectory, 'session-summary.md');
  const directSummary = await readFile(directSummaryPath, 'utf8');
  if (!externalGameUrl || hexcraftReleaseTarget) {
    assertSessionReportContainsAction(directSummary, expectedActionType);
  }
  const instrumentedSummaryPath = instrumentedSession.reportPaths.summaryMarkdown ??
    join(instrumentedSession.reportPaths.sessionDirectory, 'session-summary.md');
  const instrumentedSummary = await readFile(instrumentedSummaryPath, 'utf8');
  assertSessionReportContainsAction(instrumentedSummary, 'move-forward');
  const savedScreenshots = await findMatchingFiles(
    directSessionDirectory,
    (path) => path.toLowerCase().endsWith('.png')
  );
  if (savedScreenshots.length === 0) {
    const screenshotLogs = firstResult.structuredLogs.logs.filter(
      (log) => typeof log.raw?.payload?.screenshotPath === 'string' ||
        log.raw?.payload?.evidence === 'fallback_screenshot'
    );
    throw new Error(
      `The packaged browser session did not save real PNG screenshot evidence: ${JSON.stringify(screenshotLogs)}`
    );
  }

  await firstApplication.close();
  firstApplication = undefined;
  const workspacePath = join(userDataPath, 'workspace', 'workspace-v1.json');
  const savedWorkspace = JSON.parse(await readFile(workspacePath, 'utf8'));
  if (!savedWorkspace.gameProfiles?.some(
    (profile) => profile.gameId === selectedGameProfile.gameId
  )) {
    throw new Error(`The packaged app did not write workspace data to ${workspacePath}.`);
  }

  secondApplication = await launchApplication(executablePath, userDataPath);
  const secondWindow = await secondApplication.firstWindow();
  await secondWindow.waitForFunction(
    () => !document.body.textContent?.includes('Loading workspace')
  );
  const mainNavigation = secondWindow.getByRole('navigation', { name: 'Main', exact: true });
  await mainNavigation.getByRole('button', { name: 'Game Profiles', exact: true }).click();
  await secondWindow.getByRole('heading', { name: 'Game Profiles', exact: true }).waitFor();
  const packagedProfileRow = secondWindow.locator('.table-row').filter({
    hasText: selectedGameProfile.gameName
  });
  if (await packagedProfileRow.count() === 0) {
    throw new Error('The packaged UI did not show the saved browser game profile.');
  }

  await mainNavigation.getByRole('button', { name: 'New Session', exact: true }).click();
  await secondWindow.getByRole('heading', { name: 'New Session', exact: true }).waitFor();
  await secondWindow.getByLabel('Game Profile', { exact: true }).selectOption(selectedGameProfile.gameId);
  await secondWindow.getByLabel('Session Name', { exact: true }).fill(
    `Packaged UI Journey ${showBotGameplay ? 'visible' : 'background'}`
  );
  await secondWindow.getByLabel('Action Delay Ms', { exact: true }).fill('1000');
  await secondWindow.getByLabel('Max Actions Per Bot', { exact: true }).fill('10');
  await secondWindow.getByLabel('Screenshot Every N Actions', { exact: true }).fill('1');
  await secondWindow.getByLabel('CPU Percent', { exact: true }).fill('95');
  await secondWindow.getByLabel('RAM Percent', { exact: true }).fill('95');
  await secondWindow.getByLabel('Reserve RAM MB', { exact: true }).fill('256');

  const useGlobalObservation = secondWindow.getByLabel(
    'Use Global Observation Settings',
    { exact: true }
  );
  if (await useGlobalObservation.isChecked()) {
    await useGlobalObservation.uncheck();
  }
  const showGameplay = secondWindow.getByLabel('Show Bot Gameplay', { exact: true });
  if (showBotGameplay && !(await showGameplay.isChecked())) {
    await showGameplay.check();
  } else if (!showBotGameplay && await showGameplay.isChecked()) {
    await showGameplay.uncheck();
  }
  if (showBotGameplay) {
    await secondWindow.getByLabel('Visible Action Delay', { exact: true }).fill('0');
  }

  await secondWindow.getByText('Requested bots', { exact: true }).waitFor();
  await waitForCondition(
    async () => !(await secondWindow.locator('.notice-list--blocker').isVisible()),
    'the UI viability blockers to clear'
  );
  const runAnyway = secondWindow.getByLabel('Run anyway', { exact: true });
  if (await runAnyway.isVisible() && !(await runAnyway.isChecked())) {
    await runAnyway.check();
  }
  await secondWindow.getByRole('button', { name: 'Start Session', exact: true }).click();
  const openLiveSession = secondWindow.getByRole('button', {
    name: 'Open Live Session',
    exact: true
  });
  try {
    await openLiveSession.waitFor({ timeout: 30_000 });
  } catch (error) {
    throw new Error(
      `The packaged UI did not start the session. Visible page text:\n${await secondWindow.locator('body').innerText()}`,
      { cause: error }
    );
  }
  await openLiveSession.click();
  await secondWindow.getByRole('heading', { name: 'Live Session', exact: true }).waitFor();
  await secondWindow.getByRole('heading', { name: selectedGameProfile.gameName, exact: true }).waitFor();
  const liveStatus = secondWindow.locator('[aria-label="Session summary"] .status-pill');
  await waitForCondition(
    async () => (await liveStatus.textContent())?.trim() === 'running',
    'the UI-driven session to show running status'
  );
  const uiRuntimeSessionId = await secondWindow.evaluate(async () => {
    const snapshot = await window.gameplaySimulator.simulation.getSessionStatus();
    return snapshot.sessionId;
  });
  if (!uiRuntimeSessionId) {
    throw new Error('The UI-driven packaged session did not expose its runtime session ID.');
  }

  await secondWindow.getByRole('button', { name: 'Stop', exact: true }).click();
  await waitForCondition(
    async () => (await liveStatus.textContent())?.trim() === 'stopped',
    'the UI-driven session to stop'
  );
  await mainNavigation.getByRole('button', { name: 'Reports', exact: true }).click();
  await secondWindow.getByRole('heading', { name: 'Reports', exact: true }).waitFor();
  const uiSessionRow = secondWindow.locator('.table-row--report').filter({
    hasText: uiRuntimeSessionId
  });
  await uiSessionRow.waitFor();
  await uiSessionRow.getByRole('button', { name: 'Summary report', exact: true }).click();
  await secondWindow.getByText('Report opened.', { exact: true }).waitFor();

  const uiSessionStatus = await secondWindow.evaluate(
    (runtimeSessionId) => window.gameplaySimulator.simulation.getSessionStatus(runtimeSessionId),
    uiRuntimeSessionId
  );
  if (uiSessionStatus.status !== 'stopped') {
    throw new Error(`The packaged UI journey did not stop cleanly: ${JSON.stringify(uiSessionStatus)}`);
  }

  await secondApplication.close();
  secondApplication = undefined;
  thirdApplication = await launchApplication(executablePath, userDataPath);
  const thirdWindow = await thirdApplication.firstWindow();
  await thirdWindow.waitForFunction(
    () => !document.body.textContent?.includes('Loading workspace')
  );
  const restartResult = await thirdWindow.evaluate(async ({ apiSessionId, uiSessionId }) => {
    const workspace = await window.gameplaySimulator.workspace.load();
    const sessions = await window.gameplaySimulator.simulation.reloadSessions();
    const report = await window.gameplaySimulator.simulation.openReport(uiSessionId);
    return { workspace, sessions, report, apiSessionId, uiSessionId };
  }, {
    apiSessionId: firstResult.runtimeSessionId,
    uiSessionId: uiRuntimeSessionId
  });

  if (!restartResult.workspace.data.gameProfiles.some(
    (profile) => profile.gameId === selectedGameProfile.gameId
  )) {
    throw new Error(
      `Workspace data did not survive the packaged application restart: ${JSON.stringify({
        warning: restartResult.workspace.warning,
        gameProfileIds: restartResult.workspace.data.gameProfiles.map((profile) => profile.gameId),
        sessionIds: restartResult.sessions.map((session) => session.sessionId)
      })}`
    );
  }
  if (!restartResult.sessions.some(
    (session) => session.sessionId === restartResult.apiSessionId
  ) || !restartResult.sessions.some(
    (session) => session.sessionId === restartResult.uiSessionId
  )) {
    throw new Error('The API and UI packaged sessions were not restored after restart.');
  }
  if (!restartResult.report.opened || basename(restartResult.report.reportPath) !== 'session-summary.md') {
    throw new Error(`The persisted packaged report did not reopen: ${restartResult.report.message}`);
  }

  await thirdApplication.close();
  thirdApplication = undefined;

  fourthApplication = await launchApplication(executablePath, userDataPath);
  const fourthWindow = await fourthApplication.firstWindow();
  await fourthWindow.waitForFunction(
    () => !document.body.textContent?.includes('Loading workspace')
  );
  const shutdownSession = await fourthWindow.evaluate(async ({ gameProfile, bot, config }) => {
    const created = await window.gameplaySimulator.simulation.createSession({
      runConfig: config,
      gameProfile,
      botProfiles: [bot]
    });
    const started = await window.gameplaySimulator.simulation.startSession(created.sessionId);
    return { sessionId: created.sessionId, started };
  }, {
    gameProfile: profileFor(gamePage.url),
    bot: botProfile,
    config: {
      ...runConfig(),
      sessionName: `Packaged shutdown ${showBotGameplay ? 'visible' : 'background'} test`,
      maxActionsPerBot: 100,
      actionDelayMs: 500
    }
  });

  if (shutdownSession.started.status !== 'running') {
    throw new Error(
      `The active-shutdown session did not start: ${JSON.stringify(shutdownSession.started)}`
    );
  }
  await waitForCondition(
    async () => (await findPackagedChromiumProcesses()).length > 0,
    'packaged Chromium to start before application shutdown'
  );

  await fourthApplication.close();
  fourthApplication = undefined;
  await waitForCondition(
    async () => (await findPackagedChromiumProcesses()).length === 0,
    'packaged Chromium to close after active-session shutdown',
    15_000
  );

  fifthApplication = await launchApplication(executablePath, userDataPath);
  const fifthWindow = await fifthApplication.firstWindow();
  await fifthWindow.waitForFunction(
    () => !document.body.textContent?.includes('Loading workspace')
  );
  const shutdownRecovery = await fifthWindow.evaluate(async (shutdownSessionId) => {
    const sessions = await window.gameplaySimulator.simulation.reloadSessions();
    const status = await window.gameplaySimulator.simulation.getSessionStatus(shutdownSessionId);
    const report = await window.gameplaySimulator.simulation.openReport(shutdownSessionId);
    return { sessions, status, report };
  }, shutdownSession.sessionId);

  if (!['stopped', 'failed'].includes(shutdownRecovery.status.status)) {
    throw new Error(
      `Active-session shutdown was not persisted as terminal: ${JSON.stringify(shutdownRecovery.status)}`
    );
  }
  if (!shutdownRecovery.sessions.some(
    (session) => session.sessionId === shutdownSession.sessionId
  )) {
    throw new Error('The session interrupted by application shutdown was not restored.');
  }
  if (!shutdownRecovery.report.opened) {
    throw new Error(`The shutdown session report did not reopen: ${shutdownRecovery.report.message}`);
  }

  await fifthApplication.close();
  fifthApplication = undefined;

  await waitForCondition(
    async () => (await findPackagedChromiumProcesses()).length === 0,
    'all packaged Chromium processes to close',
    15_000
  );

  if (process.platform === 'win32') {
    await waitForCondition(
      async () => (await findPackagedApplicationProcesses()).length === 0,
      'all packaged GameplaySimulator processes to close',
      15_000
    );
    const authenticode = await windowsAuthenticodeStatus(sourceExecutablePath);
    const launchIdentity = await windowsLaunchIdentity();
    const artifactChecksum = await sha256(sourceExecutablePath);
    const validationRecord = {
      validatedAt: new Date().toISOString(),
      operatingSystem: {
        platform: osPlatform(),
        release: osRelease(),
        version: osVersion()
      },
      artifactFilename: basename(sourceExecutablePath),
      sha256: artifactChecksum,
      installationMode: 'portable executable copied to and launched from a path containing spaces',
      requestedExecutionLevel: 'asInvoker',
      launchMode: 'normal launch without an elevation request',
      launchIdentity,
      authenticode,
      unsignedWarningBehavior:
        authenticode?.Status === 'NotSigned'
          ? 'Windows may show an unknown-publisher or SmartScreen warning; the artifact is not described as signed.'
          : 'Authenticode status was recorded from the produced artifact.',
      testResults: {
        applicationLaunch: 'passed',
        writableWorkspace: 'passed',
        profilePersistenceAfterRestart: 'passed',
        packagedChromiumLaunch: 'passed',
        browserMode: showBotGameplay ? 'visible passed' : 'background passed',
        reportSavedAndReopened: 'passed',
        invalidUrlHandling: 'passed',
        cleanSessionStop: 'passed',
        activeSessionShutdown: 'passed',
        processCleanup: 'passed',
        desktopKeyboardMouseAutomation: 'unavailable by design in 0.1.0'
      }
    };
    await writeFile(
      join(
        releaseRoot,
        `windows-validation-${packageVersion}-${showBotGameplay ? 'visible' : 'background'}.json`
      ),
      `${JSON.stringify(validationRecord, null, 2)}\n`,
      'utf8'
    );
  }

  console.log(
    `Packaged application smoke and UI journey passed with ${basename(executablePath)}, bundled Chromium, and ${showBotGameplay ? 'visible' : 'background'} browser sessions${externalGameUrl ? ` at ${externalGameUrl}` : ''}.`
  );
} finally {
  await firstApplication?.close().catch(() => undefined);
  await secondApplication?.close().catch(() => undefined);
  await thirdApplication?.close().catch(() => undefined);
  await fourthApplication?.close().catch(() => undefined);
  await fifthApplication?.close().catch(() => undefined);
  await gamePage.close().catch(() => undefined);
  await instrumentedExample.close().catch(() => undefined);
  await removeTemporaryDirectory(userDataPath);
  if (portableCopyRoot) {
    await removeTemporaryDirectory(portableCopyRoot);
  }
}
