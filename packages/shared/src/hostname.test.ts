import { expect, test } from "vitest";
import { isPlainHostname } from "./hostname.js";

test("plain hostnames pass; anything that could point elsewhere or break a URL path does not", () => {
  for (const ok of ["contoh.com", "blog.contoh.co.id", "a-b.xyz", "CONTOH.COM"]) expect(isPlainHostname(ok)).toBe(true);
  for (const bad of ["contoh", "x@evil.com", "a/b.com", "a:b.com", "-a.com", "a..com", "contoh.com/", "under_score.com", "a b.com"]) {
    expect(isPlainHostname(bad)).toBe(false);
  }
});
