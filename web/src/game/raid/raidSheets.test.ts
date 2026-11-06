import { describe, expect, it } from "vitest";
import type { Texture } from "pixi.js";
import type { RaidView } from "@/api/raid";
import { MONSTER_SPRITES } from "@/game/attack/monsterSpriteData";
import { sheetStandInUrl, sheetUrl } from "@/game/attack/monsterSprites";
import { raidSheetUrls, raidSheetWarmer, warmRaidSheets } from "./raidSheets";

/**
 * Patch 6.4: a raid's sheets are fetched while its warning is up, a minute or
 * more before the fight, so a slow line has them by the first wave.
 */

const CRABATRON = MONSTER_SPRITES["C10"]!;
const BRAIN = MONSTER_SPRITES["C9"]!;

const dreadnaut = (id = "r_1", phase: RaidView["phase"] = "warning"): RaidView => ({
  id,
  phase,
  tribe: "Dreadnaut",
  monsters: { C10: 77, C9: 77, C1: 0 },
  attackAt: 1_000,
  warned: 0,
});

const recorder = () => {
  const asked: string[] = [];
  const load = (url: string): Promise<Texture> => {
    asked.push(url);
    return Promise.reject(new Error("not in a test"));
  };
  return { asked, load };
};

describe("raidSheetUrls", () => {
  it("lists every stand-in first, then the full copies, once each", () => {
    expect(raidSheetUrls({ C10: 77, C9: 77, C1: 0 })).toEqual([
      sheetStandInUrl(CRABATRON),
      sheetStandInUrl(BRAIN),
      sheetUrl(CRABATRON),
      sheetUrl(BRAIN),
    ]);
  });

  it("skips a monster with no sheet", () => {
    expect(raidSheetUrls({ NOPE: 3 })).toEqual([]);
  });
});

describe("warmRaidSheets", () => {
  it("asks the loader for each URL and swallows a failure", async () => {
    const { asked, load } = recorder();
    expect(warmRaidSheets({ C10: 1 }, load)).toEqual(asked);
    expect(asked).toEqual([sheetStandInUrl(CRABATRON), sheetUrl(CRABATRON)]);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe("raidSheetWarmer", () => {
  it("warms a raid once, in its warning", () => {
    const { asked, load } = recorder();
    const warm = raidSheetWarmer(load);
    warm(null);
    expect(asked).toEqual([]);
    warm(dreadnaut());
    expect(asked.length).toBe(4);
    warm(dreadnaut());
    expect(asked.length).toBe(4);
    warm(dreadnaut("r_2"));
    expect(asked.length).toBe(8);
  });

  it("leaves a raid already fighting alone", () => {
    const { asked, load } = recorder();
    raidSheetWarmer(load)(dreadnaut("r_3", "fighting"));
    expect(asked).toEqual([]);
  });
});
