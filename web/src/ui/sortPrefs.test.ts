// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { loadSortPref, saveSortPref } from "./sortPrefs";

/** A list's remembered sort, and every way the saved value can be wrong. */

const KEY = "bymr.test.list-sort";
const SORTS = ["level", "name"] as const;
const FALLBACK = { sort: "level", direction: "desc" } as const;

/** A store that throws at every door, the way a blocked profile does. */
const hostile = (): Storage =>
  new Proxy({} as Storage, {
    get() {
      return () => {
        throw new Error("blocked");
      };
    },
  });

beforeEach(() => {
  window.localStorage.clear();
});

describe("sort preferences", () => {
  it("gives the fallback when nothing is saved", () => {
    expect(loadSortPref(KEY, SORTS, FALLBACK)).toEqual(FALLBACK);
  });

  it("reads back what was saved", () => {
    saveSortPref(KEY, { sort: "name", direction: "desc" });
    expect(loadSortPref(KEY, SORTS, FALLBACK)).toEqual({ sort: "name", direction: "desc" });
  });

  it("keeps each list's choice under its own key", () => {
    saveSortPref(KEY, { sort: "name", direction: "asc" });
    expect(loadSortPref("bymr.test.other-list", SORTS, FALLBACK)).toEqual(FALLBACK);
  });

  it.each([
    ["not JSON", "{oops"],
    ["a bare string", JSON.stringify("name")],
    ["null", "null"],
    ["an unknown sort", JSON.stringify({ sort: "height", direction: "asc" })],
    ["an unknown direction", JSON.stringify({ sort: "name", direction: "up" })],
    ["a missing direction", JSON.stringify({ sort: "name" })],
  ])("falls back on %s", (_, raw) => {
    window.localStorage.setItem(KEY, raw);
    expect(loadSortPref(KEY, SORTS, FALLBACK)).toEqual(FALLBACK);
  });

  it("shrugs off storage that throws or is missing", () => {
    expect(loadSortPref(KEY, SORTS, FALLBACK, hostile())).toEqual(FALLBACK);
    expect(() => saveSortPref(KEY, { sort: "name", direction: "asc" }, hostile())).not.toThrow();
    expect(loadSortPref(KEY, SORTS, FALLBACK, null)).toEqual(FALLBACK);
    expect(() => saveSortPref(KEY, { sort: "name", direction: "asc" }, null)).not.toThrow();
  });
});
