// Served from code rather than a file so dist/ needs no copy step. Colour pairs were checked with the antislop
// contrast script: ink/paper 13.9, muted/paper 6.4, white/pine 7.8, brick/paper 5.8, input border/white 4.5.
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
.side a { display: flex; align-items: center; min-height: 44px; padding: 0 0.75rem; border-radius: 6px; color: var(--ink); text-decoration: none; }
.side a:hover { background: var(--paper); }
.side a[aria-current="page"] { background: var(--pine); color: #ffffff; font-weight: 600; }
.logout { margin-top: auto; }

main { padding: 1.5rem 2rem 3rem; min-width: 0; }
main:focus { outline: none; }
h1 { font-size: 1.5rem; margin: 0 0 1rem; }
h2 { font-size: 1.1rem; margin: 2rem 0 0.25rem; }
.lead { margin: 0 0 0.75rem; color: var(--muted); }
.notice { background: var(--pine-soft); border: 1px solid var(--pine); border-radius: 6px; padding: 0.6rem 0.9rem; margin: 0 0 1rem; }
.empty { color: var(--muted); margin: 0.75rem 0; }

.stats { display: flex; flex-wrap: wrap; gap: 0.5rem 2rem; margin: 0 0 0.5rem; padding: 0; }
.stats div { display: flex; flex-direction: column; }
.stats dt { color: var(--muted); font-size: 0.85rem; }
.stats dd { margin: 0; font-size: 1.5rem; font-weight: 600; font-variant-numeric: tabular-nums; }

.table-wrap { overflow-x: auto; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 0.55rem 0.75rem; border-bottom: 1px solid var(--line); vertical-align: top; }
thead th { font-size: 0.85rem; color: var(--muted); font-weight: 600; white-space: nowrap; }
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
button { font: inherit; min-height: 44px; padding: 0 1rem; border-radius: 6px; border: 1px solid var(--pine); background: var(--pine); color: #ffffff; cursor: pointer; }
button.secondary { background: var(--surface); color: var(--pine); }
button.link-button { background: none; border: 0; color: var(--muted); padding: 0 0.75rem; text-align: left; width: 100%; }
button.link-button:hover { color: var(--ink); }
.inline-form { display: inline; }
.actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.pager { display: flex; gap: 1rem; align-items: center; margin: 0.75rem 0; }
.pager a { min-height: 44px; display: inline-flex; align-items: center; }

dl.detail { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 0.4rem 1.25rem; margin: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 1rem 1.25rem; }
dl.detail dt { color: var(--muted); }
dl.detail dd { margin: 0; overflow-wrap: anywhere; }

.login-page { display: grid; place-items: center; min-height: 100vh; padding: 1rem; }
.login-card { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 2rem; width: min(24rem, 100%); }
.login-card h1 { margin-bottom: 1.25rem; }
.login-form { display: flex; flex-direction: column; gap: 0.5rem; }
.login-form button { margin-top: 0.75rem; }

@media (max-width: 48rem) {
  .shell { grid-template-columns: minmax(0, 1fr); }
  .side { border-right: 0; border-bottom: 1px solid var(--line); padding: 0.75rem; }
  .side ul { flex-direction: row; flex-wrap: wrap; }
  .logout { margin-top: 0; }
  main { padding: 1rem; }
  input[type="search"] { min-width: 0; width: 100%; }
  .filters label { flex: 1 1 100%; }
}
`;
