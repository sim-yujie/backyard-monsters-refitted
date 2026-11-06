// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { DEV_STATS_KEY, devStats, setDevStats } from "./devDetails";

describe("devStats, the status lines' counts (beta 6)", () => {
  afterEach(() => {
    localStorage.removeItem(DEV_STATS_KEY);
    setDevStats(null);
  });

  it("is off for normal play, the dev server included", () => {
    expect(devStats()).toBe(false);
  });

  it("turns on in a dev build once the bymr.devStats switch is set", () => {
    localStorage.setItem(DEV_STATS_KEY, "1");
    expect(devStats()).toBe(import.meta.env.DEV);
    localStorage.setItem(DEV_STATS_KEY, "0");
    expect(devStats()).toBe(false);
  });

  it("follows a test's setting whatever the switch says", () => {
    setDevStats(true);
    expect(devStats()).toBe(true);
    localStorage.setItem(DEV_STATS_KEY, "1");
    setDevStats(false);
    expect(devStats()).toBe(false);
  });
});
