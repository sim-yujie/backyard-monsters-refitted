import { describe, expect, test } from "bun:test";
import { MR1_TRIBES, TribeScale } from "../../../enums/Tribes.js";
import { LOOT_GAIN_RATIO } from "../../../game-rules/combat/index.js";
import { legionnaire } from "../../../game-data/tribes/v1/legionnaire.js";
import {
  MR1_TRIBE_RESPAWN_SECONDS,
  creditableMR1Loot,
  currentMR1Tribes,
  mr1TribePool,
  mr1TribeRespawnAt,
  mr1TribeRespawned,
  mr1TribeScale,
  respawnMR1Tribe,
} from "./mr1TribeRules.js";
import type { TribeData } from "../../../types/TribeData.js";

describe("mr1TribeScale", () => {
  test("Town Hall 1-2 face the new tier, 3, 4 and 5 their own, 6 and up the high one", () => {
    expect(mr1TribeScale(1, MR1_TRIBES)).toBe(TribeScale.NEW);
    expect(mr1TribeScale(2, MR1_TRIBES)).toBe(TribeScale.NEW);
    expect(mr1TribeScale(3, MR1_TRIBES)).toBe(TribeScale.TH3);
    expect(mr1TribeScale(4, MR1_TRIBES)).toBe(TribeScale.TH4);
    expect(mr1TribeScale(5, MR1_TRIBES)).toBe(TribeScale.TH5);
    expect(mr1TribeScale(9, MR1_TRIBES)).toBe(TribeScale.HIGH);
  });
});

describe("currentMR1Tribes", () => {
  test("four tribes in Flash's order, all at the Town Hall's tier", () => {
    const tribes = currentMR1Tribes(4, MR1_TRIBES);
    expect(tribes.map((tribe) => tribe.name)).toEqual(["Legionnaire", "Kozu", "Abunakki", "Dreadnaut"]);
    expect(tribes.every((tribe) => tribe.scale === TribeScale.TH4)).toBe(true);
    expect(tribes[0]!.template).toBe(legionnaire[TribeScale.TH4]);
  });

  test("no tutorial camp: a Town Hall 1 account gets the Legionnaire's real tribe, whatever its tutorial stage (#132)", () => {
    const tribes = currentMR1Tribes(1, MR1_TRIBES);
    expect(tribes[0]!.template).toBe(legionnaire[TribeScale.NEW]);
    expect(tribes.map((tribe) => tribe.template.baseid)).not.toContain("1");
    expect(tribes[0]!.template.monsters).not.toEqual({ C2: 3 });
  });
});

describe("respawn", () => {
  test("a standing tribe has no respawn time", () => {
    expect(mr1TribeRespawnAt({ destroyed: 0 })).toBe(0);
    expect(mr1TribeRespawnAt(undefined)).toBe(0);
  });

  test("a wrecked tribe is back ten minutes after it fell, not a second earlier", () => {
    const tribe = { destroyed: 1, destroyedAt: 1000 };
    expect(mr1TribeRespawnAt(tribe)).toBe(1000 + MR1_TRIBE_RESPAWN_SECONDS);
    expect(mr1TribeRespawned(tribe, 1000 + MR1_TRIBE_RESPAWN_SECONDS - 1)).toBe(false);
    expect(mr1TribeRespawned(tribe, 1000 + MR1_TRIBE_RESPAWN_SECONDS)).toBe(true);
  });

  test("a tribe wrecked with no time kept is back already", () => {
    expect(mr1TribeRespawned({ destroyed: 1 }, 1_700_000_000)).toBe(true);
  });

  test("respawning clears the damage, the monsters and what was looted", () => {
    const tribe: TribeData = {
      baseid: "2",
      tribeHealthData: { 1: 10 },
      monsters: { C1: 1 },
      destroyed: 1,
      destroyedAt: 10,
      damage: 95,
      looted: { r1: 5 },
    };
    respawnMR1Tribe(tribe);
    expect(tribe).toEqual({
      baseid: "2",
      tribeHealthData: {},
      monsters: undefined,
      destroyed: 0,
      destroyedAt: undefined,
      damage: undefined,
      looted: undefined,
    });
  });
});

describe("mr1TribePool", () => {
  test("the pool plus every harvester's buffer, by resource", () => {
    const pool = mr1TribePool({
      resources: { r1: 100, r2: 200, r3: 0, r4: 50, r1max: 9999 },
      buildingdata: {
        1: { t: 1, st: 720 },
        2: { t: 2, st: 30 },
        3: { t: 6 },
        4: { t: 14, st: 99999 },
      },
    });
    expect(pool).toEqual({ r1: 820, r2: 230, r3: 0, r4: 50 });
  });
});

describe("creditableMR1Loot", () => {
  const pool = { r1: 1000, r2: 1000, r3: 0, r4: 10 };

  test("an honest gain inside the pool is credited as sent", () => {
    expect(creditableMR1Loot({ r1: 400, r2: 12 }, pool, undefined)).toEqual({ r1: 400, r2: 12, r3: 0, r4: 0 });
  });

  test("a gain over the pool is cut to the pool times the low-level bonus", () => {
    const credit = creditableMR1Loot({ r1: 1e12, r3: 5, r4: 1e9 }, pool, undefined);
    expect(credit).toEqual({ r1: Math.floor(1000 * LOOT_GAIN_RATIO), r2: 0, r3: 0, r4: Math.floor(10 * LOOT_GAIN_RATIO) });
  });

  test("what the tribe already gave this life counts against it", () => {
    expect(creditableMR1Loot({ r1: 1000 }, pool, { r1: 1500 }).r1).toBe(100);
    expect(creditableMR1Loot({ r1: 1000 }, pool, { r1: 5000 }).r1).toBe(0);
  });

  test("negative, fractional and junk amounts credit nothing below zero", () => {
    expect(creditableMR1Loot({ r1: -500, r2: 10.9, r3: "x" }, pool, undefined)).toEqual({ r1: 0, r2: 10, r3: 0, r4: 0 });
    expect(creditableMR1Loot(undefined, pool, undefined)).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
  });
});
