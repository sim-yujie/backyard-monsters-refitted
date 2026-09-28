import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CHAMPION_CATALOGUE,
  championEntry,
  championMaxHealth,
  evolveShinyPrice,
  feedRecipe,
  feedShinyPrice,
  STARVE_SECONDS,
} from "./championCatalogue.js";
import { championStats } from "./stats/championStats.js";

/**
 * The generated champion catalogue, from the server's side.
 *
 * `web/src/game/yard/championCatalogue.test.ts` checks the generator; this
 * file makes the sync assertion from the other direction (so a forgotten
 * regeneration fails both suites) and cross-checks the numbers against the
 * server's own stat table, which the attack gate trusts
 * (`server/src/services/maproom/validateAttack.ts`).
 */

const lf = (path: URL): string => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

describe("championCatalogue", () => {
  test("is the same file as the web client's copy", () => {
    const web = new URL("../../../web/src/game/yard/championCatalogue.ts", import.meta.url);
    const server = new URL("./championCatalogue.ts", import.meta.url);
    expect(lf(server)).toBe(lf(web));
  });

  test("agrees with the server's champion stat table", () => {
    for (const entry of CHAMPION_CATALOGUE) {
      const stat = championStats[entry.id]!;
      expect(stat.t, entry.id).toBe(entry.t);
      expect(stat.name, entry.id).toBe(entry.name);
      for (const key of [
        "health",
        "damage",
        "speed",
        "range",
        "healtime",
        "buffs",
        "feedCount",
        "feedShiny",
        "bonusFeedShiny",
        "bonusHealth",
        "bonusDamage",
        "bonusSpeed",
        "bonusRange",
        "bonusBuffs",
      ] as const) {
        expect([...entry[key]], `${entry.id}.${key}`).toEqual(stat.props[key]);
      }
      expect(entry.feedTime).toBe(stat.props.feedTime[0]!);
      expect(entry.bonusFeedTime).toBe(stat.props.bonusFeedTime[0]!);
    }
  });

  test("offers Gorgo, Drull and Fomor only (D17)", () => {
    expect(CHAMPION_CATALOGUE.filter((entry) => entry.raisable).map((entry) => entry.id)).toEqual([
      "G1",
      "G2",
      "G3",
    ]);
    expect(championEntry(4)?.raisable).toBe(false);
    expect(championEntry("G5")?.kind).toBe("special");
  });

  test("keeps the Map Room 2 recipes and the 23 h + 24 h clock", () => {
    // `client/scripts/CHAMPIONCAGE.as:539-546` (Gorgo), `:547-554` (Drull), `:555-565` (Fomor).
    expect(feedRecipe(championEntry("G1")!, 1, 0)).toEqual({ C2: 15 });
    expect(feedRecipe(championEntry("G2")!, 4, 0)).toEqual({ C7: 10, C8: 15 });
    expect(feedRecipe(championEntry("G3")!, 3, 0)).toEqual({ C3: 40, C9: 5 });
    expect(feedRecipe(championEntry("G1")!, 6, 0)).toEqual({ C10: 20 });
    expect(feedRecipe(championEntry("G1")!, 6, 3)).toEqual({ C10: 20 });
    expect(championEntry("G1")!.feedTime).toBe(23 * 3600);
    expect(STARVE_SECONDS).toBe(24 * 3600);
  });

  test("prices feeds, evolving and health as the original", () => {
    const gorgo = championEntry("G1")!;
    expect(feedShinyPrice(gorgo, 1, 0, true)).toBe(26);
    expect(feedShinyPrice(gorgo, 6, 0, true)).toBe(136);
    expect(feedShinyPrice(gorgo, 6, 1, false)).toBe(272);
    expect(evolveShinyPrice(gorgo, 1, 0)).toBe(26 * 2 * 3);
    expect(evolveShinyPrice(gorgo, 2, 4)).toBe(44 * 2 * 2);
    expect(championMaxHealth(gorgo, 6, 0)).toBe(200000);
    expect(championMaxHealth(gorgo, 6, 2)).toBe(227500);
  });
});
