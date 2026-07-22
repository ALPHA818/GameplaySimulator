import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LogsPage } from './LogsPage';
import { SettingsPage } from './SettingsPage';
import { LiveSessionPage } from './LiveSessionPage';

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
    expect(html).toContain('Advanced Intelligence');
    expect(html).toContain('0 enabled');
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

  it('uses auto-fit metric cards and toggle columns that fit their container', () => {
    const html = renderToStaticMarkup(<SettingsPage />);

    expect(occurrences(html, 'class="metric-card"')).toBe(4);
    expect(cssBlock('.settings-page .metric-grid--session')).toContain(
      'repeat(auto-fit, minmax(min(100%, 190px), 1fr))'
    );
    expect(cssBlock('.settings-page .toggle-grid')).toContain(
      'repeat(auto-fit, minmax(min(100%, 220px), 1fr))'
    );
  });

  it('keeps long toggle labels, checkboxes, and help marks together', () => {
    const html = renderToStaticMarkup(<SettingsPage />);
    const toggleLabelStyles = cssBlock('.settings-page .toggle-row__label');

    expect(html).toContain('Long Overnight Test Mode');
    expect(html).toContain('Engine-Specific Plugins');
    expect(html).toContain('Help for Long Overnight Test Mode');
    expect(toggleLabelStyles).toContain('min-width: 0');
    expect(toggleLabelStyles).toContain('flex: 1 1 auto');
    expect(cssBlock('.settings-page .toggle-row input')).toContain('flex: 0 0 auto');
    expect(globalCss).toContain('.settings-page .toggle-row__label .field-label__text');
    expect(globalCss).toContain('white-space: normal');
    expect(globalCss).toContain('overflow-wrap: anywhere');
    expect(html).toMatch(/Long Overnight Test Mode<\/label><span[^>]*class="field-help"/);
  });

  it('keeps warning notices constrained by their Settings cards', () => {
    const html = renderToStaticMarkup(<SettingsPage />);
    const observationSection = html.match(
      /<section class="form-section observation-settings-section">([\s\S]*?)<section class="form-section">/
    )?.[1] ?? '';

    expect(observationSection).toContain('observation-warning-list');
    expect(observationSection).toContain('Observation Resource Impact');
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
    expect(cssBlock('.live-session-page')).toContain('container-type: inline-size');
    expect(cssBlock('.observation-detail-grid')).toContain(
      'repeat(auto-fit, minmax(min(100%, 220px), 1fr))'
    );
    expect(cssBlock('.observation-controls')).toContain('flex-wrap: wrap');
    expect(narrowLiveSession).toContain('.observation-controls');
    expect(narrowLiveSession).toContain('grid-template-columns: minmax(0, 1fr)');
  });
});
