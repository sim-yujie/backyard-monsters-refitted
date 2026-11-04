import { describe, expect, test } from "bun:test";

import type { User } from "../../database/models/user.model.js";
import { LOOK_SEEN_INTERVAL_MS, LookReportSchema, lookNeedsWrite } from "./lookReport.js";

/** `POST /player/look`: what the client may send, and when the row is written. */

const NOW = new Date("2026-11-10T12:00:00Z");

const userWith = (fields: Partial<User>): User => ({ userid: 1, ...fields }) as User;

describe("the look report's shape", () => {
  test("takes the four choices", () => {
    expect(LookReportSchema.parse({ style: "classic", music: "flash", quality: "low", font: "readable" })).toEqual({
      style: "classic",
      music: "flash",
      quality: "low",
      font: "readable",
    });
  });

  test("needs only the Style", () => {
    expect(LookReportSchema.parse({ style: "modern" })).toEqual({ style: "modern" });
  });

  test("refuses a missing Style, an unknown value or an unknown key", () => {
    expect(LookReportSchema.safeParse({ music: "new" }).success).toBe(false);
    expect(LookReportSchema.safeParse({ style: "retro" }).success).toBe(false);
    expect(LookReportSchema.safeParse({ style: "modern", quality: "ultra" }).success).toBe(false);
    expect(LookReportSchema.safeParse({ style: "modern", colour: "red" }).success).toBe(false);
  });
});

describe("when a report is written", () => {
  const stored = {
    look_style: "modern",
    look_music: "style",
    look_quality: "high",
    look_font: "game",
  } as const;

  test("the first report always is", () => {
    expect(lookNeedsWrite(userWith({}), { style: "modern" }, NOW)).toBe(true);
  });

  test("an unchanged look within the hour is not", () => {
    const user = userWith({ ...stored, look_seen_at: new Date(NOW.getTime() - 10 * 60 * 1000) });
    expect(lookNeedsWrite(user, { style: "modern", music: "style", quality: "high", font: "game" }, NOW)).toBe(false);
    // A choice left out keeps what the row has, so it is no change either.
    expect(lookNeedsWrite(user, { style: "modern" }, NOW)).toBe(false);
  });

  test("an unchanged look an hour later is, so the last-seen time stays current", () => {
    const user = userWith({ ...stored, look_seen_at: new Date(NOW.getTime() - LOOK_SEEN_INTERVAL_MS) });
    expect(lookNeedsWrite(user, { style: "modern" }, NOW)).toBe(true);
  });

  test("any changed choice is, at once", () => {
    const user = userWith({ ...stored, look_seen_at: new Date(NOW.getTime() - 60 * 1000) });
    expect(lookNeedsWrite(user, { style: "classic" }, NOW)).toBe(true);
    expect(lookNeedsWrite(user, { style: "modern", music: "flash" }, NOW)).toBe(true);
    expect(lookNeedsWrite(user, { style: "modern", quality: "low" }, NOW)).toBe(true);
    expect(lookNeedsWrite(user, { style: "modern", font: "clear" }, NOW)).toBe(true);
  });
});
