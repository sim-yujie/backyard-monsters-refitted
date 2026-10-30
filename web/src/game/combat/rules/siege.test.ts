import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  DECOY,
  JARS,
  SIEGE_GROUND_SPECIAL_RADIUS,
  SIEGE_MAX_LEVEL,
  SIEGE_WEAPON_DATA,
  VACUUM,
  VACUUM_OUTPOST_LOOT_SHARE,
  chargedCost,
  decoyDamage,
  fightableSiege,
  siegeBuildCost,
  siegeData,
  siegeLevel,
  siegeLevelsOf,
  siegeUpgradeCost,
  siegeValue,
  type SiegeStat,
  type SiegeWeaponData,
} from "./siege";

/**
 * The siege weapons' numbers (Inferno WP 6.2) against Flash's own files: every
 * figure, every cost, at every level, read straight out of
 * `client/scripts/com/monsters/siege/`. A hand edit that slips a digit fails
 * here, not in a fight.
 */

const SIEGE = "../../../../../client/scripts/com/monsters/siege/";
const read = (path: string): string => readFileSync(new URL(SIEGE + path, import.meta.url), "utf8");

interface FlashProperty {
  readonly values: unknown[];
  readonly order: number;
}

/** Every `addProperty(KEY, new SiegeWeaponProperty([...], order))` in a weapon's file. */
const flashProperties = (file: string): Record<string, FlashProperty> => {
  const source = read(`weapons/${file}.as`);
  const found: Record<string, FlashProperty> = {};
  const pattern = /addProperty\((\w+),\s*new SiegeWeaponProperty\((\[[\s\S]*?\])(?:,\s*(\d+))?\)\);/g;
  for (const hit of source.matchAll(pattern)) {
    found[hit[1]!] = { values: JSON.parse(hit[2]!) as unknown[], order: Number(hit[3] ?? 0) };
  }
  return found;
};

/** Flash's property key for each of ours. */
const FLASH_KEY: Record<SiegeStat, string> = {
  damage: "DAMAGE",
  range: "RANGE",
  duration: "DURATION",
  durability: "DURABILITY",
  lootBonus: "LOOT_BONUS",
};

const FILES: readonly [string, SiegeWeaponData][] = [
  ["Decoy", DECOY],
  ["Vacuum", VACUUM],
  ["Jars", JARS],
];

describe.each(FILES)("%s against Flash", (file, weapon) => {
  const flash = flashProperties(file);

  it("has Flash's id and drop zone", () => {
    const source = read(`weapons/${file}.as`);
    expect(source).toContain(`public static const ID:String = "${weapon.id}";`);
    const drop = { ground: "SIEGEWEAPON_GROUND", "ground-special": "SIEGEWEAPON_GROUND_SPECIAL", buildings: "SIEGEWEAPON_BUILDINGS" };
    expect(source).toContain(`dropTarget = DROPZONE.${drop[weapon.drop]};`);
  });

  it("holds every figure Flash gives it, and none it does not", () => {
    for (const stat of Object.keys(FLASH_KEY) as SiegeStat[]) {
      expect(weapon[stat], stat).toEqual(flash[FLASH_KEY[stat]]?.values ?? []);
    }
  });

  it("lists the Lab's figures in Flash's order", () => {
    const ordered = (Object.keys(FLASH_KEY) as SiegeStat[])
      .filter((stat) => (flash[FLASH_KEY[stat]]?.order ?? 0) > 0)
      .sort((a, b) => flash[FLASH_KEY[a]]!.order - flash[FLASH_KEY[b]]!.order);
    expect(weapon.stats).toEqual(ordered);
  });

  it("costs what Flash charged to research and to make, at every level", () => {
    expect(weapon.upgradeCosts).toEqual(flash["UPGRADE_COSTS"]!.values);
    expect(weapon.buildCosts).toEqual(flash["BUILD_COSTS"]!.values);
    expect(weapon.upgradeCosts).toHaveLength(SIEGE_MAX_LEVEL);
    expect(weapon.buildCosts).toHaveLength(SIEGE_MAX_LEVEL);
  });

  it("goes by its english.json name", () => {
    const english = readFileSync(
      new URL("../../../../../server/public/gamestage/assets/english.json", import.meta.url),
      "utf8",
    );
    expect((JSON.parse(english) as Record<string, string>)[`#w_${weapon.id}#`]).toBe(weapon.name);
  });
});

describe("the siege weapons as a set", () => {
  it("are Flash's three, in its order, with ten levels", () => {
    const list = read("SiegeWeapons.as");
    const order = [...list.matchAll(/_weaponsList\[(\w+)\.ID\]/g)].map((hit) => hit[1]!.toLowerCase());
    expect(SIEGE_WEAPON_DATA.map((weapon) => weapon.id)).toEqual(order);
    expect(read("weapons/SiegeWeapon.as")).toContain(`MAX_LEVEL:int = ${SIEGE_MAX_LEVEL};`);
    expect(siegeData("vacuum")).toBe(VACUUM);
    expect(siegeData("catapult")).toBeUndefined();
  });

  it("keeps the Decoy's clearance and the Vacuum's outpost share", () => {
    expect(readFileSync(new URL("../../../../../client/scripts/DROPZONE.as", import.meta.url), "utf8")).toContain(
      `SIEGEWEAPON_GROUND_SPECIAL_RADIUS:int = ${SIEGE_GROUND_SPECIAL_RADIUS};`,
    );
    expect(read("weapons/VacuumHose.as")).toContain(`MR3_MAX_LOOT_MULTIPLIER:Number = ${VACUUM_OUTPOST_LOOT_SHARE};`);
  });
});

describe("reading a level", () => {
  it("holds a level to a whole 0..10", () => {
    expect(siegeLevel(3.7)).toBe(3);
    expect(siegeLevel(-2)).toBe(0);
    expect(siegeLevel(14)).toBe(10);
    expect(siegeLevel(Number.NaN)).toBe(0);
  });

  it("reads entry level - 1, nothing at level 0 and nothing the weapon lacks", () => {
    expect(siegeValue(DECOY.range, 1)).toBe(250);
    expect(siegeValue(DECOY.range, 10)).toBe(480);
    expect(siegeValue(DECOY.range, 99)).toBe(480);
    expect(siegeValue(DECOY.range, 0)).toBeNull();
    expect(siegeValue(VACUUM.range, 5)).toBeNull();
  });

  it("holds the Decoy's blast to 0..23,500", () => {
    expect(decoyDamage(1)).toBe(1_000);
    expect(decoyDamage(10)).toBe(23_500);
    expect(decoyDamage(0)).toBe(0);
  });
});

describe("costs", () => {
  it("researches the next level: level 0 opens level 1, nothing past 10", () => {
    expect(siegeUpgradeCost(DECOY, 0)).toBe(DECOY.upgradeCosts[0]);
    expect(siegeUpgradeCost(JARS, 9)).toBe(JARS.upgradeCosts[9]);
    expect(siegeUpgradeCost(JARS, 10)).toBeNull();
  });

  it("makes a weapon at its own level, nothing at level 0", () => {
    expect(siegeBuildCost(VACUUM, 1)).toBe(VACUUM.buildCosts[0]);
    expect(siegeBuildCost(VACUUM, 10)).toBe(VACUUM.buildCosts[9]);
    expect(siegeBuildCost(VACUUM, 0)).toBeNull();
  });

  it("charges each resource floored, as BASE.Charge did", () => {
    expect(chargedCost(DECOY.upgradeCosts[0]!)).toEqual({ r1: 37_599, r2: 43_866, r3: 43_866, r4: 0, time: 14_400 });
  });
});

describe("an attacker's stock in a fight (WP 6.8)", () => {
  it("fights each weapon at its level only while one is held", () => {
    expect(
      siegeLevelsOf({
        decoy: { level: 3, quantity: 1 },
        vacuum: { level: 7, quantity: 0 },
        jars: { level: 0, quantity: 1 },
      }),
    ).toEqual({ decoy: 3 });
    expect(siegeLevelsOf({ jars: { level: 14, quantity: 2.6 } })).toEqual({ jars: 10 });
    expect(siegeLevelsOf(null)).toEqual({});
    expect(siegeLevelsOf("junk")).toEqual({});
    expect(siegeLevelsOf({ decoy: { level: "4", quantity: "1" } })).toEqual({ decoy: 4 });
  });

  it("leaves out every use past the stock, and nothing else", () => {
    const fling = { kind: "fling", t: 0 };
    const decoy = { kind: "siege", t: 10, weapon: "decoy" };
    const jars = { kind: "siege", t: 20, weapon: "jars" };
    const later = { kind: "siege", t: 900, weapon: "decoy" };
    const stock = { decoy: { level: 2, quantity: 1 } };
    expect(fightableSiege([fling, decoy, jars, later], stock)).toEqual([fling, decoy]);
    expect(fightableSiege([fling, decoy], null)).toEqual([fling]);
    expect(fightableSiege([decoy, later], { decoy: { level: 2, quantity: 2 } })).toEqual([decoy, later]);
  });
});
