import { describe, expect, test } from "bun:test";

import { DEFAULT_WEEKEND_SETTINGS } from "../../game-data/events/weekendEvents.js";
import {
  applyWeekendChange,
  envForced,
  parseWeekendChange,
  readSettings,
  setWeekendSettings,
  storedWeekendSettings,
  weekendSettings,
} from "./weekendSettings.js";
import {
  costLessBy,
  lessByPercent,
  moreByPercent,
  shorterBy,
  weekendBoost,
  withPlunderBonus,
} from "./weekendBoosts.js";

const at = (iso: string) => Date.parse(iso) / 1000;

describe("weekend settings from storage", () => {
  test("no row, or a broken one, gives the defaults", () => {
    expect(readSettings(undefined)).toEqual(DEFAULT_WEEKEND_SETTINGS);
    expect(readSettings("junk")).toEqual(DEFAULT_WEEKEND_SETTINGS);
  });

  test("bad fields fall back one by one; good ones are kept", () => {
    const read = readSettings({
      enabled: false,
      rotation: ["study", "nope", "hatch"],
      percent: { builders: 95, plunder: 40, study: "x" },
      firstWeekend: "2026-11-13", // a Friday
      utcOffsetMinutes: 480,
      lengthHours: 0,
      announceHours: 12,
      overrides: { "2026-11-21": "skip", "2026-11-22": "hatch", "2026-11-28": "zzz" },
      forced: { id: "hatch", since: 10, until: 5 },
    });
    expect(read).toEqual({
      enabled: false,
      rotation: ["study", "hatch"],
      percent: { builders: 30, plunder: 40, study: 30, hatch: 30 },
      firstWeekend: "2026-11-14",
      utcOffsetMinutes: 480,
      lengthHours: 48,
      announceHours: 12,
      overrides: { "2026-11-21": "skip" },
      forced: null,
    });
  });
});

describe("dashboard changes", () => {
  test("refuses what the form should not send", () => {
    expect(parseWeekendChange(null).ok).toBe(false);
    expect(parseWeekendChange({ action: "settings", percent: { builders: 0 } }).ok).toBe(false);
    expect(parseWeekendChange({ action: "settings", percent: { builders: 91 } }).ok).toBe(false);
    expect(parseWeekendChange({ action: "settings", rotation: [] }).ok).toBe(false);
    expect(parseWeekendChange({ action: "settings", rotation: ["bogus"] }).ok).toBe(false);
    expect(parseWeekendChange({ action: "settings", firstWeekend: "2026-11-15" }).ok).toBe(false);
    expect(parseWeekendChange({ action: "weekend", weekend: "2026-11-15", event: "skip" }).ok).toBe(false);
    expect(parseWeekendChange({ action: "force", event: "study", hours: 0 }).ok).toBe(false);
    expect(parseWeekendChange({ action: "force", event: "study", hours: 73 }).ok).toBe(false);
    expect(parseWeekendChange({ action: "explode" }).ok).toBe(false);
  });

  test("takes good ones", () => {
    expect(parseWeekendChange({ action: "settings", enabled: false, percent: { hatch: 50 } })).toEqual({
      ok: true,
      value: { action: "settings", enabled: false, percent: { hatch: 50 } },
    });
    expect(parseWeekendChange({ action: "weekend", weekend: "2026-11-21", event: null })).toEqual({
      ok: true,
      value: { action: "weekend", weekend: "2026-11-21", event: null },
    });
  });

  const now = at("2026-11-12T00:00:00Z");

  test("a percentage change keeps the others", () => {
    const next = applyWeekendChange(DEFAULT_WEEKEND_SETTINGS, { action: "settings", percent: { hatch: 50 } }, now);
    expect(next.percent).toEqual({ builders: 30, plunder: 30, study: 30, hatch: 50 });
  });

  test("swap, skip and back to the rotation for one weekend", () => {
    let s = applyWeekendChange(DEFAULT_WEEKEND_SETTINGS, { action: "weekend", weekend: "2026-11-14", event: "hatch" }, now);
    s = applyWeekendChange(s, { action: "weekend", weekend: "2026-11-21", event: "skip" }, now);
    expect(s.overrides).toEqual({ "2026-11-14": "hatch", "2026-11-21": "skip" });
    s = applyWeekendChange(s, { action: "weekend", weekend: "2026-11-14", event: null }, now);
    expect(s.overrides).toEqual({ "2026-11-21": "skip" });
  });

  test("old weekends' overrides are dropped on the next change", () => {
    const s = { ...DEFAULT_WEEKEND_SETTINGS, overrides: { "2026-09-05": "skip" as const, "2026-11-07": "skip" as const } };
    expect(applyWeekendChange(s, { action: "stopForce" }, now).overrides).toEqual(s.overrides);
    expect(applyWeekendChange(s, { action: "settings" }, now).overrides).toEqual({ "2026-11-07": "skip" });
  });

  test("run now, stop, and switching off ends a forced run", () => {
    let s = applyWeekendChange({ ...DEFAULT_WEEKEND_SETTINGS, enabled: false }, { action: "force", event: "plunder", hours: 2 }, now);
    expect(s.enabled).toBe(true);
    expect(s.forced).toEqual({ id: "plunder", since: now, until: now + 7200 });
    expect(applyWeekendChange(s, { action: "stopForce" }, now).forced).toBeNull();
    s = applyWeekendChange(s, { action: "settings", enabled: false }, now);
    expect(s.forced).toBeNull();
    expect(applyWeekendChange(s, { action: "reset" }, now)).toEqual(DEFAULT_WEEKEND_SETTINGS);
  });
});

describe("WEEKEND_FORCE (local pictures)", () => {
  test("forces an event off production only", () => {
    expect(envForced({ WEEKEND_FORCE: "hatch" })?.id).toBe("hatch");
    expect(envForced({ WEEKEND_FORCE: "hatch", ENV: "production" })).toBeNull();
    expect(envForced({ WEEKEND_FORCE: "nope" })).toBeNull();
    expect(weekendSettings({ WEEKEND_FORCE: "study" }).forced?.id).toBe("study");
  });
});

describe("weekend boost numbers", () => {
  test("30% less, more, faster", () => {
    expect(lessByPercent(1000, 30)).toBe(700);
    expect(lessByPercent(333, 30)).toBe(234); // rounded up
    expect(lessByPercent(0, 30)).toBe(0);
    expect(lessByPercent(1000, 0)).toBe(1000);
    expect(moreByPercent(1000, 30)).toBe(1300);
    expect(moreByPercent(7, 30)).toBe(9); // rounded down
    expect(shorterBy(86_400, 30)).toBe(60_480);
    expect(shorterBy(1, 30)).toBe(1);
    expect(costLessBy({ r1: 100, r2: 0, r3: 10, r4: 1 }, 30)).toEqual({ r1: 70, r2: 0, r3: 7, r4: 1 });
    expect(withPlunderBonus({ r1: 100, r2: 0, r3: 10, r4: 1 }, 30)).toEqual({ r1: 130, r2: 0, r3: 13, r4: 1 });
  });

  test("the boost read from memory follows the stored settings", () => {
    const now = at("2026-11-10T10:00:00Z");
    // The suite runs with weekend events off (`testing/preload.ts`): put that back after.
    const before = storedWeekendSettings().settings;
    try {
      setWeekendSettings({ ...DEFAULT_WEEKEND_SETTINGS, forced: { id: "hatch", since: now, until: now + 60 } });
      const env = process.env.WEEKEND_FORCE;
      delete process.env.WEEKEND_FORCE;
      expect(weekendBoost("hatch", now)).toBe(30);
      expect(weekendBoost("hatch", now + 60)).toBe(0);
      expect(weekendBoost("study", now)).toBe(0);
      if (env !== undefined) process.env.WEEKEND_FORCE = env;
    } finally {
      setWeekendSettings(before);
    }
  });
});
