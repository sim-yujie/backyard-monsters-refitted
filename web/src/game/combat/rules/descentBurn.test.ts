import { describe, expect, it } from "vitest";

import {
  DESCENT_BURN_INTERVAL,
  DESCENT_BURN_SHARE,
  DESCENT_YARDS,
  burnsInDescent,
  descentBurnShare,
} from "./descentBurn.js";
import { createBattle } from "./engine.js";
import { buildEngineYard } from "./yard.js";
import type { AttackEvent } from "./engine.js";

/**
 * The Descent burn (Inferno WP 1.21, `docs/design/inferno.md` §2.4, I15/R8):
 * from Descent yard 7 every surface monster loses a share of its full health
 * every 10 s; the Inferno's monsters and Korath never burn.
 */

/** A yard with nothing that shoots back and too much health to fall in the test. */
const quietYard = () =>
  buildEngineYard({
    buildingdata: {
      "1": { id: 1, t: 14, l: 10, X: 300, Y: 300 },
      "2": { id: 2, t: 1, l: 10, X: -300, Y: -300 },
    },
    buildinghealthdata: {},
    resources: { r1: 100000, r2: 0, r3: 0, r4: 0 },
  });

type Fling = Omit<Extract<AttackEvent, { kind: "fling" }>, "kind" | "t" | "x" | "y" | "r">;

/** Each creep's hurts over `ticks`, by monster id: the tick and the amount. */
const burns = (
  descentYard: number | undefined,
  fling: Fling,
  ticks = 3 * DESCENT_BURN_INTERVAL + 5,
) => {
  const battle = createBattle(quietYard(), {
    seed: 11,
    ...(descentYard ? { descentYard } : {}),
  });
  battle.apply({ kind: "fling", t: 0, x: 0, y: 0, r: 0, ...fling });
  const hurts = new Map<string, { tick: number; amount: number }[]>();
  const burning = new Map<string, boolean>();
  for (let step = 0; step < ticks && !battle.over(); step += 1) {
    battle.step();
    const byId = new Map(battle.creeps().map((creep) => [creep.id, creep]));
    for (const creep of byId.values()) {
      burning.set(
        creep.monsterId,
        (burning.get(creep.monsterId) ?? false) || creep.burning === true,
      );
    }
    for (const event of battle.recentEvents(battle.tick - 1)) {
      if (event.kind !== "hurt" || event.tick !== battle.tick) continue;
      const creep = byId.get(event.creepId);
      if (!creep) continue;
      const list = hurts.get(creep.monsterId) ?? [];
      list.push({ tick: event.tick, amount: event.amount });
      hurts.set(creep.monsterId, list);
    }
  }
  return { battle, hurts, burning };
};

describe("the Descent burn's strength", () => {
  it("is nothing outside the Descent and on yards 1 to 6", () => {
    expect(descentBurnShare(undefined)).toBe(0);
    expect(descentBurnShare(null)).toBe(0);
    for (let yard = 1; yard <= 6; yard += 1) expect(descentBurnShare(yard)).toBe(0);
  });

  it("rises evenly from 2% at yard 7 to 5% at yard 13", () => {
    expect(descentBurnShare(7)).toBe(0.02);
    expect(descentBurnShare(DESCENT_YARDS)).toBe(0.05);
    for (let yard = 8; yard <= DESCENT_YARDS; yard += 1) {
      expect(descentBurnShare(yard) - descentBurnShare(yard - 1)).toBeCloseTo(0.005, 10);
    }
    expect(Object.keys(DESCENT_BURN_SHARE).map(Number)).toEqual([7, 8, 9, 10, 11, 12, 13]);
  });

  it("burns every 10 s", () => {
    expect(DESCENT_BURN_INTERVAL).toBe(800);
  });
});

describe("who burns", () => {
  it("is every surface monster and champion but Korath", () => {
    for (const id of ["C1", "C5", "C12", "C15", "G1", "G2", "G3", "G5"]) {
      expect(burnsInDescent(id)).toBe(true);
    }
  });

  it("is never an Inferno monster or Korath", () => {
    for (let n = 1; n <= 8; n += 1) expect(burnsInDescent(`IC${n}`)).toBe(false);
    expect(burnsInDescent("G4")).toBe(false);
  });
});

describe("the burn in a fight", () => {
  it("takes a share of full health every 10 s, from the first 10 s on the field", () => {
    const { battle, hurts, burning } = burns(7, { monsters: { C2: 1 } });
    const list = hurts.get("C2") ?? [];
    const creep = battle.creeps().find((one) => one.monsterId === "C2");
    expect(creep).toBeDefined();
    const each = (creep?.maxHp ?? 0) * 0.02;
    expect(list.map((hurt) => hurt.amount)).toEqual([each, each, each]);
    expect(list[1]!.tick - list[0]!.tick).toBe(DESCENT_BURN_INTERVAL);
    expect(list[2]!.tick - list[1]!.tick).toBe(DESCENT_BURN_INTERVAL);
    expect(creep?.hp).toBeCloseTo((creep?.maxHp ?? 0) * (1 - 3 * 0.02), 6);
    expect(burning.get("C2")).toBe(true);
  });

  it("burns harder deeper down", () => {
    const at7 = burns(7, { monsters: { C2: 1 } }).hurts.get("C2")![0]!.amount;
    const at13 = burns(13, { monsters: { C2: 1 } }).hurts.get("C2")![0]!.amount;
    expect(at13 / at7).toBeCloseTo(2.5, 10);
  });

  it("does nothing on yard 6 or outside the Descent", () => {
    for (const yard of [undefined, 1, 6]) {
      const { hurts, burning } = burns(yard, { monsters: { C2: 1 } });
      expect(hurts.get("C2")).toBeUndefined();
      expect(burning.get("C2")).toBe(false);
    }
  });

  it("leaves the Inferno's monsters alone", () => {
    const { hurts, burning } = burns(13, { monsters: { IC1: 1, IC3: 1, C2: 1 } });
    expect(hurts.get("IC1")).toBeUndefined();
    expect(hurts.get("IC3")).toBeUndefined();
    expect(burning.get("IC1")).toBe(false);
    expect(burning.get("IC3")).toBe(false);
    expect(hurts.get("C2")?.length).toBe(3);
  });

  it("leaves Korath alone but burns another champion", () => {
    const korath = burns(13, { monsters: {}, champion: { t: 4, l: 1 } });
    expect(korath.hurts.get("G4")).toBeUndefined();
    expect(korath.burning.get("G4")).toBe(false);
    const gorgo = burns(13, { monsters: {}, champion: { t: 1, l: 1 } });
    expect(gorgo.hurts.get("G1")?.length).toBe(3);
    expect(gorgo.burning.get("G1")).toBe(true);
  });
});
