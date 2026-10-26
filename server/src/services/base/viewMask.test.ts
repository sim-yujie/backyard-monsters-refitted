import { describe, expect, test } from "bun:test";

import { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { BaseType } from "../../enums/Base.js";
import { maxHp } from "../../game-rules/combat/index.js";
import { artLevelOf, towerTierArtOn } from "../../game-data/buildingArtLevels.js";
import { buildSaveData } from "./mapSaveData.js";
import { maskedHp } from "./viewMask.js";
import { previewHelp } from "../friends/helpRules.js";

/**
 * What a player who only looks at someone else's yard is sent (owner report
 * 2026-10-22, `viewMask.ts`): no traps, no building levels beyond what the art
 * shows, health that keeps its look but not its number, and no Shiny count.
 * The owner, and the attacker of a committed attack, get the yard as it is.
 */

const OWNER = 2503;
const VIEWER = 77;

const TWIG_SNAPPER = 1;
const CANNON = 20;
const SNIPER = 21;
const BOOBY_TRAP = 24;
const HEAVY_TRAP = 117;

const BUILDINGS = {
  "1": { id: 1, t: 14, x: 0, y: 0, l: 7 },
  "2": { id: 2, t: CANNON, x: 100, y: 40, l: 8, cU: 3_600, cL: 86_400 },
  "3": { id: 3, t: SNIPER, x: 120, y: 40, l: 9, hp: 30_000 },
  "4": { id: 4, t: TWIG_SNAPPER, x: -60, y: 20, l: 8 },
  "5": { id: 5, t: BOOBY_TRAP, x: -85, y: 210 },
  "6": { id: 6, t: HEAVY_TRAP, x: -95, y: 230, l: 1 },
  "7": { id: 7, t: CANNON, x: 140, y: 40, l: 4, cB: 120 },
};

/** Sniper hurt to under half; a booby trap hit; trap 99 fired and gone. */
const HEALTH = { "3": 30_000, "2": 80_000, "5": 4, "99": 0 };

const userOf = (userid: number, save?: Save) => ({ userid, shiny_locked: false, save }) as unknown as User;

const yardOf = (type: BaseType) =>
  Object.assign(new Save(), {
    userid: OWNER,
    saveuserid: OWNER,
    type,
    credits: 5_000,
    resources: {},
    buildingdata: structuredClone(BUILDINGS),
    buildinghealthdata: structuredClone(HEALTH),
    buildingkeydata: { "5": "k" },
  });

const asViewer = (yard: Save, options = {}) => buildSaveData(yard, userOf(VIEWER, new Save()), null, options);

type Wire = Record<string, Record<string, unknown>>;

describe("someone else's yard, only looked at", () => {
  for (const type of [BaseType.MAIN, BaseType.OUTPOST, BaseType.INFERNO]) {
    test(`a ${type} yard comes with no trap at all`, () => {
      const sent = asViewer(yardOf(type));
      const buildings = Object.values(sent.buildingdata as Wire);

      expect(buildings.map((one) => one.t)).not.toContain(BOOBY_TRAP);
      expect(buildings.map((one) => one.t)).not.toContain(HEAVY_TRAP);
      expect(Object.keys(sent.buildingdata as Wire)).toEqual(["1", "2", "3", "4", "7"]);
      // Neither the trap that was hit nor the one that already fired.
      expect(Object.keys(sent.buildinghealthdata as unknown as Wire).sort()).toEqual(["2", "3"]);
      expect(sent.buildingkeydata).toEqual({});
    });
  }

  test("each building carries the level its picture needs, not its own", () => {
    const sent = asViewer(yardOf(BaseType.MAIN)).buildingdata as Wire;

    // Towers carry their tier (the new tower art, on by default): levels 4 and 7, so 8 and 9 show 7's.
    expect(sent["2"]!.l).toBe(7);
    expect(sent["3"]!.l).toBe(7);
    // A Twig Snapper's picture changes at 1, 3, 6 and 10; level 8 shows 6's.
    expect(sent["4"]!.l).toBe(6);
    // The Town Hall's picture is its level: nothing more is given away.
    expect(sent["1"]!.l).toBe(7);
    // A foundation still building keeps its countdown and says nothing more.
    expect(sent["7"]!.cB).toBe(120);
  });

  test("a running upgrade keeps its countdown but not its length, which names the level", () => {
    const sent = asViewer(yardOf(BaseType.MAIN)).buildingdata as Wire;

    expect(sent["2"]!.cU).toBe(3_600);
    expect(sent["2"]).not.toHaveProperty("cL");
  });

  test("health keeps its look against the art level's full health, not the real number", () => {
    const sent = asViewer(yardOf(BaseType.MAIN));
    const buildings = sent.buildingdata as Wire;
    const health = sent.buildinghealthdata as Record<string, number>;
    const shown = maxHp(SNIPER, 7);

    // 30,000 of a level 9 Sniper's 75,500: damaged, under half.
    expect(buildings["3"]!.hp).toBeLessThan(shown / 2);
    expect(buildings["3"]!.hp).toBeGreaterThan(0);
    expect(health["3"]).toBe(buildings["3"]!.hp as number);
    // 80,000 is over a level 8 Cannon's 58,000: full health of the art level.
    expect(health["2"]).toBe(maxHp(CANNON, 7));
  });

  test("TOWER_TIER_ART is on unless set to off", () => {
    expect(towerTierArtOn({})).toBe(true);
    expect(towerTierArtOn({ TOWER_TIER_ART: "" })).toBe(true);
    expect(towerTierArtOn({ TOWER_TIER_ART: "on" })).toBe(true);
    expect(towerTierArtOn({ TOWER_TIER_ART: "off" })).toBe(false);
    expect(towerTierArtOn({ TOWER_TIER_ART: " OFF " })).toBe(false);
  });

  test("with TOWER_TIER_ART=off, every tower reads 1, as in Flash", () => {
    const before = process.env.TOWER_TIER_ART;
    process.env.TOWER_TIER_ART = "off";
    try {
      const sent = asViewer(yardOf(BaseType.MAIN));
      const buildings = sent.buildingdata as Wire;
      const health = sent.buildinghealthdata as Record<string, number>;
      expect(buildings["2"]!.l).toBe(1);
      expect(buildings["3"]!.l).toBe(1);
      // Everything else is as with it on.
      expect(buildings["4"]!.l).toBe(6);
      expect(buildings["1"]!.l).toBe(7);
      // Health is measured against level 1's full health instead.
      expect(buildings["3"]!.hp).toBeLessThan(maxHp(SNIPER, 1) / 2);
      expect(health["2"]).toBe(maxHp(CANNON, 1));
    } finally {
      if (before === undefined) delete process.env.TOWER_TIER_ART;
      else process.env.TOWER_TIER_ART = before;
    }
  });

  test("the owner's Shiny count is not sent", () => {
    expect(asViewer(yardOf(BaseType.MAIN)).credits).toBe(0);
  });

  test("the row itself is left as it was", () => {
    const yard = yardOf(BaseType.MAIN);
    asViewer(yard);

    expect(yard.buildingdata).toEqual(BUILDINGS);
    expect(yard.buildinghealthdata).toEqual(HEALTH);
  });
});

describe("who still gets the whole yard", () => {
  test("its owner", () => {
    const yard = yardOf(BaseType.MAIN);
    const sent = buildSaveData(yard, userOf(OWNER, yard), null);

    expect(sent.buildingdata).toEqual(BUILDINGS);
    expect(sent.buildinghealthdata).toEqual(HEALTH);
  });

  test("its attacker, once the attack is committed", () => {
    const sent = asViewer(yardOf(BaseType.MAIN), { attack: true });

    expect(sent.buildingdata).toEqual(BUILDINGS);
    expect(sent.buildinghealthdata).toEqual(HEALTH);
  });

  test("anyone, on a wild monster camp", () => {
    const camp = Object.assign(yardOf(BaseType.TRIBE), { userid: 0, saveuserid: 0 });

    expect(asViewer(camp).buildingdata).toEqual(BUILDINGS);
  });
});

describe("maskedHp", () => {
  test("keeps a building's look on both sides of the half-health line", () => {
    for (const [level, tiers] of [2, 5, 9, 10].flatMap((level) => [[level, false], [level, true]] as const)) {
      const real = maxHp(CANNON, level);
      const art = artLevelOf(CANNON, level, tiers);
      const shown = maxHp(CANNON, art);
      for (const share of [0.01, 0.25, 0.4999, 0.5, 0.75, 0.999]) {
        const hp = Math.floor(real * share) || 1;
        const masked = maskedHp(hp, CANNON, level, art, "main");
        expect(masked < shown / 2).toBe(hp < real / 2);
        expect(masked).toBeGreaterThan(0);
        expect(masked).toBeLessThan(shown);
      }
    }
  });

  test("destroyed stays destroyed and full stays full", () => {
    expect(maskedHp(0, CANNON, 9, 1, "main")).toBe(0);
    expect(maskedHp(maxHp(CANNON, 9), CANNON, 9, 1, "main")).toBe(maxHp(CANNON, 1));
  });

  test("an outpost reads its own health table", () => {
    const real = maxHp(CANNON, 5, "outpost");
    expect(maskedHp(real, CANNON, 5, 1, "outpost")).toBe(maxHp(CANNON, 1, "outpost"));
  });
});

describe("a friend's help offers", () => {
  test("never name a trap, even one being built", () => {
    const now = 1_700_000_000;
    const save = {
      type: BaseType.MAIN,
      savetime: now,
      buildingdata: {
        "5": { id: 5, t: BOOBY_TRAP, x: 0, y: 0, X: -85, Y: 210, cB: 600, cL: 600 },
        "2": { id: 2, t: CANNON, x: 0, y: 0, X: 100, Y: 40, l: 3, cU: 600, cL: 600 },
      },
      buildinghealthdata: {},
    };

    const offers = previewHelp(save as never, VIEWER, now, null);

    expect(Object.keys(offers)).toEqual(["2"]);
  });
});
