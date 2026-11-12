import { html, type SafeHtml } from "./html.js";
import { icon } from "./icons.js";

export type PageItem = number | "gap";

export function pageItems(current: number, last: number): PageItem[] {
  const shown = new Set([1, last]);
  for (let page = current - 2; page <= current + 2; page++) if (page >= 1 && page <= last) shown.add(page);
  const pages = [...shown].sort((a, b) => a - b);
  const items: PageItem[] = [];
  pages.forEach((page, i) => {
    const previous = pages[i - 1];
    // A gap hiding a single page would save no space, so that page is shown instead.
    if (previous !== undefined && page - previous === 2) items.push(previous + 1);
    else if (previous !== undefined && page - previous > 2) items.push("gap");
    items.push(page);
  });
  return items;
}

export function pager(current: number, last: number, href: (page: number) => string): SafeHtml | "" {
  if (last <= 1) return "";
  const arrow = (page: number, enabled: boolean, label: string, name: "chevron-left" | "chevron-right") =>
    enabled
      ? html`<a class="page page-arrow" href="${href(page)}" aria-label="${label}">${icon(name)}</a>`
      : html`<span class="page page-arrow" aria-disabled="true" aria-label="${label}" role="link">${icon(name)}</span>`;
  const items = pageItems(current, last).map((item) =>
    item === "gap"
      ? html`<span class="page-gap" aria-hidden="true">…</span>`
      : item === current
        ? html`<span class="page current" aria-current="page">${item}</span>`
        : html`<a class="page" href="${href(item)}" aria-label="Halaman ${item}">${item}</a>`,
  );
  return html`<nav class="pager" aria-label="Pilih halaman">${arrow(current - 1, current > 1, "Halaman sebelumnya", "chevron-left")}${items}${arrow(
    current + 1,
    current < last,
    "Halaman berikutnya",
    "chevron-right",
  )}</nav>`;
}
