import type { BotPoolConfig } from '@core/types';
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  FileText,
  Focus,
  Pause,
  Play,
  RotateCw,
  Square,
  UserX,
  UsersRound
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { FieldLabel, SelectInput } from '../components/FormFields';
import { useConfigStore } from '../store/configStore';
import { useSessionStore } from '../store/sessionStore';

function formatRuntime(startedAt?: string, stoppedAt?: string): string {
  if (!startedAt) {
    return '00:00';
  }

  const start = Date.parse(startedAt);
  const end = stoppedAt ? Date.parse(stoppedAt) : Date.now();
  const totalSeconds = Math.max(0, Math.floor((end - start) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function isRunningStatus(status: string): boolean {
  return ['queued', 'starting', 'running'].includes(status);
}

function isStoppedStatus(status: string): boolean {
  return ['stopped', 'completed', 'failed'].includes(status);
}

function isStuckStatus(status: string): boolean {
  return ['blocked', 'waiting'].includes(status);
}

function requestedCount(pool: BotPoolConfig): number {
  return pool.enabled ? pool.desiredCount : 0;
}

export function LiveSessionPage() {
  const navigate = useConfigStore((state) => state.navigate);
  const gameProfiles = useConfigStore((state) => state.gameProfiles);
  const botProfiles = useConfigStore((state) => state.botProfiles);
  const runConfigs = useConfigStore((state) => state.runConfigs);
  const lastValidatedRunConfig = useConfigStore((state) => state.lastValidatedRunConfig);
  const status = useSessionStore((state) => state.status);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const lastSnapshot = useSessionStore((state) => state.lastSnapshot);
  const botStatuses = useSessionStore((state) => state.botStatuses);
  const instanceStatuses = useSessionStore((state) => state.instanceStatuses);
  const issues = useSessionStore((state) => state.issues);
  const logs = useSessionStore((state) => state.logs);
  const coverage = useSessionStore((state) => state.coverage);
  const liveObservation = useSessionStore((state) => state.liveObservation);
  const applySessionSnapshot = useSessionStore((state) => state.applySessionSnapshot);
  const applyRuntimeDetails = useSessionStore((state) => state.applyRuntimeDetails);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [selectedPoolId, setSelectedPoolId] = useState<string | null>(null);

  const activeConfig =
    runConfigs.find((config) => config.sessionId === activeSessionId) ??
    (lastValidatedRunConfig?.sessionId === activeSessionId ? lastValidatedRunConfig : null);
  const gameProfileId = activeConfig?.gameProfilePath.replace('memory://game-profiles/', '');
  const gameProfile = gameProfiles.find((profile) => profile.gameId === gameProfileId) ?? gameProfiles[0];
  const runningBots = botStatuses.filter((bot) => isRunningStatus(bot.status)).length;
  const stoppedBots = botStatuses.filter((bot) => isStoppedStatus(bot.status)).length;
  const stuckBots = botStatuses.filter((bot) => isStuckStatus(bot.status)).length;
  const issueCountByBot = useMemo(() => {
    const counts = new Map<string, number>();

    for (const issue of issues) {
      if (issue.botId) {
        counts.set(issue.botId, (counts.get(issue.botId) ?? 0) + 1);
      }
    }

    return counts;
  }, [issues]);
  const botPools = useMemo(() => {
    const pools = activeConfig?.botPools ?? [];

    return pools.map((pool) => {
      const bots = botStatuses.filter((bot) => bot.profileId === pool.profileId);
      const issueCount = bots.reduce((total, bot) => total + (issueCountByBot.get(bot.botId) ?? 0), 0);

      return {
        profileId: pool.profileId,
        requested: requestedCount(pool),
        running: bots.filter((bot) => isRunningStatus(bot.status)).length,
        stopped: bots.filter((bot) => isStoppedStatus(bot.status)).length,
        stuck: bots.filter((bot) => isStuckStatus(bot.status)).length,
        issues: issueCount
      };
    });
  }, [activeConfig, botStatuses, issueCountByBot]);
  const activeBots = botStatuses.filter((bot) => isRunningStatus(bot.status));
  const selectedBot = botStatuses.find((bot) => bot.botId === selectedBotId) ?? activeBots[0] ?? botStatuses[0] ?? null;
  const watchedBot = botStatuses.find((bot) => bot.botId === liveObservation?.watchedBotId) ?? null;
  const actionBot = watchedBot ?? selectedBot;
  const selectedBotProfile = botProfiles.find((profile) => profile.profileId === actionBot?.profileId);
  const selectedBotGoal =
    actionBot?.currentGoal ??
    selectedBotProfile?.goals.find((goal) => goal.goalId === actionBot?.currentGoalId)?.name ??
    selectedBotProfile?.goals[0]?.name ??
    'No active goal';
  const selectedPool = selectedPoolId ?? selectedBot?.profileId ?? botPools[0]?.profileId ?? null;
  const canStart = activeSessionId !== null && !['starting', 'running', 'paused'].includes(status);
  const canPause = activeSessionId !== null && status === 'running';
  const canResume = activeSessionId !== null && status === 'paused';
  const canStop = activeSessionId !== null && ['created', 'starting', 'running', 'paused'].includes(status);

  useEffect(() => {
    if (liveObservation?.watchedBotId) {
      setSelectedBotId(liveObservation.watchedBotId);
      return;
    }

    if (!selectedBotId || !botStatuses.some((bot) => bot.botId === selectedBotId)) {
      setSelectedBotId(activeBots[0]?.botId ?? botStatuses[0]?.botId ?? null);
    }
  }, [activeBots, botStatuses, liveObservation?.watchedBotId, selectedBotId]);

  async function refreshSession(sessionId: string) {
    const [snapshot, nextBots, nextInstances, nextIssues, nextLogs, nextCoverage, nextObservation] = await Promise.all([
      window.gameplaySimulator.simulation.getSessionStatus(sessionId),
      window.gameplaySimulator.simulation.getBotStatuses(sessionId),
      window.gameplaySimulator.simulation.getInstanceStatuses(sessionId),
      window.gameplaySimulator.simulation.getIssues(sessionId),
      window.gameplaySimulator.simulation.getLogs(sessionId),
      window.gameplaySimulator.simulation.getCoverage(sessionId),
      window.gameplaySimulator.simulation.getLiveObservationState(sessionId)
    ]);

    applySessionSnapshot(snapshot);
    applyRuntimeDetails({
      botStatuses: nextBots,
      instanceStatuses: nextInstances,
      issues: nextIssues,
      logs: nextLogs,
      coverage: nextCoverage,
      liveObservation: nextObservation
    });
  }

  async function startSession() {
    if (!activeSessionId) {
      navigate('newSession');
      return;
    }

    const snapshot = await window.gameplaySimulator.simulation.startSession(activeSessionId);
    applySessionSnapshot(snapshot);
    await refreshSession(activeSessionId);
  }

  async function stopSession() {
    if (!activeSessionId) {
      return;
    }

    const snapshot = await window.gameplaySimulator.simulation.stopSession(activeSessionId);
    applySessionSnapshot(snapshot);
    await refreshSession(activeSessionId);
  }

  async function pauseSession() {
    if (!activeSessionId) {
      return;
    }

    const snapshot = await window.gameplaySimulator.simulation.pauseSession(activeSessionId);
    applySessionSnapshot(snapshot);
    await refreshSession(activeSessionId);
  }

  async function resumeSession() {
    if (!activeSessionId) {
      return;
    }

    const snapshot = await window.gameplaySimulator.simulation.resumeSession(activeSessionId);
    applySessionSnapshot(snapshot);
    await refreshSession(activeSessionId);
  }

  async function stopSelectedBot() {
    if (!activeSessionId || !selectedBot) {
      return;
    }

    const nextBots = await window.gameplaySimulator.simulation.stopBot(activeSessionId, selectedBot.botId);
    applyRuntimeDetails({ botStatuses: nextBots });
    await refreshSession(activeSessionId);
  }

  async function stopSelectedPool() {
    if (!activeSessionId || !selectedPool) {
      return;
    }

    const nextBots = await window.gameplaySimulator.simulation.stopBotPool(activeSessionId, selectedPool);
    applyRuntimeDetails({ botStatuses: nextBots });
    await refreshSession(activeSessionId);
  }

  async function openLogs() {
    if (activeSessionId) {
      await window.gameplaySimulator.simulation.openLogs(activeSessionId);
    }
  }

  async function openReport() {
    if (activeSessionId) {
      await window.gameplaySimulator.simulation.openReport(activeSessionId);
    }
  }

  async function followBot(botId: string) {
    if (!activeSessionId) {
      return;
    }

    const observation = await window.gameplaySimulator.simulation.followBot(activeSessionId, botId);
    setSelectedBotId(observation.watchedBotId ?? botId);
    applyRuntimeDetails({ liveObservation: observation });
  }

  async function stopFollowing() {
    if (!activeSessionId) {
      return;
    }

    const observation = await window.gameplaySimulator.simulation.stopFollowingBot(activeSessionId);
    applyRuntimeDetails({ liveObservation: observation });
  }

  async function showAdjacentBot(direction: 'next' | 'previous') {
    if (!activeSessionId) {
      return;
    }

    const observation = await window.gameplaySimulator.simulation.showAdjacentBot(activeSessionId, direction);
    setSelectedBotId(observation.watchedBotId ?? null);
    applyRuntimeDetails({ liveObservation: observation });
  }

  async function focusGameWindow() {
    if (!activeSessionId) {
      return;
    }

    const observation = await window.gameplaySimulator.simulation.focusObservedGameWindow(activeSessionId);
    applyRuntimeDetails({ liveObservation: observation });
  }

  return (
    <section className="page-stack live-session-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Monitor</p>
          <h1>Live Session</h1>
        </div>
        <div className="page-actions">
          <button
            className="primary-button"
            type="button"
            disabled={activeSessionId !== null && !canStart}
            onClick={startSession}
          >
            <Play size={18} aria-hidden="true" />
            <span>Start</span>
          </button>
          <button className="secondary-button" type="button" disabled={!canPause} onClick={pauseSession}>
            <Pause size={18} aria-hidden="true" />
            <span>Pause</span>
          </button>
          <button className="secondary-button" type="button" disabled={!canResume} onClick={resumeSession}>
            <RotateCw size={18} aria-hidden="true" />
            <span>Resume</span>
          </button>
          <button className="secondary-button" type="button" disabled={!canStop} onClick={stopSession}>
            <Square size={18} aria-hidden="true" />
            <span>Stop</span>
          </button>
        </div>
      </div>

      <section className="viability-panel" aria-label="Session summary">
        <div className="viability-panel__header">
          <div>
            <p className="eyebrow">Session Summary</p>
            <h2>{gameProfile?.gameName ?? 'No session selected'}</h2>
          </div>
          <span className="status-pill">{status}</span>
        </div>

        <div className="metric-grid metric-grid--session">
          <div className="metric-card">
            <FieldLabel label="Build/version" />
            <strong>{gameProfile ? `${gameProfile.version}${gameProfile.buildId ? ` / ${gameProfile.buildId}` : ''}` : 'None'}</strong>
          </div>
          <div className="metric-card">
            <FieldLabel label="Adapter" />
            <strong>{activeConfig?.adapterType ?? gameProfile?.adapter.type ?? 'None'}</strong>
          </div>
          <div className="metric-card">
            <FieldLabel label="Runtime" />
            <strong>{formatRuntime(lastSnapshot?.startedAt, lastSnapshot?.stoppedAt)}</strong>
          </div>
          <div className="metric-card">
            <FieldLabel label="Total bots" />
            <strong>{botStatuses.length}</strong>
          </div>
          <div className="metric-card">
            <FieldLabel label="Running bots" />
            <strong>{runningBots}</strong>
          </div>
          <div className="metric-card">
            <FieldLabel label="Stopped bots" />
            <strong>{stoppedBots}</strong>
          </div>
          <div className="metric-card">
            <FieldLabel label="Stuck bots" />
            <strong>{stuckBots}</strong>
          </div>
          <div className="metric-card">
            <FieldLabel label="Issues found" />
            <strong>{issues.length}</strong>
          </div>
        </div>
      </section>

      <section className="viability-panel live-observation-panel" aria-label="Observation panel">
        <div className="viability-panel__header">
          <div>
            <p className="eyebrow">Observation</p>
            <h2>Watch a bot play</h2>
          </div>
          <span className="status-pill observation-badge" data-status={liveObservation?.badge ?? 'Waiting for game'}>
            {liveObservation?.badge ?? 'Waiting for game'}
          </span>
        </div>

        <div className="observation-detail-grid">
          <div className="observation-field">
            <FieldLabel
              label="Observation Status"
              helpText="This tells you whether a game window is being watched. Watching means the selected game window is available. Background means bots keep running without focus changes. Window unavailable means this adapter can only provide logs or screenshots. Watching does not add bots, but a visible window can use more CPU, RAM, and screen space."
            />
            <strong>{liveObservation?.badge ?? 'Waiting for game'}</strong>
          </div>
          <SelectInput
            id="watched-bot"
            label="Watched Bot"
            helpText="This is the running bot whose game instance you want to watch. Changing it updates observation only and does not pause or stop any bot. The watched game window may use extra screen space, but choosing a bot adds no CPU or RAM by itself. If the bot stops, the simulator chooses the next running bot."
            value={liveObservation?.watchedBotId ?? ''}
            disabled={!activeSessionId || activeBots.length === 0}
            onChange={(event) => {
              if (event.currentTarget.value) {
                void followBot(event.currentTarget.value);
              }
            }}
          >
            <option value="">No bot selected</option>
            {activeBots.map((bot) => (
              <option key={bot.botId} value={bot.botId}>
                {bot.botId} ({bot.gameInstanceId ?? 'waiting for instance'})
              </option>
            ))}
          </SelectInput>
          <div className="observation-field">
            <FieldLabel
              label="Watched Game Instance"
              helpText="This is the already-running copy of the game assigned to the watched bot. Focus Game Window uses this ID and never starts another copy. It uses no extra CPU or RAM by itself. If it is blank, wait for the bot to receive an instance."
            />
            <strong>{liveObservation?.watchedGameInstanceId ?? 'Waiting for assignment'}</strong>
          </div>
          <div className="observation-field">
            <FieldLabel
              label="Observation Mode"
              helpText="This shows how the session is handling game windows. Follow selected bot watches one bot, while Background avoids focus changes. Switching modes does not interrupt bots. Visible modes can use more screen space and must be supported by the selected adapter."
            />
            <strong>{liveObservation?.observationMode ?? 'background'}</strong>
          </div>
          <div className="observation-field">
            <FieldLabel
              label="Current Action"
              helpText="This is the action the watched bot most recently started. It comes from the bot runtime and matches the watched bot only. Showing this text uses almost no CPU or RAM and opens no window. If it stays empty, the bot may still be waiting for the game."
            />
            <strong>{liveObservation?.currentAction ?? 'Waiting for first action'}</strong>
          </div>
          <div className="observation-field observation-field--wide">
            <FieldLabel
              label="Action Reason"
              helpText="This explains why the watched bot chose its current action. It helps you tell planned testing from exploration, recovery, or random stress. Showing the reason uses almost no resources and works when the bot planner provides an explanation."
            />
            <strong>{liveObservation?.actionReason ?? 'No action reason yet'}</strong>
          </div>
          <div className="observation-field">
            <FieldLabel
              label="Action Start Time"
              helpText="This is when the watched bot began its current action. Use it to understand waits, slow controls, or stuck behavior. It opens no windows and uses almost no CPU or RAM. A blank value means no action has started yet."
            />
            <strong>{liveObservation?.actionStartedAt ?? 'Not started'}</strong>
          </div>
          <div className="observation-field">
            <FieldLabel
              label="Last Result"
              helpText="This shows whether the watched bot's last action worked, failed, timed out, or was skipped. It does not change the game and uses almost no resources. Repeated failures usually mean controls, game state, or adapter setup needs checking."
            />
            <strong>{liveObservation?.lastResult ?? 'No result yet'}</strong>
          </div>
          <div className="observation-field">
            <FieldLabel
              label="Current Scene or UI Screen"
              helpText="This is the latest area, scene, menu, or screen reported for the watched bot. Instrumented and browser adapters usually know more than desktop fallback. Reading richer state may use a little CPU and RAM, but it opens no extra window."
            />
            <strong>{liveObservation?.currentScene ?? 'Unknown'}</strong>
          </div>
          <div className="observation-field observation-field--wide">
            <FieldLabel
              label="Window Status"
              helpText="This explains whether the watched game window can be shown or focused. Focus support depends on the selected adapter and operating system. Focusing opens no new game copy, but it may interrupt other work on your computer. If unavailable, use logs and screenshots instead."
            />
            <strong>{liveObservation?.windowStatus ?? 'Waiting for adapter status'}</strong>
          </div>
        </div>

        <div className="observation-controls">
          <button
            className="secondary-button"
            type="button"
            disabled={!liveObservation?.canFocusWindow}
            onClick={() => void focusGameWindow()}
          >
            <Focus size={18} aria-hidden="true" />
            <span>Focus Game Window</span>
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={!selectedBot || !isRunningStatus(selectedBot.status)}
            onClick={() => selectedBot && void followBot(selectedBot.botId)}
          >
            <Eye size={18} aria-hidden="true" />
            <span>Follow This Bot</span>
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={!liveObservation?.watchedBotId}
            onClick={() => void stopFollowing()}
          >
            <EyeOff size={18} aria-hidden="true" />
            <span>Stop Following</span>
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={activeBots.length === 0}
            onClick={() => void showAdjacentBot('previous')}
          >
            <ChevronLeft size={18} aria-hidden="true" />
            <span>Show Previous Bot</span>
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={activeBots.length === 0}
            onClick={() => void showAdjacentBot('next')}
          >
            <ChevronRight size={18} aria-hidden="true" />
            <span>Show Next Bot</span>
          </button>
        </div>

        <div className="inline-notice observation-switch-message" aria-live="polite">
          <FieldLabel
            label="Observation Update"
            helpText="This message explains why the watched bot changed. The simulator switches automatically when a watched bot stops. Switching observation does not pause bots, change their actions, add windows, or increase the bot count."
          />
          <span>{liveObservation?.message ?? 'Waiting for a running bot to observe.'}</span>
        </div>
      </section>

      <section className="viability-panel" aria-label="Live controls">
        <div className="viability-panel__header">
          <div>
            <p className="eyebrow">Controls</p>
            <h2>Session actions</h2>
          </div>
          <span className="status-pill">{activeSessionId ?? 'No active session'}</span>
        </div>
        <div className="live-control-grid">
          <button className="secondary-button" type="button" disabled={!selectedBot} onClick={stopSelectedBot}>
            <UserX size={18} aria-hidden="true" />
            <span>Stop selected bot</span>
          </button>
          <button className="secondary-button" type="button" disabled={!selectedPool} onClick={stopSelectedPool}>
            <UsersRound size={18} aria-hidden="true" />
            <span>Stop selected bot pool</span>
          </button>
          <button className="secondary-button" type="button" disabled={!activeSessionId} onClick={openLogs}>
            <BookOpen size={18} aria-hidden="true" />
            <span>Open logs</span>
          </button>
          <button className="secondary-button" type="button" disabled={!activeSessionId} onClick={openReport}>
            <FileText size={18} aria-hidden="true" />
            <span>Open reports</span>
          </button>
        </div>
      </section>

      <section className="viability-panel" aria-label="Content coverage">
        <div className="viability-panel__header">
          <div>
            <p className="eyebrow">Content Coverage</p>
            <h2>Main, side, optional, and post-game content</h2>
          </div>
          <span className="status-pill">
            {coverage ? `${coverage.percentage}%` : 'No coverage'}
          </span>
        </div>

        <div className="metric-grid metric-grid--session">
          <div className="metric-card">
            <FieldLabel label="Known tested" />
            <strong>{coverage ? `${coverage.testedKnown}/${coverage.totalKnown}` : '0/0'}</strong>
          </div>
          <div className="metric-card">
            <FieldLabel label="Observed" />
            <strong>{coverage?.totalObserved ?? 0}</strong>
          </div>
          <div className="metric-card">
            <FieldLabel label="Untested" />
            <strong>{coverage?.untestedContent.length ?? 0}</strong>
          </div>
          <div className="metric-card">
            <FieldLabel label="With issues" />
            <strong>{coverage?.contentWithIssues.length ?? 0}</strong>
          </div>
        </div>

        <div className="coverage-grid">
          <div className="coverage-column">
            <h2>Tested content</h2>
            <div className="runtime-list">
              {(coverage?.testedContent ?? []).slice(0, 8).map((item) => (
                <div className="runtime-list-row" key={item.contentId}>
                  <strong>{item.label}</strong>
                  <small>{item.category} · {item.botTypes.join(', ') || 'unassigned'}</small>
                </div>
              ))}
              {coverage && coverage.testedContent.length === 0 ? <div className="empty-row">No content tested yet</div> : null}
            </div>
          </div>

          <div className="coverage-column">
            <h2>Untested content</h2>
            <div className="runtime-list">
              {(coverage?.untestedContent ?? []).slice(0, 8).map((item) => (
                <div className="runtime-list-row" key={item.contentId}>
                  <strong>{item.label}</strong>
                  <small>{item.category}</small>
                </div>
              ))}
              {coverage && coverage.untestedContent.length === 0 ? <div className="empty-row">No untested known content</div> : null}
            </div>
          </div>

          <div className="coverage-column">
            <h2>By bot type</h2>
            <div className="runtime-list">
              {(coverage?.byBotType ?? []).slice(0, 8).map((item) => (
                <div className="runtime-list-row" key={item.botType}>
                  <strong>{item.botType}</strong>
                  <small>{item.testedCount} content item{item.testedCount === 1 ? '' : 's'} tested</small>
                </div>
              ))}
              {coverage && coverage.byBotType.length === 0 ? <div className="empty-row">No bot coverage yet</div> : null}
            </div>
          </div>

          <div className="coverage-column">
            <h2>Content with issues</h2>
            <div className="runtime-list">
              {(coverage?.contentWithIssues ?? []).slice(0, 8).map((item) => (
                <div className="runtime-list-row" key={item.contentId}>
                  <strong>{item.label}</strong>
                  <small>{item.category} · {item.issueIds.length} issue{item.issueIds.length === 1 ? '' : 's'}</small>
                </div>
              ))}
              {coverage && coverage.contentWithIssues.length === 0 ? <div className="empty-row">No issue-linked content</div> : null}
            </div>
          </div>
        </div>
      </section>

      <section className="viability-panel" aria-label="Bot pool summary">
        <div>
          <p className="eyebrow">Bot Pool Summary</p>
          <h2>Pools</h2>
        </div>
        <div className="allocation-table">
          <div className="pool-summary-row pool-summary-row--head">
            <span>
              <FieldLabel label="Bot type" />
            </span>
            <span>
              <FieldLabel label="Requested" />
            </span>
            <span>
              <FieldLabel label="Running" />
            </span>
            <span>
              <FieldLabel label="Stopped" />
            </span>
            <span>
              <FieldLabel label="Stuck" />
            </span>
            <span>
              <FieldLabel label="Issues" />
            </span>
          </div>
          {botPools.length === 0 ? (
            <div className="empty-row">Create or start a session to see bot pools</div>
          ) : (
            botPools.map((pool) => (
              <button
                className="pool-summary-row pool-summary-row--button"
                data-selected={selectedPool === pool.profileId}
                key={pool.profileId}
                type="button"
                onClick={() => setSelectedPoolId(pool.profileId)}
              >
                <span>{pool.profileId}</span>
                <span>{pool.requested}</span>
                <span>{pool.running}</span>
                <span>{pool.stopped}</span>
                <span>{pool.stuck}</span>
                <span>{pool.issues}</span>
              </button>
            ))
          )}
        </div>
      </section>

      <section className="viability-panel" aria-label="Individual bot list">
        <div>
          <p className="eyebrow">Individual Bots</p>
          <h2>Bot status</h2>
        </div>
        <div className="bot-decision-grid" aria-label="Watched bot action explanation">
            <div>
              <FieldLabel
                label="Current Bot Goal"
                helpText="This is what the selected bot is trying to achieve. The simulator uses the bot profile to choose this goal. For example, a UI Tester may try to exercise menus. If the goal looks wrong, check the bot profile chosen for the session. Beginners should confirm the goal matches the kind of test they want."
              />
              <strong>{selectedBotGoal}</strong>
            </div>
            <div>
              <FieldLabel
                label="Current Action"
                helpText="This is the action the selected bot most recently chose and is working on. The simulator sends it to the game adapter. For example, open-menu or move-forward. If it does nothing, check the action result and control mapping. Beginners should watch this value change during a run."
              />
              <strong>{actionBot?.currentAction ?? actionBot?.lastActionId ?? 'Waiting for first action'}</strong>
            </div>
            <div>
              <FieldLabel
                label="Action Reason"
                helpText="This explains why the bot chose the current action. The simulator turns planner rules, coverage, and randomness into a short sentence. For example, an Explorer may choose move-forward because it is unvisited. If the reason seems wrong, inspect the bot profile and available actions. Beginners can use this to understand bot behavior."
              />
              <strong>{actionBot?.actionReason ?? 'The bot has not explained an action yet.'}</strong>
            </div>
            <div>
              <FieldLabel
                label="Action Quality"
                helpText="This labels the kind of decision the bot made. Planned follows profile rules, exploratory tries something new, recovery escapes a stuck state, repeated tries an action again, risky tests an edge case, random is chaos behavior, and startup-flow follows configured menus. If the label is unexpected, read the action reason. Beginners do not need to change anything here."
              />
              <strong className="action-quality-pill">{actionBot?.actionQuality ?? 'not-known'}</strong>
            </div>
            <div>
              <FieldLabel
                label="Last Result"
                helpText="This shows what happened after the selected bot's last action. It includes success, failure, skip, timeout, and any short message from the game adapter. For example, succeeded: menu opened. If it failed, check controls, adapter health, and logs. Beginners should investigate repeated failures before adding more bots."
              />
              <strong>{actionBot?.lastResult ?? 'No result yet'}</strong>
            </div>
            <div>
              <FieldLabel
                label="Next Likely Action"
                helpText="This is the action the planner currently thinks may be a good next choice. It is only a helpful guess because game state can change after every action. For example, close-menu may follow open-menu. If it is blank, the planner does not know yet. Beginners can use it to spot surprising plans early."
              />
              <strong>{actionBot?.nextLikelyAction ?? 'Not known yet'}</strong>
            </div>
        </div>
        <div className="allocation-table">
          <div className="bot-status-row bot-status-row--head">
            <span>
              <FieldLabel label="Bot ID" />
            </span>
            <span>
              <FieldLabel label="Profile/playstyle" />
            </span>
            <span>
              <FieldLabel label="Status" />
            </span>
            <span>
              <FieldLabel label="Current area" />
            </span>
            <span>
              <FieldLabel label="Last action" />
            </span>
            <span>
              <FieldLabel label="Issues" />
            </span>
            <span>
              <FieldLabel label="Progress" />
            </span>
          </div>
          {botStatuses.length === 0 ? (
            <div className="empty-row">No live bots yet</div>
          ) : (
            botStatuses.map((bot) => (
              <button
                className="bot-status-row bot-status-row--button"
                data-selected={selectedBot?.botId === bot.botId}
                key={bot.botId}
                type="button"
                onClick={() => {
                  setSelectedBotId(bot.botId);
                  setSelectedPoolId(bot.profileId);
                }}
              >
                <span>{bot.botId}</span>
                <span>
                  {bot.profileId}
                  <small>{bot.playstyle}</small>
                </span>
                <span>{bot.status}</span>
                <span>{bot.currentArea}</span>
                <span>
                  {bot.currentAction ?? bot.lastActionId ?? 'None'}
                  {bot.actionQuality ? <small>{bot.actionQuality}</small> : null}
                </span>
                <span>{issueCountByBot.get(bot.botId) ?? bot.issueCount}</span>
                <span>{bot.progressState}</span>
              </button>
            ))
          )}
        </div>
      </section>

      <section className="viability-panel" aria-label="Game instance panel">
        <div>
          <p className="eyebrow">Game Instances</p>
          <h2>Process and window health</h2>
        </div>
        <div className="allocation-table">
          <div className="live-instance-row live-instance-row--head">
            <span>
              <FieldLabel label="Instance ID" />
            </span>
            <span>
              <FieldLabel label="Game instance status" />
            </span>
            <span>
              <FieldLabel label="Assigned bots" />
            </span>
            <span>
              <FieldLabel label="Save/profile" />
            </span>
            <span>
              <FieldLabel label="CPU/RAM" />
            </span>
            <span>
              <FieldLabel label="Instance health check" />
            </span>
          </div>
          {instanceStatuses.length === 0 ? (
            <div className="empty-row">No game instances yet</div>
          ) : (
            instanceStatuses.map((instance) => (
              <div className="live-instance-row" key={instance.instanceId}>
                <span>{instance.instanceId}</span>
                <span>
                  {instance.status}
                  <small>{instance.processId ? `pid ${instance.processId}` : 'mock process'}</small>
                </span>
                <span>{instance.assignedBots.join(', ') || 'None'}</span>
                <span>
                  {instance.saveProfileId ?? 'Shared/default'}
                  {instance.isolatedSaveDirectory ? <small>{instance.isolatedSaveDirectory}</small> : null}
                </span>
                <span>
                  {instance.resourceUsage?.cpuPercent ?? 0}% / {instance.resourceUsage?.ramMb ?? 0} MB
                </span>
                <span>{['crashed', 'unresponsive', 'failed'].includes(instance.status) ? instance.status : 'Healthy'}</span>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="viability-panel" aria-label="Live logs">
        <div>
          <p className="eyebrow">Logs</p>
          <h2>Recent backend events</h2>
        </div>
        <div className="notice-list">
          {logs.length === 0 ? (
            <span>No logs yet</span>
          ) : (
            logs.slice(-8).map((log) => (
              <span key={log.id}>
                [{log.level}] {log.message}
              </span>
            ))
          )}
        </div>
      </section>
    </section>
  );
}
