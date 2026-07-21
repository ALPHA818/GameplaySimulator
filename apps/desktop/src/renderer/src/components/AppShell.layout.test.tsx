import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppShell } from './AppShell';
import { useConfigStore } from '../store/configStore';

const globalCss = readFileSync(
  resolve(process.cwd(), 'apps/desktop/src/renderer/src/styles/global.css'),
  'utf8'
);

function cssBlock(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = globalCss.match(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`));

  return match?.groups?.body ?? '';
}

function mediaBlock(query: string): string {
  const start = globalCss.indexOf(`@media ${query}`);

  if (start === -1) {
    return '';
  }

  const nextMedia = globalCss.indexOf('@media ', start + 1);

  return globalCss.slice(start, nextMedia === -1 ? undefined : nextMedia);
}

describe('AppShell stable sidebar layout', () => {
  it('renders accessible navigation labels for compact sidebar mode', () => {
    useConfigStore.setState({ currentPage: 'dashboard' });

    const html = renderToStaticMarkup(
      <AppShell>
        <section>Dashboard content</section>
      </AppShell>
    );

    expect(html).toContain('aria-label="Main"');
    expect(html).toContain('aria-label="Dashboard"');
    expect(html).toContain('aria-label="Help / First Test"');
    expect(html).toContain('title="Dashboard"');
    expect(html).toContain('title="Help / First Test"');
    expect(html).toContain('sidebar__brand-full');
    expect(html).toContain('sidebar__brand-short');
  });

  it('keeps the sidebar visible after the main content scrolls', () => {
    expect(cssBlock('.app-layout')).toContain('height: 100vh');
    expect(cssBlock('.app-layout')).toContain('overflow: hidden');
    expect(cssBlock('.sidebar')).toContain('position: sticky');
    expect(cssBlock('.sidebar')).toContain('top: 0');
    expect(cssBlock('.sidebar')).toContain('height: 100vh');
  });

  it('allows the sidebar to scroll internally when its navigation is too tall', () => {
    expect(cssBlock('.sidebar')).toContain('overflow-y: auto');
    expect(cssBlock('.sidebar')).toContain('min-height: 0');
    expect(cssBlock('.sidebar')).toContain('overscroll-behavior: contain');
  });

  it('keeps content scrolling independent from the sidebar', () => {
    expect(cssBlock('.app-layout')).toContain('overflow: hidden');
    expect(cssBlock('.content-shell')).toContain('height: 100vh');
    expect(cssBlock('.content-shell')).toContain('overflow-y: auto');
    expect(cssBlock('.content-shell')).toContain('overscroll-behavior: contain');
  });

  it('uses a compact vertical sidebar instead of a scrolling top bar on narrow windows', () => {
    const narrowLayout = mediaBlock('(max-width: 980px)');
    const phoneLayout = mediaBlock('(max-width: 640px)');

    expect(narrowLayout).toContain('grid-template-columns: 76px minmax(0, 1fr)');
    expect(narrowLayout).toContain('.sidebar');
    expect(narrowLayout).toContain('height: 100vh');
    expect(narrowLayout).toContain('.nav-button span');
    expect(narrowLayout).toContain('position: absolute');
    expect(phoneLayout).toContain('grid-template-columns: 64px minmax(0, 1fr)');
  });
});
