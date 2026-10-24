import { describe, expect, it } from "vitest";
import type { AdminHealthReport } from "./api";
import { changeText, sender } from "./bugs";
import { byWeek, captionFor, layoutChart, niceMax, tickLabel, whenLabel } from "./charts";
import { ago, bytes, count, dayLabel, duration, longDuration, plural, statusWord } from "./format";
import { topItems, verdict, type TopItem } from "./problems";
import { backupLevel, containerLevel, eventTotal, growth, total } from "./sections";

/** The owner dashboard's arithmetic and words (no DOM). */

describe("format", () => {
  it("spells numbers, sizes and times", () => {
    expect(count(1234567)).toBe("1,234,567");
    expect(count(null)).toBe("–");
    expect(bytes(512)).toBe("512 B");
    expect(bytes(1536)).toBe("1.5 KB");
    expect(bytes(48 * 1024 ** 2)).toBe("48 MB");
    expect(bytes(1.4 * 1024 ** 3)).toBe("1.4 GB");
    expect(bytes(null)).toBe("–");
    expect(duration(40)).toBe("40 s");
    expect(duration(3 * 60)).toBe("3 m");
    expect(duration(5 * 3600 + 120)).toBe("5 h 2 m");
    expect(duration(3 * 86400 + 4 * 3600)).toBe("3 d 4 h");
    const now = Date.parse("2026-10-23T12:00:00Z");
    expect(ago("2026-10-23T11:59:30Z", now)).toBe("just now");
    expect(ago("2026-10-23T11:55:00Z", now)).toBe("5 min ago");
    expect(ago("2026-10-23T09:00:00Z", now)).toBe("3 h ago");
    // Hours up to two days: a missed backup reads "31 h ago", not "1 d ago".
    expect(ago("2026-10-22T05:00:00Z", now)).toBe("31 h ago");
    expect(ago("2026-10-21T12:00:00Z", now)).toBe("2 d ago");
    expect(ago(null, now)).toBe("never");
    expect(dayLabel("2026-10-22")).toBe("Thu 22 Oct");
    expect(statusWord("wontfix")).toBe("Won't fix");
  });

  it("says how long in plain words", () => {
    expect(plural(1, "report")).toBe("1 report");
    expect(plural(1200, "report")).toBe("1,200 reports");
    expect(plural(2, "person", "people")).toBe("2 people");
    expect(longDuration(20)).toBe("under a minute");
    expect(longDuration(12 * 60)).toBe("12 minutes");
    expect(longDuration(3600 + 60)).toBe("1 hour 1 minute");
    expect(longDuration(5 * 3600)).toBe("5 hours");
    expect(longDuration(3 * 86400 + 4 * 3600 + 59)).toBe("3 days 4 hours");
  });
});

describe("charts", () => {
  it("rounds the scale up to 1, 2 or 5 times a power of ten", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(17)).toBe(20);
    expect(niceMax(20)).toBe(20);
    expect(niceMax(430)).toBe(500);
    expect(niceMax(1225)).toBe(2000);
    expect(tickLabel(1500)).toBe("1.5K");
    expect(tickLabel(250)).toBe("250");
    expect(tickLabel(2.5)).toBe("2.5");
  });

  it("lays out one slot per day, with gaps for days nobody counted", () => {
    const layout = layoutChart(
      [
        { day: "2026-10-20", value: 10 },
        { day: "2026-10-21", value: null },
        { day: "2026-10-22", value: 20 },
        { day: "2026-10-23", value: 5 },
      ],
      446,
      160,
    );
    expect(layout.max).toBe(20);
    expect(layout.ticks).toEqual([0, 10, 20]);
    expect(layout.xs).toEqual([89.75, 189.25, 288.75, 388.25]);
    expect(layout.ys[0]).toBe(layout.plot.bottom - (layout.plot.bottom - layout.plot.top) / 2);
    expect(layout.ys[1]).toBeNull();
    expect(layout.ys[2]).toBe(layout.plot.top);
    // A fresh "M" after the gap: the line does not bridge the unknown day.
    expect(layout.path.match(/M/g)).toHaveLength(2);
    expect(layout.path.startsWith("M 89.8")).toBe(true);
    expect(layout.labelled).toEqual([0, 1, 3]);
    expect(layout.barWidth).toBeLessThanOrEqual(18);
  });

  it("copes with no days and one day", () => {
    expect(layoutChart([], 300, 160)).toMatchObject({ xs: [], path: "", labelled: [], max: 1 });
    expect(layoutChart([{ day: "2026-10-22", value: 3 }], 300, 160).labelled).toEqual([0]);
  });

  it("starts a total's scale above zero when asked, so a slow climb still shows", () => {
    const points = [1000, 1100, 1250, 1883].map((value, i) => ({ day: `2026-10-2${i}`, value }));
    const fromZero = layoutChart(points, 300, 160);
    expect(fromZero.min).toBe(0);
    expect(fromZero.ticks).toEqual([0, 1000, 2000]);
    const above = layoutChart(points, 300, 160, false);
    expect(above.min).toBe(1000);
    expect(above.ticks).toEqual([1000, 1500, 2000]);
    expect(above.ys[0]).toBe(above.plot.bottom);
  });

  it("marks a long stretch of not-yet-counted days at the start", () => {
    const days = (values: (number | null)[]) =>
      values.map((value, i) => ({ day: `2026-10-${String(i + 1).padStart(2, "0")}`, value }));
    expect(layoutChart(days([null, null, null, null, 5, 6, 7, 8]), 300, 160).leadingGap).toEqual([0, 3]);
    // One or two missing days are just gaps; all missing is no chart at all.
    expect(layoutChart(days([null, 5, 6, 7, 8, 9, 10, 11]), 300, 160).leadingGap).toBeNull();
    expect(layoutChart(days([null, null, null]), 300, 160).leadingGap).toBeNull();
  });

  it("groups days into weeks, the newest week ending on the last day", () => {
    const days = Array.from({ length: 10 }, (_, i) => ({
      day: `2026-10-${String(i + 1).padStart(2, "0")}`,
      value: i < 2 ? null : i + 1,
    }));
    expect(byWeek(days, "sum")).toEqual([
      { day: "2026-10-01", value: 3, days: 3 },
      { day: "2026-10-04", value: 4 + 5 + 6 + 7 + 8 + 9 + 10, days: 7 },
    ]);
    expect(byWeek(days, "last").map((w) => w.value)).toEqual([3, 10]);
    expect(byWeek(days, "mean").map((w) => w.value)).toEqual([3, 7]);
    expect(byWeek(days.slice(0, 2), "sum")).toEqual([{ day: "2026-10-01", value: null, days: 2 }]);
  });

  it("captions a point, the number first", () => {
    expect(captionFor({ day: "2026-10-22", value: 1225 }, "players")).toBe(
      "1,225 players · Thu 22 Oct",
    );
    expect(captionFor({ day: "2026-10-22", value: null }, "players")).toBe(
      "Not counted · Thu 22 Oct",
    );
    expect(whenLabel({ day: "2026-10-12", value: 4, days: 7 })).toMatch(/^Week of 12 Oct/);
  });

  it("sums up a chart in one line's numbers", () => {
    const points = [null, 3, 5, 9].map((value, i) => ({ day: `2026-10-2${i}`, value }));
    expect(total(points)).toBe(17);
    expect(growth(points)).toBe(6);
    expect(total([{ day: "2026-10-20", value: null }])).toBeNull();
  });
});

const report = (overrides: Partial<AdminHealthReport> = {}): AdminHealthReport => ({
  health: {} as AdminHealthReport["health"],
  problems: [],
  unchecked: [],
  openAlerts: {},
  telegram: true,
  ...overrides,
});

describe("the box at the top", () => {
  it("is empty when nothing is wrong", () => {
    expect(topItems(report())).toEqual([]);
  });

  it("puts the server's problems first, then what could not be checked, then alerts being off", () => {
    const items = topItems(
      report({
        problems: [
          { key: "disk:/", title: "Disk nearly full", detail: "93% used", section: "health" },
          { key: "something-else", title: "A new check", detail: "Its words", section: "health" },
        ],
        unchecked: ["backup", "something-new"],
        telegram: false,
      }),
    );
    expect(items.map((item) => [item.level, item.title, item.section])).toEqual([
      // Without disk figures the plain title still reads right.
      ["bad", "The server's disk is nearly full", "health"],
      // A problem this page has no words for keeps the server's own.
      ["bad", "A new check", "health"],
      ["warn", "Backups could not be checked", "backups"],
      ["warn", '"something-new" could not be checked', "health"],
      ["warn", "Telegram alerts are off", "health"],
    ]);
    expect(items[0]!.steps.some((step) => step.command)).toBe(true);
  });

  it("names the disk's fullness when it is known", () => {
    const [item] = topItems(
      report({
        health: { disks: [{ usedPercent: 86.4 }, { usedPercent: 40 }] } as never,
        problems: [{ key: "disk:/", title: "", detail: "", section: "health" }],
      }),
    );
    expect(item!.title).toBe("The server's disk is 86% full");
  });

  it("sums the page up in one sentence", () => {
    const item = (level: TopItem["level"]) => ({ level }) as TopItem;
    expect(verdict([])).toBe("Everything is running fine");
    expect(verdict([item("warn")])).toBe("Running fine, 1 thing to check");
    expect(verdict([item("warn"), item("warn")])).toBe("Running fine, 2 things to check");
    expect(verdict([item("bad"), item("warn")])).toBe("1 problem needs you");
    expect(verdict([item("bad"), item("bad")])).toBe("2 problems need you");
  });
});

describe("the server's parts and backups", () => {
  const part = (overrides: Record<string, unknown>) =>
    ({
      service: "web",
      state: "running",
      health: null,
      restartCount: 0,
      startedAt: "",
      oomKilled: false,
      exitCode: null,
      ...overrides,
    }) as never;

  it("calls a part fine, worth a look, or broken", () => {
    expect(containerLevel(part({}))).toBe("ok");
    expect(containerLevel(part({ restartCount: 2 }))).toBe("warn");
    expect(containerLevel(part({ state: "exited" }))).toBe("bad");
    expect(containerLevel(part({ health: "unhealthy" }))).toBe("bad");
    // The database setup runs once and stops; only a failed run is bad.
    expect(containerLevel(part({ service: "db-init", state: "exited", exitCode: 0 }))).toBe("ok");
    expect(containerLevel(part({ service: "db-init", state: "exited", exitCode: 1 }))).toBe("bad");
  });

  it("calls a backup late after a day and missed after 26 hours", () => {
    expect(backupLevel(9, true)).toBe("ok");
    expect(backupLevel(25, true)).toBe("warn");
    expect(backupLevel(31, true)).toBe("bad");
    expect(backupLevel(null, false)).toBe("bad");
  });
});

describe("bug reports", () => {
  it("says who sent one", () => {
    expect(sender({ userid: null, username: null })).toBe("Signed out");
    expect(sender({ userid: 12, username: "bob" })).toBe("bob (#12)");
  });

  it("says what changed", () => {
    expect(
      changeText({ at: "", by: 1, status: { from: "new", to: "fixed" }, notes: null }),
    ).toBe("Status: New → Fixed");
    expect(changeText({ at: "", by: 1, status: { from: null, to: "new" }, notes: "" })).toBe(
      "Status: New · Notes cleared",
    );
    expect(changeText({ at: "", by: 1, status: null, notes: "Looked" })).toBe("Notes: Looked");
  });
});

describe("event players", () => {
  it("adds up every event of a day, and knows an untracked day", () => {
    const day = { eventPlayers: { a: 3, b: 4 } } as never;
    expect(eventTotal(day)).toBe(7);
    expect(eventTotal({ eventPlayers: null } as never)).toBeNull();
  });
});
