import { expect, test } from "vitest";
import { pageItems } from "./pager.js";

test("short ranges list every page", () => {
  expect(pageItems(1, 1)).toEqual([1]);
  expect(pageItems(2, 6)).toEqual([1, 2, 3, 4, 5, 6]);
});

test("long ranges keep the ends and two neighbours, with gaps", () => {
  expect(pageItems(1, 20)).toEqual([1, 2, 3, "gap", 20]);
  expect(pageItems(10, 20)).toEqual([1, "gap", 8, 9, 10, 11, 12, "gap", 20]);
  expect(pageItems(20, 20)).toEqual([1, "gap", 18, 19, 20]);
});

test("a gap of exactly one page shows that page instead", () => {
  expect(pageItems(5, 20)).toEqual([1, 2, 3, 4, 5, 6, 7, "gap", 20]);
});
