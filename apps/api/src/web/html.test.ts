import { expect, test } from "vitest";
import { formatRelativeDays } from "./format.js";
import { html } from "./html.js";

test("escapes interpolated values but keeps nested html", () => {
  expect(html`<td>${"<script>x</script>"}</td>${html`<b>${"&"}</b>`}`.value).toBe(
    "<td>&lt;script&gt;x&lt;/script&gt;</td><b>&amp;</b>",
  );
});

test("joins arrays and drops null and undefined", () => {
  expect(html`<ul>${["<a>", html`<li>ok</li>`]}${null}${undefined}</ul>`.value).toBe("<ul>&lt;a&gt;<li>ok</li></ul>");
});

test("escapes quotes so values are safe inside attributes", () => {
  expect(html`<a title="${`"x' onclick="y`}">`.value).toBe('<a title="&quot;x&#39; onclick=&quot;y">');
});

test("relative days read naturally and never use an em dash", () => {
  const now = new Date("2026-11-12T12:00:00Z");
  expect(formatRelativeDays(new Date("2026-11-15T13:00:00Z"), now)).toBe("3 hari lagi");
  expect(formatRelativeDays(new Date("2026-11-12T18:00:00Z"), now)).toBe("hari ini");
  expect(formatRelativeDays(new Date("2026-11-10T11:00:00Z"), now)).toBe("lewat 2 hari");
  expect(formatRelativeDays(null, now)).toBe("tidak diketahui");
});
