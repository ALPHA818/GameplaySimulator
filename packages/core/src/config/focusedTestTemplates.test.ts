import { describe, expect, it } from 'vitest';
import { defaultBotProfiles } from '../bot/defaultBotProfiles';
import { BotTestDirectiveSchema } from '../types/botTestDirective';
import {
  createFocusedTestDirective,
  focusedTestTemplates
} from './focusedTestTemplates';

describe('focused test templates', () => {
  it('provides all fifteen focused specialist bundles with safe limits', () => {
    expect(focusedTestTemplates).toHaveLength(15);
    expect(new Set(focusedTestTemplates.map((template) => template.id)).size).toBe(15);

    const profileIds = new Set(defaultBotProfiles.map((profile) => profile.profileId));
    for (const template of focusedTestTemplates) {
      expect(profileIds.has(template.botProfileId), template.name).toBe(true);
      expect(template.actionCount).toBeGreaterThanOrEqual(10);
      expect(template.actionCount).toBeLessThanOrEqual(60);
      expect(template.runtimeMinutes).toBeGreaterThanOrEqual(5);
      expect(template.runtimeMinutes).toBeLessThanOrEqual(30);
      expect(template.actionDelayMs).toBeGreaterThanOrEqual(500);
      expect(template.requiredCapabilities.length).toBeGreaterThan(0);
      expect(template.directive.actionKeywords.length).toBeGreaterThan(0);
      expect(template.saveScreenshots).toBe(true);
    }
  });

  it('creates a validated directive targeted at each selected specialist', () => {
    for (const template of focusedTestTemplates) {
      const directive = createFocusedTestDirective({
        template,
        sessionId: 'session-focused-test',
        directiveId: `directive-${template.id}`,
        createdAt: '2026-07-28T12:00:00.000Z',
        selectedIssueId: template.id === 'reproduce-selected-issue' ? 'issue-042' : undefined
      });

      expect(BotTestDirectiveSchema.safeParse(directive).success, template.name).toBe(true);
      expect(directive.target.profileIds).toEqual([template.botProfileId]);
      expect(directive.maxActions).toBe(template.actionCount);
      expect(directive.timeoutMs).toBe(template.runtimeMinutes * 60_000);
      expect(directive.notes).toBe(`Focused template: ${template.id}`);
    }
  });

  it('uses the selected issue and otherwise creates an obvious editable placeholder', () => {
    const template = focusedTestTemplates.find(
      (item) => item.id === 'reproduce-selected-issue'
    )!;

    const selected = createFocusedTestDirective({
      template,
      sessionId: 'session-focused-test',
      directiveId: 'directive-selected-issue',
      createdAt: '2026-07-28T12:00:00.000Z',
      selectedIssueId: 'issue-099'
    });
    const placeholder = createFocusedTestDirective({
      template,
      sessionId: 'session-focused-test',
      directiveId: 'directive-placeholder-issue',
      createdAt: '2026-07-28T12:00:00.000Z'
    });

    expect(selected.targetIssueId).toBe('issue-099');
    expect(placeholder.targetIssueId).toBe('choose-an-issue-id');
  });
});
