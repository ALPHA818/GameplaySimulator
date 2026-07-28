import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LogsPage } from './LogsPage';
import { SettingsPage } from './SettingsPage';
import { LiveSessionPage } from './LiveSessionPage';
import { BotProfilesPage } from './BotProfilesPage';
import { BotProfileEditorPage } from './BotProfileEditorPage';
import { NewSessionPage } from './NewSessionPage';

const globalCss = readFileSync(
  resolve(process.cwd(), 'apps/desktop/src/renderer/src/styles/global.css'),
  'utf8'
);

function cssBlock(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = globalCss.match(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`));

  return match?.groups?.body ?? '';
}

function responsiveBlock(rule: string): string {
  const start = globalCss.indexOf(rule);

  if (start === -1) {
    return '';
  }

  const nextContainer = globalCss.indexOf('@container ', start + rule.length);
  const nextMedia = globalCss.indexOf('@media ', start + rule.length);
  const candidates = [nextContainer, nextMedia].filter((index) => index !== -1);
  const end = candidates.length > 0 ? Math.min(...candidates) : globalCss.length;

  return globalCss.slice(start, end);
}

function occurrences(value: string, pattern: string): number {
  return value.split(pattern).length - 1;
}

describe('Settings responsive content layout', () => {
  it('keeps section headings and status pills in a wrapping layout', () => {
    const html = renderToStaticMarkup(<SettingsPage />);
    const headingStyles = cssBlock('.settings-page .section-heading');
    const pillStyles = cssBlock('.settings-page .section-heading .status-pill');

    expect(html).toContain('page-stack settings-page');
    expect(html).toContain('Real Runtime Readiness');
    expect(html).toContain('Adapter-first');
    expect(html).toContain('Live Bot Observation');
    expect(html).not.toContain('Advanced Intelligence');
    expect(headingStyles).toContain('display: flex');
    expect(headingStyles).toContain('flex-wrap: wrap');
    expect(headingStyles).toContain('align-items: flex-start');
    expect(headingStyles).toContain('justify-content: space-between');
    expect(cssBlock('.settings-page .section-heading > div')).toContain('min-width: 0');
    expect(cssBlock('.settings-page .section-heading > div')).toContain('flex: 1 1 260px');
    expect(pillStyles).toContain('width: fit-content');
    expect(pillStyles).toContain('min-width: 0');
    expect(pillStyles).toContain('white-space: normal');
  });

  it('uses auto-fit metric cards and observation toggle columns that fit their container', () => {
    const html = renderToStaticMarkup(<SettingsPage />);

    expect(occurrences(html, 'class="metric-card"')).toBe(7);
    expect(cssBlock('.settings-page .metric-grid--session')).toContain(
      'repeat(auto-fit, minmax(min(100%, 190px), 1fr))'
    );
    expect(cssBlock('.settings-page .toggle-grid')).toContain(
      'repeat(auto-fit, minmax(min(100%, 220px), 1fr))'
    );
  });

  it('keeps observation toggle labels, checkboxes, and help marks together', () => {
    const html = renderToStaticMarkup(<SettingsPage />);
    const toggleLabelStyles = cssBlock('.settings-page .toggle-row__label');

    expect(html).toContain('Bring Game To Front On Action');
    expect(html).toContain('Show Action Information');
    expect(html).toContain('Help for Bring Game To Front On Action');
    expect(toggleLabelStyles).toContain('min-width: 0');
    expect(toggleLabelStyles).toContain('flex: 1 1 auto');
    expect(cssBlock('.settings-page .toggle-row input')).toContain('flex: 0 0 auto');
    expect(globalCss).toContain('.settings-page .toggle-row__label .field-label__text');
    expect(globalCss).toContain('white-space: normal');
    expect(globalCss).toContain('overflow-wrap: anywhere');
    expect(html).toMatch(/Bring Game To Front On Action<\/label><span[^>]*class="field-help"/);
  });

  it('keeps warning notices constrained by their Settings cards', () => {
    const html = renderToStaticMarkup(<SettingsPage />);

    expect(html).toContain('observation-warning-list');
    expect(html).toContain('Observation Resource Impact');
    expect(cssBlock('.settings-page .metric-card,\n.settings-page .toggle-row,\n.settings-page .notice-list')).toContain(
      'max-width: 100%'
    );
    expect(globalCss).toContain('.settings-page .notice-list span');
    expect(globalCss).toContain('overflow-wrap: anywhere');
  });

  it('stacks Settings cards and pills from the page container width', () => {
    const narrowSettings = responsiveBlock('@container (max-width: 480px)');

    expect(cssBlock('.settings-page')).toContain('container-type: inline-size');
    expect(cssBlock('.settings-page')).toContain('max-width: 100%');
    expect(narrowSettings).toContain('.settings-page .section-heading');
    expect(narrowSettings).toContain('flex-direction: column');
    expect(narrowSettings).toContain('.settings-page .section-heading .status-pill');
    expect(narrowSettings).toContain('.settings-page .metric-grid--session');
    expect(narrowSettings).toContain('grid-template-columns: minmax(0, 1fr)');
  });
});

describe('Bot Profiles responsive recommendation layout', () => {
  it('keeps recommendation details and the batch action inside the content width', () => {
    const html = renderToStaticMarkup(<BotProfilesPage />);
    const summaryStyles = cssBlock('.bot-recommendation-summary');
    const buttonStyles = cssBlock('.bot-recommendation-summary .primary-button');
    const narrowProfiles = responsiveBlock('@container (max-width: 560px)');

    expect(html).toContain('Recommended Specialist Bots');
    expect(html).toContain('Add Recommended Bots To Session');
    expect(html).toContain('Compatible With Selected Game');
    expect(html).toContain('Missing Requirements');
    expect(summaryStyles).toContain('display: flex');
    expect(summaryStyles).toContain('flex-wrap: wrap');
    expect(summaryStyles).toContain('max-width: 100%');
    expect(buttonStyles).toContain('max-width: 100%');
    expect(buttonStyles).toContain('white-space: normal');
    expect(narrowProfiles).toContain('.bot-recommendation-summary');
    expect(narrowProfiles).toContain('flex-direction: column');
    expect(narrowProfiles).toContain('width: 100%');
  });

  it('keeps specialized cards and category filtering usable at narrow widths', () => {
    const html = renderToStaticMarkup(<BotProfilesPage />);
    const cardStyles = cssBlock('.bot-profile-card');
    const filterStyles = cssBlock('.bot-profile-filter select');
    const narrowProfiles = responsiveBlock('@container (max-width: 560px)');

    expect(html).toContain('id="specialized-bot-category"');
    expect(html).toContain('All Specialized Bots');
    expect(html).toContain('Gameplay Systems');
    expect(html).toContain('UI And Input');
    expect(cardStyles).toContain('min-width: 0');
    expect(cardStyles).toContain('max-width: 100%');
    expect(cardStyles).toContain('overflow: clip');
    expect(filterStyles).toContain('width: 100%');
    expect(filterStyles).toContain('min-width: 0');
    expect(narrowProfiles).toContain('.bot-profile-card__summary');
    expect(narrowProfiles).toContain('flex-direction: column');
  });
});

describe('Bot Profile Editor responsive layout', () => {
  it('uses container-fitting fields, traits, clone controls, and actions', () => {
    const html = renderToStaticMarkup(<BotProfileEditorPage />);
    const editorStyles = cssBlock('.bot-profile-editor-page');
    const fieldGridStyles = cssBlock('.profile-editor-grid,\n.profile-trait-grid');
    const cloneStyles = cssBlock('.profile-clone-row');
    const narrowEditor = responsiveBlock('@container (max-width: 560px)');

    expect(html).toContain('bot-profile-editor-page');
    expect(html).toContain('New Bot Profile');
    expect(html).toContain('Clone Existing Profile');
    expect(html).toContain('Help for Profile Name');
    expect(editorStyles).toContain('container-type: inline-size');
    expect(editorStyles).toContain('min-width: 0');
    expect(editorStyles).toContain('max-width: 100%');
    expect(fieldGridStyles).toContain(
      'repeat(auto-fit, minmax(min(100%, 230px), 1fr))'
    );
    expect(cloneStyles).toContain('grid-template-columns: minmax(0, 1fr) auto');
    expect(narrowEditor).toContain('.profile-editor-grid');
    expect(narrowEditor).toContain('.profile-clone-row');
    expect(narrowEditor).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(narrowEditor).toContain('.profile-editor-actions button');
    expect(narrowEditor).toContain('width: 100%');
  });
});

describe('Focused Test responsive layout', () => {
  it('keeps the specialist bundle and directive actions inside New Session content width', () => {
    const html = renderToStaticMarkup(<NewSessionPage />);
    const focusedGridStyles = cssBlock('.focused-template-grid');
    const focusedHeaderStyles = cssBlock('.focused-test-section .section-header-row');
    const narrowNewSession = responsiveBlock('@container (max-width: 520px)');

    expect(html).toContain('Focused Test Template');
    expect(html).toContain('Apply Focused Test');
    expect(html).toContain('Required Capabilities');
    expect(focusedGridStyles).toContain(
      'repeat(auto-fit, minmax(min(100%, 230px), 1fr))'
    );
    expect(focusedHeaderStyles).toContain('flex-wrap: wrap');
    expect(focusedHeaderStyles).toContain('max-width: 100%');
    expect(narrowNewSession).toContain('.focused-test-section .section-header-row');
    expect(narrowNewSession).toContain('.focused-template-grid');
    expect(narrowNewSession).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(cssBlock('.directive-editor-actions,\n.planned-directive-actions')).toContain(
      'flex-wrap: wrap'
    );
  });
});

describe('Logs responsive content layout', () => {
  it('keeps every filter, including the rightmost Instance filter, in the filter surface', () => {
    const html = renderToStaticMarkup(<LogsPage />);
    const filterSurface = html.match(/<section class="filter-surface filter-surface--logs"[^>]*>([\s\S]*?)<\/section>/)?.[1] ?? '';

    expect(html).toContain('page-stack log-page logs-page');
    expect(filterSurface).toContain('id="log-session-filter"');
    expect(filterSurface).toContain('id="log-search"');
    expect(filterSurface).toContain('id="log-source-filter"');
    expect(filterSurface).toContain('id="log-event-type-filter"');
    expect(filterSurface).toContain('id="log-bot-filter"');
    expect(filterSurface).toContain('id="log-instance-filter"');
    expect(filterSurface).toContain('Help for Instance');
  });

  it('uses container-fitting filter, summary, counter, and control grids', () => {
    expect(cssBlock('.logs-page')).toContain('container-type: inline-size');
    expect(cssBlock('.filter-surface--logs')).toContain(
      'repeat(auto-fit, minmax(min(100%, 180px), 1fr))'
    );
    expect(cssBlock('.log-summary-grid')).toContain(
      'repeat(auto-fit, minmax(min(100%, 190px), 1fr))'
    );
    expect(cssBlock('.log-counter-grid')).toContain(
      'repeat(auto-fit, minmax(min(100%, 160px), 1fr))'
    );
    expect(cssBlock('.log-controls')).toContain(
      'repeat(auto-fit, minmax(min(100%, 220px), 1fr))'
    );
    expect(cssBlock('.logs-page .filter-field select')).toContain('width: 100%');
    expect(cssBlock('.logs-page .filter-field select')).toContain('min-width: 0');
    expect(cssBlock('.logs-page .filter-field select')).toContain('max-width: 100%');
    expect(cssBlock('.filter-chip-list')).toContain('flex-wrap: wrap');
    expect(cssBlock('.log-tabs')).toContain('flex-wrap: wrap');
  });

  it('wraps Logs page actions and collapses detail layouts from content width', () => {
    const html = renderToStaticMarkup(<LogsPage />);
    const narrowLogs = responsiveBlock('@container (max-width: 760px)');

    expect(html).toContain('Reload Sessions');
    expect(html).toContain('Refresh Logs');
    expect(cssBlock('.logs-page .page-header')).toContain('flex-wrap: wrap');
    expect(cssBlock('.logs-page .page-actions')).toContain('max-width: 100%');
    expect(narrowLogs).toContain('.logs-page .page-header');
    expect(narrowLogs).toContain('flex-direction: column');
    expect(narrowLogs).toContain('.logs-page .review-layout--logs');
    expect(narrowLogs).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(narrowLogs).toContain('.logs-page .filter-chip-row');
  });

  it('renders wrapping filter chips and every log tab inside the page', () => {
    const html = renderToStaticMarkup(<LogsPage />);

    expect(html).toContain('class="filter-chip-list"');
    expect(html).toContain('class="log-tabs"');
    for (const label of [
      'Overview',
      'Important Events',
      'Full Logs',
      'Session',
      'Bot Actions',
      'Bot States',
      'Bot Issues',
      'Game Instances',
      'Adapter Logs',
      'Console/Page Errors',
      'Raw Files'
    ]) {
      expect(html).toContain(`>${label}<`);
    }
  });

  it('responds to both open and collapsed sidebar content widths', () => {
    const desktopShell = cssBlock('.app-layout');
    const compactShell = responsiveBlock('@media (max-width: 980px)');
    const phoneShell = responsiveBlock('@media (max-width: 640px)');

    expect(desktopShell).toContain('grid-template-columns: 248px minmax(0, 1fr)');
    expect(compactShell).toContain('grid-template-columns: 76px minmax(0, 1fr)');
    expect(phoneShell).toContain('grid-template-columns: 64px minmax(0, 1fr)');
    expect(compactShell).toContain('.content-shell');
    expect(phoneShell).toContain('.content-shell');
    expect(cssBlock('.logs-page')).toContain('container-type: inline-size');
  });
});

describe('Live Session observation layout', () => {
  it('uses the available content width and keeps every observation control visible', () => {
    const html = renderToStaticMarkup(<LiveSessionPage />);
    const narrowLiveSession = responsiveBlock('@container live-session (max-width: 620px)');

    expect(html).toContain('live-session-page');
    expect(html).toContain('Focus Game Window');
    expect(html).toContain('Follow This Bot');
    expect(html).toContain('Stop Following');
    expect(html).toContain('Show Previous Bot');
    expect(html).toContain('Show Next Bot');
    expect(html).toContain('Guide This Bot');
    expect(cssBlock('.live-session-page')).toContain('container-type: inline-size');
    expect(cssBlock('.observation-detail-grid')).toContain(
      'repeat(auto-fit, minmax(min(100%, 220px), 1fr))'
    );
    expect(cssBlock('.observation-controls')).toContain('flex-wrap: wrap');
    expect(narrowLiveSession).toContain('.observation-controls');
    expect(narrowLiveSession).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(cssBlock('.guidance-field-grid')).toContain(
      'repeat(auto-fit, minmax(min(100%, 220px), 1fr))'
    );
    expect(
      cssBlock('.guidance-quick-actions,\n.guidance-actions,\n.directive-queue-actions')
    ).toContain('flex-wrap: wrap');
    expect(narrowLiveSession).toContain('.guidance-field-grid');
  });

  it('keeps the live directive form and queue controls responsive', () => {
    const narrowLiveSession = responsiveBlock('@container live-session (max-width: 620px)');
    const queueRowStyles = cssBlock('.directive-queue-row');
    const queueActionStyles = cssBlock('.guidance-quick-actions,\n.guidance-actions,\n.directive-queue-actions');

    expect(cssBlock('.guidance-field-grid')).toContain(
      'repeat(auto-fit, minmax(min(100%, 220px), 1fr))'
    );
    expect(queueRowStyles).toContain('flex-wrap: wrap');
    expect(queueRowStyles).toContain('max-width: 100%');
    expect(queueActionStyles).toContain('flex-wrap: wrap');
    expect(narrowLiveSession).toContain('.guidance-field-grid');
    expect(narrowLiveSession).toContain('.directive-queue-row');
    expect(narrowLiveSession).toContain('flex-direction: column');
    expect(narrowLiveSession).toContain('.directive-queue-actions');
    expect(narrowLiveSession).toContain('width: 100%');
  });
});
