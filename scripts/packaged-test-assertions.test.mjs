import { describe, expect, it } from 'vitest';
import {
  assertExpectedPackagedState,
  assertSessionReportContainsAction,
  assertSuccessfulPackagedAction
} from './packaged-test-assertions.mjs';

function actionLog(status = 'succeeded') {
  return {
    eventType: 'action_performed',
    raw: {
      payload: {
        actionType: 'open-menu',
        status
      }
    }
  };
}

describe('packaged smoke assertions', () => {
  it('accepts a succeeded action with matching state, log, and report evidence', () => {
    expect(() => assertSuccessfulPackagedAction({
      botStatuses: [{ currentAction: 'open-menu', lastResult: 'succeeded: Menu opened.' }],
      structuredLogs: [actionLog()],
      expectedActionType: 'open-menu'
    })).not.toThrow();
    expect(() => assertExpectedPackagedState({
      actionCount: 1,
      currentScreen: 'open-menu',
      lastActionType: 'open-menu'
    }, 'open-menu')).not.toThrow();
    expect(() => assertSessionReportContainsAction(
      'Latest action: open-menu',
      'open-menu'
    )).not.toThrow();
  });

  it('fails the packaged smoke check when the bot action fails', () => {
    expect(() => assertSuccessfulPackagedAction({
      botStatuses: [{ currentAction: 'open-menu', lastResult: 'failed: Hook rejected action.' }],
      structuredLogs: [actionLog('failed')],
      expectedActionType: 'open-menu'
    })).toThrow(/bot action failed/i);
  });

  it('fails when the expected state mutation or report action is missing', () => {
    expect(() => assertExpectedPackagedState({
      actionCount: 0,
      currentScreen: 'main-menu'
    }, 'open-menu')).toThrow(/state did not change/i);
    expect(() => assertSessionReportContainsAction(
      'No action captured.',
      'open-menu'
    )).toThrow(/does not contain action/i);
  });
});
