import { describe, expect, it } from "vitest";
import type { Texture } from "pixi.js";
import type { RaidView } from "@/api/raid";
import { MONSTER_SPRITES } from "@/game/attack/monsterSpriteData";
import { sheetStandInUrl, sheetUrl } from "@/game/attack/monsterSprites";
import type { SheetWant } from "@/game/attack/sheetQueue";
import { TROJAN_ROSTER } from "@/game/trojan/trojanHorse";
import { raidSheetUrls, raidSheetWarmer, warmRaidSheets, warmTrojanSheets } from "./raidSheets";

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
  const standIns: string[] = [];
  const load = (url: string, want?: SheetWant): Promise<Texture> => {
    asked.push(url);
    if (want?.standIn) standIns.push(url);
    return Promise.reject(new Error("not in a test"));
  };
  return { asked, standIns, load };
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
    const { asked, standIns, load } = recorder();
    expect(warmRaidSheets({ C10: 1 }, load)).toEqual(asked);
    expect(asked).toEqual([sheetStandInUrl(CRABATRON), sheetUrl(CRABATRON)]);
    // The queue is told which is the stand-in, so it goes first.
    expect(standIns).toEqual([sheetStandInUrl(CRABATRON)]);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("goes on past a loader that throws", () => {
    const asked: string[] = [];
    const load = (url: string): Promise<Texture> => {
      asked.push(url);
      throw new Error("unknown URL");
    };
    expect(() => warmRaidSheets({ C10: 1, C9: 1 }, load)).not.toThrow();
    expect(asked).toHaveLength(4);
  });
});

/** The Trojan Horse's own order, as `server/src/services/raids/trojanArmy.ts` spawns it. */
const trojanSpawnOrder = (): string[] => {
  const kinds: string[] = [];
  for (let frame = 0; frame <= 1100; frame += 20) {
    const type = Math.ceil(Math.max(frame, 1) / 100);
    if (type === 5 || kinds.includes(`C${type}`)) continue;
    kinds.push(`C${type}`);
  }
  return kinds;
};

describe("warmTrojanSheets", () => {
  it("knows the horse's ten kinds in the order they come out", () => {
    expect(TROJAN_ROSTER).toEqual(trojanSpawnOrder());
  });

  it("fetches only the stand-ins while the horse stands on the yard, in spawn order", () => {
    const { asked, standIns, load } = recorder();
    warmTrojanSheets(false, load);
    const sheets = TROJAN_ROSTER.map((id) => MONSTER_SPRITES[id]!);
    expect(asked).toEqual(sheets.map((sheet) => sheetStandInUrl(sheet)));
    expect(standIns).toEqual(asked);
  });

  it("adds the paintings, after every stand-in, once the letter is open", () => {
    const { asked, standIns, load } = recorder();
    warmTrojanSheets(true, load);
    const sheets = TROJAN_ROSTER.map((id) => MONSTER_SPRITES[id]!);
    expect(asked).toEqual([
      ...sheets.map((sheet) => sheetStandInUrl(sheet)),
      ...sheets.map((sheet) => sheetUrl(sheet)),
    ]);
    expect(standIns).toHaveLength(TROJAN_ROSTER.length);
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
