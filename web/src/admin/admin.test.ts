import { describe, expect, it } from "vitest";
import type { AdminHealthReport } from "./api";
import { changeText, sender } from "./bugs";
import { captionFor, layoutChart, niceMax, tickLabel } from "./charts";
import { ago, bytes, count, dayLabel, duration, statusWord } from "./format";
import { topItems } from "./problems";
import { eventTotal } from "./sections";

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
    expect(ago("2026-10-21T12:00:00Z", now)).toBe("2 d ago");
    expect(ago(null, now)).toBe("never");
    expect(dayLabel("2026-10-22")).toBe("Thu 22 Oct");
    expect(statusWord("wontfix")).toBe("Won't fix");
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
    expect(layout.xs).toEqual([90, 190, 290, 390]);
    expect(layout.ys[0]).toBe(layout.plot.bottom - (layout.plot.bottom - layout.plot.top) / 2);
    expect(layout.ys[1]).toBeNull();
    expect(layout.ys[2]).toBe(layout.plot.top);
    // A fresh "M" after the gap: the line does not bridge the unknown day.
    expect(layout.path.match(/M/g)).toHaveLength(2);
    expect(layout.path.startsWith("M 90.0")).toBe(true);
    expect(layout.labelled).toEqual([0, 1, 3]);
    expect(layout.barWidth).toBeLessThanOrEqual(18);
  });

  it("copes with no days and one day", () => {
    expect(layoutChart([], 300, 160)).toMatchObject({ xs: [], path: "", labelled: [], max: 1 });
    expect(layoutChart([{ day: "2026-10-22", value: 3 }], 300, 160).labelled).toEqual([0]);
  });

  it("captions a day", () => {
    expect(captionFor({ day: "2026-10-22", value: 1225 }, "players")).toBe(
      "Thu 22 Oct: 1,225 players",
    );
    expect(captionFor({ day: "2026-10-22", value: null }, "players")).toBe(
      "Thu 22 Oct: not known",
    );
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
        ],
        unchecked: ["backup", "something-new"],
        telegram: false,
      }),
    );
    expect(items.map((item) => [item.level, item.title, item.section])).toEqual([
      ["bad", "Disk nearly full", "health"],
      ["warn", "Backups could not be checked", "backups"],
      ["warn", '"something-new" could not be checked', "health"],
      ["warn", "Telegram alerts are off", "health"],
    ]);
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
