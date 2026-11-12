import { html, type SafeHtml } from "./html.js";

export type Section = "ringkasan" | "paket" | "website" | "sinkron";

const NAV: [Section, string, string][] = [
  ["ringkasan", "/ringkasan", "Ringkasan"],
  ["paket", "/paket", "Paket"],
  ["website", "/website", "Website"],
  ["sinkron", "/sinkron", "Sinkron & Audit"],
];

export function layout(opts: { title: string; active?: Section; message?: string; body: SafeHtml }): string {
  const items = NAV.map(
    ([key, href, label]) =>
      html`<li><a href="${href}"${key === opts.active ? html` aria-current="page"` : ""}>${label}</a></li>`,
  );
  return `<!doctype html>\n${
    html`<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${opts.title} · Hostinger Ops</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<a class="skip" href="#isi">Langsung ke isi</a>
<div class="shell">
<nav class="side" aria-label="Menu utama">
<p class="brand">Hostinger Ops</p>
<ul>${items}</ul>
<form method="post" action="/logout" class="logout"><button type="submit" class="link-button">Keluar</button></form>
</nav>
<main id="isi" tabindex="-1">
<h1>${opts.title}</h1>
${opts.message ? html`<p class="notice" role="status">${opts.message}</p>` : ""}
${opts.body}
</main>
</div>
</body>
</html>`.value
  }`;
}
