import { describe, expect, it } from "vitest";
import type { FlingLog } from "@/game/combat/rules";
import { rowOf } from "@/game/yard/buildingCosts";
import { keptLoot, krallenBuffOf, storageCapOf } from "./attackerStorage";

/**
 * The attacker's storage bounds the loot they keep (issue #166), as the
 * server banks it (`server/src/services/base/combat/attackLoot.ts`).
 */

const siloAt = (level: number): number => rowOf(6)?.[6]?.capacity?.[level - 1] ?? 0;

const log = (...extra: FlingLog["events"]): FlingLog => ({
  v: 1,
  seed: 1,
  events: [{ kind: "fling", t: 10, x: 0, y: 0, r: 100, monsters: { C1: 1 } }, ...extra],
});
const krallen = (l: number): FlingLog["events"][number] => ({
  kind: "fling",
  t: 20,
  x: 0,
  y: 0,
  r: 100,
  monsters: {},
  champion: { t: 5, l },
});

describe("storageCapOf", () => {
  it("is 10,000 plus finished silos, times packing, plus 2,000,000 per outpost", () => {
    expect(siloAt(3)).toBeGreaterThan(0);
    expect(storageCapOf({ buildingdata: {} })).toBe(10_000);
    const buildingdata = {
      "1": { id: 1, t: 6, X: 0, Y: 0, l: 3 },
      "2": { id: 2, t: 6, X: 0, Y: 0, l: 3, cB: 5 },
      "3": { id: 3, t: 14, X: 0, Y: 0, l: 9 },
    } as never;
    expect(storageCapOf({ buildingdata })).toBe(10_000 + siloAt(3));
    expect(storageCapOf({ buildingdata, storedata: { BIP: { q: 2 } } as never })).toBe(
      Math.floor((10_000 + siloAt(3)) * 1.2),
    );
    expect(storageCapOf({ buildingdata, outposts: [[1, 2, "3"], [4, 5, "6"]] })).toBe(
      10_000 + siloAt(3) + 4_000_000,
    );
  });
});

describe("krallenBuffOf", () => {
  it("is Krallen's buffs at the level flung, no higher than the one owned", () => {
    expect(krallenBuffOf(log(krallen(5)), [{ t: 5, l: 5 }])).toBeCloseTo(0.3);
    expect(krallenBuffOf(log(krallen(5)), [{ t: 5, l: 1 }])).toBeCloseTo(0.2);
    expect(krallenBuffOf(log(), [{ t: 5, l: 5 }])).toBe(0);
    expect(krallenBuffOf(log(krallen(5)), [])).toBe(0);
  });
});

describe("keptLoot", () => {
  const taken = { r1: 5_000, r2: 5_000, r3: 5_000, r4: 5_000 };

  it("keeps the room under the cap; a pool at or over it keeps nothing", () => {
    const held = { r1: 0, r2: 9_000, r3: 10_000, r4: 50_000 };
    expect(keptLoot(taken, held, 10_000, log(), [])).toEqual({ r1: 5_000, r2: 1_000, r3: 0, r4: 0 });
  });

  it("counts a bomb's cost out of the pool first, and Krallen's raise into the cap", () => {
    const held = { r1: 10_000, r2: 10_000, r3: 0, r4: 0 };
    const bombed = log({ kind: "bomb", t: 5, x: 0, y: 0, id: "tw0" });
    expect(keptLoot(taken, held, 10_000, bombed, []).r1).toBe(5_000);
    expect(keptLoot(taken, held, 10_000, log(krallen(1)), [{ t: 5, l: 1 }]).r2).toBe(2_000);
  });

  it("keeps everything when the pool or the cap is unknown", () => {
    expect(keptLoot(taken, null, 10_000, log(), [])).toEqual(taken);
    expect(keptLoot(taken, { r1: 10_000 }, null, log(), [])).toEqual(taken);
  });
});
