import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Save } from "../../database/models/save.model.js";
import { FilterFrontendKeys } from "../../utils/FrontendKey.js";
import { POOL_FIELDS } from "../yard/poolView.js";
import { emptyStats, isEarned, needsBackfill, readAchievements, updateAchievements } from "./state.js";

/** `save.achievements`, the achievements' server-only record (issue #204, `docs/design/achievements.md` §6). */

describe("readAchievements", () => {
  test("a NULL column reads empty, with the backfill still to run", () => {
    for (const achievements of [null, undefined, "nonsense", [1, 2], 7]) {
      const record = readAchievements({ achievements });
      expect(record).toEqual({ v: 1, s: emptyStats(), c: {} });
      expect(needsBackfill(record)).toBe(true);
    }
  });

  test("every stat is present, zero by default", () => {
    expect(Object.keys(emptyStats())).toHaveLength(19);
    expect(Object.values(emptyStats()).every((value) => value === 0)).toBe(true);
  });

  test("keeps every stored field and drops what it cannot read", () => {
    const stored = {
      v: 1,
      s: { thlevel: 6, blocksbuilt: 140.8, heavytraps: -2, wm2hall: "1", made_up: 9 },
      c: {
        "1": { at: 100, shiny: 5, seen: 1 },
        "6": { at: 200, shiny: 10, backfill: 1 },
        "13": { at: 250, shiny: 5, unpaid: true },
        "99": { at: 300, shiny: 0 },
        "0": { at: 1, shiny: 1 },
        "x": { at: 1, shiny: 1 },
        "7": { shiny: 10 },
        "8": "yes",
      },
      backfilledAt: 90,
      extra: true,
    };
    const record = readAchievements({ achievements: stored });

    expect(record).toEqual({
      v: 1,
      s: { ...emptyStats(), thlevel: 6, blocksbuilt: 140 },
      c: {
        "1": { at: 100, shiny: 5, seen: 1 },
        "6": { at: 200, shiny: 10, backfill: 1 },
        // Owed while rewards are off (`record.ts`).
        "13": { at: 250, shiny: 5, unpaid: 1 },
        // An id the catalogue does not know is kept: it has been paid.
        "99": { at: 300, shiny: 0 },
      },
      backfilledAt: 90,
    });
    expect(needsBackfill(record)).toBe(false);
    expect(isEarned(record, 6)).toBe(true);
    expect(isEarned(record, 7)).toBe(false);

    // A copy: editing it never reaches the stored record.
    record.c["1"]!.seen = undefined;
    record.s.thlevel = 10;
    expect(stored.c["1"].seen).toBe(1);
    expect(stored.s.thlevel).toBe(6);
  });
});

describe("updateAchievements", () => {
  test("changes only what the change touches, and leaves the save as it was", () => {
    const save = { achievements: { v: 1, s: { thlevel: 3 }, c: { "1": { at: 5, shiny: 5 } }, backfilledAt: 4 } };
    const next = updateAchievements(save, (record) => {
      record.s.blocksbuilt += 1;
    });

    expect(next.s.thlevel).toBe(3);
    expect(next.s.blocksbuilt).toBe(1);
    expect(next.c).toEqual({ "1": { at: 5, shiny: 5 } });
    expect(next.backfilledAt).toBe(4);
    expect((save.achievements.s as { blocksbuilt?: number }).blocksbuilt).toBeUndefined();
  });
});

describe("the column", () => {
  test("the client can never write it, and no load sends it", () => {
    expect(Save.saveKeys).not.toContain("achievements");
    expect(Save.attackSaveKeys).not.toContain("achievements");

    const save = new Save();
    expect(save.achievements).toBeNull();
    save.achievements = { v: 1, s: { thlevel: 10 }, c: {} };
    expect("achievements" in FilterFrontendKeys(save)).toBe(false);
  });

  test("an outpost's yard action reads and writes it on the main row", () => {
    expect(POOL_FIELDS.has("achievements")).toBe(true);
  });

  test("the migration adds a nullable jsonb column and fills nothing in", () => {
    const migration = readFileSync(
      path.join(import.meta.dirname, "../../database/migrations/20261005_AddAchievementsToSave.ts"),
      "utf8"
    );

    expect(migration).toContain(`ADD COLUMN IF NOT EXISTS "achievements" jsonb NULL`);
    expect(migration).not.toContain("UPDATE");
  });
});
