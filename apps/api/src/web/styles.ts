// Served from code rather than a file so dist/ needs no copy step. Colour pairs were checked with the antislop
// contrast script: ink/paper 13.9, muted/paper 6.4, white/pine 7.8, brick/paper 5.8, input border/white 4.5,
// danger/danger-soft 8.0, danger border/danger-soft 5.7.
export const APP_CSS = `
:root {
  --ink: #1c2430;
  --muted: #4f5866;
  --paper: #f4f2ec;
  --surface: #ffffff;
  --line: #d6d1c4;
  --field: #7c766a;
  --pine: #1f5c49;
  --pine-soft: #e9f1ee;
  --brick: #a63b12;
  --danger: #8c1d18;
  --danger-soft: #fdeceb;
  --danger-line: #b3261e;
  --mono: ui-monospace, "Cascadia Mono", Consolas, monospace;
  color-scheme: light;
}
* { box-sizing: border-box; }
html { font-size: 100%; }
body {
  margin: 0;
  font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
  font-size: 0.9375rem;
  line-height: 1.5;
  color: var(--ink);
  background: var(--paper);
}
a { color: var(--pine); }
:focus-visible { outline: 3px solid var(--pine); outline-offset: 2px; }
.skip { position: absolute; left: -999px; top: 0.5rem; background: var(--surface); padding: 0.5rem 0.75rem; }
.skip:focus { left: 0.5rem; z-index: 2; }

.shell { display: grid; grid-template-columns: 13rem minmax(0, 1fr); min-height: 100vh; }
.side { background: var(--surface); border-right: 1px solid var(--line); padding: 1.25rem 0.75rem; display: flex; flex-direction: column; gap: 1rem; }
.brand { margin: 0 0.5rem; font-weight: 700; font-size: 1.05rem; letter-spacing: 0.01em; }
.side ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.25rem; }
.side a { display: flex; align-items: center; gap: 0.65rem; min-height: 44px; padding: 0 0.75rem; border-radius: 6px; color: var(--ink); text-decoration: none; }
.icon { flex: none; width: 1.25rem; height: 1.25rem; }
.type-logo { display: block; width: 1.375rem; height: 1.375rem; }
.side a .icon { color: var(--muted); }
.side a[aria-current="page"] .icon { color: #ffffff; }
.side a:hover { background: var(--paper); }
.side a[aria-current="page"] { background: var(--pine); color: #ffffff; font-weight: 600; }
.logout { margin-top: auto; }

main { padding: 1.5rem 2rem 3rem; min-width: 0; }
main:focus { outline: none; }
h1 { font-size: 1.5rem; margin: 0 0 1rem; }
h2 { font-size: 1.1rem; margin: 2rem 0 0.25rem; }
.lead { margin: 0 0 0.75rem; color: var(--muted); }
.notice { background: var(--pine-soft); border: 1px solid var(--pine); border-radius: 6px; padding: 0.6rem 0.9rem; margin: 0 0 1rem; }
.notice-error { background: var(--danger-soft); border-color: var(--danger-line); color: var(--danger); }
.empty { color: var(--muted); margin: 0.75rem 0; }

.stats { display: flex; flex-wrap: wrap; margin: 0 0 0.5rem; padding: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; }
.stats div { display: flex; flex-direction: column; padding: 0.75rem 1.5rem; border-right: 1px solid var(--line); }
.stats div:last-child { border-right: 0; }
.stats dt { color: var(--muted); font-size: 0.85rem; }
.stats dd { margin: 0; font-size: 1.5rem; font-weight: 600; font-variant-numeric: tabular-nums; }

.table-wrap { overflow-x: auto; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 0.55rem 0.75rem; border-bottom: 1px solid var(--line); vertical-align: top; }
thead th { font-size: 0.85rem; color: var(--muted); font-weight: 600; white-space: nowrap; background: #faf9f5; }
tbody tr:hover { background: #fbfaf7; }
tbody tr:last-child th, tbody tr:last-child td { border-bottom: 0; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
.code { font-family: var(--mono); font-size: 0.85rem; }
.path { font-family: var(--mono); font-size: 0.8rem; word-break: break-all; }
.urgent { color: var(--brick); font-weight: 600; }
.muted { color: var(--muted); }

.filters { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 0.75rem; margin: 0 0 1rem; }
.filters label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem; color: var(--muted); }
input, select { font: inherit; color: var(--ink); background: var(--surface); border: 1px solid var(--field); border-radius: 6px; min-height: 44px; padding: 0 0.6rem; }
input[type="search"] { min-width: 16rem; }
button { font: inherit; min-height: 44px; padding: 0 1rem; border-radius: 6px; border: 1px solid var(--pine); background: var(--pine); color: #ffffff; cursor: pointer; display: inline-flex; align-items: center; gap: 0.5rem; }
button:hover { background: #184a3b; }
button.secondary:hover { background: var(--pine-soft); }
button:disabled { opacity: 0.6; cursor: progress; }
.toolbar { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0.25rem 0 1rem; }
td:has(> .actions) { width: 1%; white-space: nowrap; }
td:has(> .actions) .actions { flex-wrap: nowrap; }
table[aria-label="Login Hostinger"] :is(td:nth-child(3), td:nth-child(4)) { white-space: nowrap; }
button.secondary { background: var(--surface); color: var(--pine); }
button.small { min-height: 2rem; padding: 0 0.6rem; font-size: 0.85rem; gap: 0.35rem; }
button.small .icon { width: 1rem; height: 1rem; }
.expiry-check { margin-left: 0.5rem; }
button.link-button { display: flex; align-items: center; gap: 0.65rem; background: none; border: 0; color: var(--muted); padding: 0 0.75rem; text-align: left; width: 100%; border-radius: 6px; }
button.link-button:hover { background: var(--paper); }
button.link-button:hover { color: var(--ink); }
.inline-form { display: inline; }
.actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.pager { display: flex; flex-wrap: wrap; gap: 0.35rem; align-items: center; margin: 1rem 0; }
.page { min-width: 44px; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; padding: 0 0.5rem; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--ink); text-decoration: none; font-variant-numeric: tabular-nums; }
a.page:hover { border-color: var(--pine); color: var(--pine); }
.page.current { background: var(--pine); border-color: var(--pine); color: #ffffff; font-weight: 600; }
.page[aria-disabled="true"] { color: var(--field); background: transparent; }
.page-gap { min-width: 1.5rem; text-align: center; color: var(--muted); }
.domain-title { display: flex; align-items: center; gap: 0.5rem; overflow-wrap: anywhere; }
a.external { display: inline-flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; color: var(--pine); }
th a.external { min-width: 1.75rem; min-height: 1.75rem; margin: -0.25rem 0; vertical-align: middle; }
th a.external .icon { width: 1rem; height: 1rem; }
.back-row { margin: 1rem 0 0; }
.back-link { display: inline-flex; align-items: center; gap: 0.4rem; min-height: 44px; padding: 0 1rem 0 0.65rem; border: 1px solid var(--pine); border-radius: 6px; background: var(--surface); color: var(--pine); text-decoration: none; }
.back-link:hover { background: var(--pine-soft); }

dl.detail { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 0.4rem 1.25rem; margin: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 1rem 1.25rem; }
dl.detail dt { color: var(--muted); }
dl.detail dd { margin: 0; overflow-wrap: anywhere; }

.login-page { display: grid; place-items: center; min-height: 100vh; padding: 1rem; }
.login-card { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 2rem; width: min(24rem, 100%); }
.login-card h1 { margin-bottom: 1.25rem; text-align: center; }
.login-form { display: flex; flex-direction: column; gap: 0.5rem; }
.login-form button { margin-top: 0.75rem; justify-content: center; }
.login-page .busy-note { display: none; }

.busy { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: 1rem; background: rgba(28, 36, 48, 0.45); }
.busy[hidden] { display: none; }
/* The only shadow in the UI: it lifts the progress card above the scrim. */
.busy-card { background: var(--surface); border-radius: 10px; padding: 1.5rem 1.75rem; width: min(24rem, 100%); display: flex; flex-direction: column; align-items: center; gap: 0.5rem; text-align: center; box-shadow: 0 12px 32px rgba(28, 36, 48, 0.25); }
.busy-text { margin: 0.5rem 0 0; font-weight: 600; }
.busy-note { margin: 0; color: var(--muted); font-size: 0.9rem; }
.spinner { width: 2.75rem; height: 2.75rem; border-radius: 50%; border: 4px solid var(--pine-soft); border-top-color: var(--pine); animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation: none; border-right-color: var(--pine); } }

@media (max-width: 48rem) {
  .shell { grid-template-columns: minmax(0, 1fr); }
  .side { border-right: 0; border-bottom: 1px solid var(--line); padding: 0.75rem; }
  .side ul { flex-direction: row; flex-wrap: wrap; }
  .logout { margin-top: 0; }
  .stats div { flex: 1 1 40%; border-right: 0; border-bottom: 1px solid var(--line); }
  main { padding: 1rem; }
  input[type="search"] { min-width: 0; width: 100%; }
  .filters label { flex: 1 1 100%; }
}
`;
