import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MONSTER_PROPS } from "./combatStatsData";
import { capacity, maxHp, towerStats } from "./stats";

/**
 * The Inferno's combat numbers (`docs/design/inferno.md` §2.5-2.6, WP 1.2).
 *
 * An Inferno yard, a player's, a Moloch tribe's or a Descent yard (loaded as
 * one, `maproom_inferno/PlayerHandler.as:333`), reads `INFERNOYARDPROPS.as`
 * (`client/scripts/GLOBAL.as:718-719`). The Housing Bunker and the Inferno
 * Cannon are stubs in the main table, so both tables carry their Inferno numbers.
 */

const LOCKER = "../../../../../client/scripts/CREATURELOCKER.as";

/** Every numeric `props` ladder of one `CREATURELOCKER.as` entry. */
const lockerProps = (id: string): Record<string, number[]> => {
  const source = readFileSync(new URL(LOCKER, import.meta.url), "utf8");
  const start = source.indexOf(`"${id}": {`);
  const propsAt = source.indexOf('"props"', start);
  const body = source.slice(propsAt, source.indexOf("}", propsAt));
  const out: Record<string, number[]> = {};
  for (const hit of body.matchAll(/"(\w+)"\s*:\s*\[([^\]]*)\]/g)) {
    out[hit[1] as string] = (hit[2] as string).split(",").map(Number);
  }
  return out;
};

/** The ladders the fight reads; the rest are training and healing costs. */
const COMBAT_KEYS = ["speed", "health", "damage", "range", "targetGroup", "bucket", "cStorage"];

describe("the Inferno towers on the main table", () => {
  it("gives the Inferno Cannon 130 seven levels, 160 to 220 range", () => {
    expect(towerStats(130, 1)?.range).toBe(160);
    expect(towerStats(130, 7)?.range).toBe(220);
    expect(towerStats(130, 7)?.damage).toBe(140);
    expect(maxHp(130, 1)).toBeGreaterThan(0);
  });

  it("gives the Housing Bunker 128 a 500 to 650 range", () => {
    expect(towerStats(128, 1)?.range).toBe(500);
    expect(towerStats(128, 6)?.range).toBe(650);
  });

  it("keeps the Quake and Magma Towers' Flash stats (`YARD_PROPS.as:6886`, `:7157`)", () => {
    expect(towerStats(129, 1)).toEqual({ range: 160, damage: 1100, rate: 15 });
    expect(towerStats(129, 6)).toEqual({ range: 210, damage: 4400, rate: 15 });
    expect(towerStats(132, 1)).toMatchObject({ range: 180, damage: 180, rate: 20 });
    expect(towerStats(132, 6)).toMatchObject({ range: 230, damage: 480, rate: 20 });
  });
});

describe("an Inferno yard", () => {
  it("reads the Quake Tower's Inferno health ladder", () => {
    expect(maxHp(129, 6, "inferno")).toBe(48_000);
    expect(maxHp(129, 6)).toBe(34_000);
  });

  it("reads the Inferno tower stats where they differ", () => {
    // The Inferno Sniper Tower has seven levels; the main one has ten.
    expect(towerStats(21, 7, "inferno")?.damage).toBe(760);
    expect(towerStats(21, 10, "inferno")?.damage).toBe(760);
  });

  it("gives the Housing Bunker 780 room at level 4 (owner decision R11)", () => {
    expect(capacity(128, 4, "inferno")).toBe(780);
    expect(capacity(128, 6, "inferno")).toBe(1820);
  });

  it("falls back to the main table for a type the Inferno table does not change", () => {
    expect(towerStats(129, 3, "inferno")).toEqual(towerStats(129, 3));
    expect(towerStats(132, 3, "inferno")).toEqual(towerStats(132, 3));
  });
});

describe("the Inferno monsters IC1-IC8", () => {
  for (let index = 1; index <= 8; index++) {
    const id = `IC${index}`;
    it(`holds ${id}'s fight numbers as CREATURELOCKER.as spells them`, () => {
      const flash = lockerProps(id);
      const ours = MONSTER_PROPS[id]?.props as Record<string, readonly number[]> | undefined;
      expect(ours).toBeDefined();
      for (const key of COMBAT_KEYS) {
        expect([key, ours?.[key]]).toEqual([key, flash[key]]);
      }
    });
  }
});
