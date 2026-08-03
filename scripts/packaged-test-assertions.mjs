function rawPayload(log) {
  const raw = log?.raw;
  return raw && typeof raw === 'object' ? raw : {};
}

export function assertSuccessfulPackagedAction({
  botStatuses,
  structuredLogs,
  expectedActionType
}) {
  const matchingBot = botStatuses.find((bot) => bot.currentAction === expectedActionType);
  if (!matchingBot) {
    throw new Error(
      `The packaged bot did not perform ${expectedActionType}: ${JSON.stringify({
        botStatuses,
        recentLogs: structuredLogs.slice(-20)
      })}`
    );
  }
  if (!matchingBot.lastResult?.startsWith('succeeded')) {
    throw new Error(
      `The packaged bot action failed: ${JSON.stringify({
        action: matchingBot.currentAction,
        result: matchingBot.lastResult
      })}`
    );
  }

  const actionLog = structuredLogs.find((log) => {
    if (log.eventType !== 'action_performed') {
      return false;
    }
    const payload = rawPayload(log).payload;
    return payload &&
      typeof payload === 'object' &&
      payload.actionType === expectedActionType;
  });
  const payload = actionLog ? rawPayload(actionLog).payload : undefined;

  if (!actionLog || !payload || typeof payload !== 'object') {
    throw new Error(
      `The packaged action ${expectedActionType} was not written to structured logs.`
    );
  }
  if (payload.status !== 'succeeded') {
    throw new Error(
      `The packaged action log reported ${String(payload.status ?? 'no result')}, not succeeded.`
    );
  }

  return actionLog;
}

export function assertExpectedPackagedState(state, expectedActionType) {
  if (!state || state.actionCount < 1 || state.currentScreen !== expectedActionType) {
    throw new Error(
      `The packaged game state did not change after ${expectedActionType}: ${JSON.stringify(state)}`
    );
  }
  if (state.lastActionType !== expectedActionType) {
    throw new Error(
      `The packaged game server did not observe ${expectedActionType}: ${JSON.stringify(state)}`
    );
  }
}

export function assertSessionReportContainsAction(report, expectedActionType) {
  if (!report.includes(expectedActionType)) {
    throw new Error(
      `The packaged session report does not contain action ${expectedActionType}.`
    );
  }
}
