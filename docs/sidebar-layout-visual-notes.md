# Sidebar Layout Visual Notes

Use these notes when checking the stable sidebar layout in a browser or Electron window.

Expected behavior for every page:

- The sidebar remains visible while the main content scrolls.
- The sidebar scrolls internally if its own navigation becomes taller than the window.
- The main content scrolls inside `.content-shell`.
- At narrow widths, the sidebar collapses to an icon-width rail instead of becoming a top bar.
- Tooltip help popovers render above the sidebar and main content.

Pages to check:

- Dashboard
- Game profile editor
- New session
- Live session
- Logs
- Reports
- Help / First Test
