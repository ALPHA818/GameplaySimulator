import { createServer } from 'node:http';
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';

const projectRoot = resolve(import.meta.dirname, '..');
const releaseRoot = resolve(projectRoot, 'release');
const sessionId = 'packaged-release-smoke';
const externalGameUrl = process.env.GAMEPLAY_SIMULATOR_RELEASE_SMOKE_GAME_URL?.trim();
const showBotGameplay = process.env.GAMEPLAY_SIMULATOR_RELEASE_SMOKE_VISIBLE === '1';

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
    const directory = join(releaseRoot, 'win-unpacked');
    const entries = await readdir(directory, { withFileTypes: true });
    const executable = entries.find(
      (entry) => entry.isFile() &&
        entry.name.toLowerCase().endsWith('.exe') &&
        !entry.name.toLowerCase().includes('uninstall')
    );

    if (executable) {
      return join(directory, executable.name);
    }
  }

  throw new Error(`No unpacked GameplaySimulator executable was found for ${process.platform}.`);
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
  const server = createServer((_request, response) => {
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
      window.__GAMEPLAY_SIM_PERFORM_ACTION__ = ({ action }) => {
        window.packagedTestState.actionCount += 1;
        window.packagedTestState.currentScreen = action.type;
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
    close: () => new Promise((resolveClose, rejectClose) => {
      server.closeAllConnections?.();
      server.close((error) => error ? rejectClose(error) : resolveClose());
    })
  };
}

function profileFor(url) {
  const usesExternalGame = Boolean(externalGameUrl);

  return {
    gameId: 'packaged-browser-game',
    gameName: 'Packaged Browser Game',
    version: '0.1.0',
    buildId: 'packaged-smoke',
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
      supportsStateRead: !usesExternalGame,
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
            binding: 'P',
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
    uiFlows: [],
    knownContent: {
      scenes: ['main-menu', 'open-menu'],
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
  requiredCapabilities: ['state-read', 'direct-actions', 'screenshots'],
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

function runConfig() {
  return {
    sessionId,
    sessionLabel: 'Smoke Test',
    gameProfilePath: 'memory://game-profiles/packaged-browser-game',
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
    visibleActionDelayMs: showBotGameplay ? 250 : 0,
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
    maxActionsPerBot: 1,
    resourceLimits: {
      maxCpuPercent: 90,
      maxRamPercent: 90,
      reserveRamMb: 256,
      maxGameInstances: 1,
      allowAutoScaling: false
    }
  };
}

async function launchApplication(executablePath, userDataPath) {
  const env = {
    ...process.env,
    GAMEPLAY_SIMULATOR_RELEASE_SMOKE_TEST: '1',
    GAMEPLAY_SIMULATOR_RELEASE_SMOKE_USER_DATA: userDataPath
  };
  delete env.ELECTRON_RUN_AS_NODE;
  if (executablePath.endsWith('.AppImage')) {
    env.APPIMAGE_EXTRACT_AND_RUN = '1';
  }

  return electron.launch({
    executablePath,
    args: process.platform === 'linux' ? ['--no-sandbox'] : [],
    env
  });
}

const requestedExecutable = process.argv[2]
  ? resolve(projectRoot, process.argv[2])
  : undefined;
const executablePath = requestedExecutable ?? await findPackagedExecutable();
const userDataPath = await mkdtemp(join(tmpdir(), 'gameplay-simulator-packaged-user-data-'));
const gamePage = externalGameUrl
  ? {
      url: externalGameUrl,
      close: async () => undefined
    }
  : await startGamePage();
let firstApplication;
let secondApplication;

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
    badBrowserProfile,
    badDesktopProfile
  }) => {
    const workspace = await window.gameplaySimulator.workspace.load();
    await window.gameplaySimulator.workspace.save({
      ...workspace.data,
      gameProfiles: [gameProfile],
      customBotProfiles: [bot],
      runConfigs: [config],
      lastValidatedRunConfig: config
    });
    const invalidBrowserResult = await window.gameplaySimulator.simulation.testGameProfile({
      gameProfile: badBrowserProfile,
      showTestWindow: false
    });
    const invalidDesktopResult = await window.gameplaySimulator.simulation.testGameProfile({
      gameProfile: badDesktopProfile,
      showTestWindow: false
    });
    await window.gameplaySimulator.simulation.createSession({
      runConfig: config,
      gameProfile,
      botProfiles: [bot]
    });
    await window.gameplaySimulator.simulation.startSession(config.sessionId);
    const initialObservation =
      await window.gameplaySimulator.simulation.getLiveObservationState(config.sessionId);

    const deadline = Date.now() + 20_000;
    let status;
    while (Date.now() < deadline) {
      status = await window.gameplaySimulator.simulation.getSessionStatus(config.sessionId);
      if (status.status === 'stopped' || status.status === 'failed') {
        break;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }

    return {
      status,
      sessions: await window.gameplaySimulator.simulation.listSessions(),
      instances: await window.gameplaySimulator.simulation.getInstanceStatuses(config.sessionId),
      initialObservation,
      invalidBrowserResult,
      invalidDesktopResult
    };
  }, {
    gameProfile: profileFor(gamePage.url),
    bot: botProfile,
    config: runConfig(),
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
    throw new Error(
      `Packaged browser session did not stop successfully: ${JSON.stringify(firstResult.status)}`
    );
  }
  if (!firstResult.sessions.some((session) => session.sessionId === sessionId)) {
    throw new Error('Packaged session metadata was not saved.');
  }
  const launchedInstance = firstResult.instances[0];
  if (
    showBotGameplay &&
    (!launchedInstance || firstResult.initialObservation.badge !== 'Watching')
  ) {
    throw new Error(
      `The packaged browser session did not launch visibly: ${JSON.stringify({
        instances: firstResult.instances,
        observation: firstResult.initialObservation
      })}`
    );
  }

  await firstApplication.close();
  firstApplication = undefined;
  const workspacePath = join(userDataPath, 'workspace', 'workspace-v1.json');
  const savedWorkspace = JSON.parse(await readFile(workspacePath, 'utf8'));
  if (!savedWorkspace.gameProfiles?.some(
    (profile) => profile.gameId === 'packaged-browser-game'
  )) {
    throw new Error(`The packaged app did not write workspace data to ${workspacePath}.`);
  }
  const savedScreenshots = await findMatchingFiles(
    join(userDataPath, 'runs'),
    (path) => path.toLowerCase().endsWith('.png')
  );
  if (savedScreenshots.length === 0) {
    throw new Error('The packaged browser session did not save screenshot evidence.');
  }

  secondApplication = await launchApplication(executablePath, userDataPath);
  const secondWindow = await secondApplication.firstWindow();
  await secondWindow.waitForFunction(
    () => !document.body.textContent?.includes('Loading workspace')
  );
  const restartResult = await secondWindow.evaluate(async (expectedSessionId) => {
    const workspace = await window.gameplaySimulator.workspace.load();
    const sessions = await window.gameplaySimulator.simulation.reloadSessions();
    const report = await window.gameplaySimulator.simulation.openReport(expectedSessionId);
    return {
      workspace,
      sessions,
      report
    };
  }, sessionId);

  if (!restartResult.workspace.data.gameProfiles.some(
    (profile) => profile.gameId === 'packaged-browser-game'
  )) {
    throw new Error(
      `Workspace data did not survive the packaged application restart: ${JSON.stringify({
        warning: restartResult.workspace.warning,
        gameProfileIds: restartResult.workspace.data.gameProfiles.map((profile) => profile.gameId),
        sessionIds: restartResult.sessions.map((session) => session.sessionId)
      })}`
    );
  }
  if (!restartResult.sessions.some((session) => session.sessionId === sessionId)) {
    throw new Error('The packaged session was not restored after restart.');
  }
  if (!restartResult.report.opened || basename(restartResult.report.reportPath) !== 'session-summary.md') {
    throw new Error(`The persisted packaged report did not reopen: ${restartResult.report.message}`);
  }

  console.log(
    `Packaged application smoke test passed with ${basename(executablePath)}, bundled Chromium, and ${showBotGameplay ? 'a visible' : 'a background'} browser session${externalGameUrl ? ` at ${externalGameUrl}` : ''}.`
  );
} finally {
  await firstApplication?.close().catch(() => undefined);
  await secondApplication?.close().catch(() => undefined);
  await gamePage.close().catch(() => undefined);
  await rm(userDataPath, { recursive: true, force: true });
}
