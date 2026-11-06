import { describe, expect, test } from "bun:test";

import { LOOK_DAYS, tallyLooks, type LookRow } from "./lookStats.js";

/** The dashboard's Modern/Classic counts, from the grouped rows (no database). */

const row = (style: string, music: string | null, quality: string | null, font: string | null, n: number | string): LookRow => ({
  look_style: style,
  look_music: music,
  look_quality: quality,
  look_font: font,
  n,
});

describe("tallyLooks", () => {
  test("adds each choice up across the groups", () => {
    const totals = tallyLooks([
      row("modern", "style", "high", "game", 5),
      row("modern", "new", "medium", "clear", "2"),
      row("classic", "flash", "low", "readable", 3),
      row("classic", "style", "high", "game", 1),
    ]);
    expect(totals).toEqual({
      days: LOOK_DAYS,
      reported: 11,
      style: { modern: 7, classic: 4 },
      music: { style: 6, new: 2, flash: 3 },
      quality: { high: 6, medium: 2, low: 3 },
      font: { game: 6, clear: 2, readable: 3 },
    });
  });

  test("lists every choice, with 0 when nobody picked it", () => {
    expect(tallyLooks([])).toEqual({
      days: LOOK_DAYS,
      reported: 0,
      style: { modern: 0, classic: 0 },
      music: { style: 0, new: 0, flash: 0 },
      quality: { high: 0, medium: 0, low: 0 },
      font: { game: 0, clear: 0, readable: 0 },
    });
  });

  test("a missing or unknown value counts the player but not the choice", () => {
    const totals = tallyLooks([row("modern", null, "ultra", null, 2)]);
    expect(totals.reported).toBe(2);
    expect(totals.style.modern).toBe(2);
    expect(totals.music).toEqual({ style: 0, new: 0, flash: 0 });
    expect(totals.quality).toEqual({ high: 0, medium: 0, low: 0 });
  });
});
