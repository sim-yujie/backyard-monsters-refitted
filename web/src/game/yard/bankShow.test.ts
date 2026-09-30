import { describe, expect, it } from "vitest";
import { startBank, type BankShowFx, type BankShowHud } from "./bankShow";
import type { BankedByBuilding, HarvestKey } from "./harvest";

/**
 * A bank on the press (#208): balls leave and the bar starts counting before
 * the server answers, the count runs across the flight, the answer corrects
 * the totals, a refusal counts it back.
 *
 * The HUD stand-in keeps the two numbers the real one does: the pool (moved
 * only by the store's answer) and how far the readout's target is behind it
 * (`held`), so `target` is what the readout is counting to; `counts` are the
 * counts it was asked for, with their lengths.
 */

class FakeHud implements BankShowHud {
  pool: Record<HarvestKey, number> = { r1: 1_000, r2: 1_000, r3: 1_000, r4: 1_000 };
  held: Record<HarvestKey, number> = { r1: 0, r2: 0, r3: 0, r4: 0 };
  expecting: Record<HarvestKey, number> = { r1: 0, r2: 0, r3: 0, r4: 0 };
  floats: [HarvestKey, number][] = [];
  counts: [HarvestKey, number, number | undefined][] = [];
  expectBank(key: HarvestKey, change: 1 | -1): void {
    this.expecting[key] += change;
  }
  hold(key: HarvestKey, amount: number): void {
    this.held[key] += amount;
  }
  deliver(key: HarvestKey, amount: number, ms?: number): void {
    this.held[key] -= amount;
    this.counts.push([key, amount, ms]);
  }
  showChange(key: HarvestKey, delta: number): void {
    this.floats.push([key, delta]);
  }
  target(key: HarvestKey): number {
    return this.pool[key] - this.held[key];
  }
}

/** Throws one ball per harvester, landed by hand; twigs land by 1.2 s, goo by 0.9 s. */
class FakeFx implements BankShowFx {
  balls: (() => void)[] = [];
  cancelled: number[] = [];
  townHall = true;
  throwBank(banked: BankedByBuilding, onLand: (resource: HarvestKey, share: number) => void) {
    if (!this.townHall) return { totals: {}, ends: {}, balls: 0, group: 0 };
    const totals: Partial<Record<HarvestKey, number>> = {};
    for (const { resource, amount } of Object.values(banked)) {
      totals[resource] = (totals[resource] ?? 0) + amount;
      this.balls.push(() => onLand(resource, amount));
    }
    return { totals, ends: { r1: 1.2, r4: 0.9 }, balls: this.balls.length, group: 7 };
  }
  cancelBank(group: number): void {
    this.cancelled.push(group);
    this.balls = [];
  }
  landAll(): void {
    for (const land of this.balls.splice(0)) land();
  }
}

const predicted: BankedByBuilding = {
  "1": { resource: "r1", amount: 300 },
  "2": { resource: "r1", amount: 200 },
  "3": { resource: "r4", amount: 100 },
};

/** What the store does with an answer before the bank hears it: the pool rises. */
const credit = (hud: FakeHud, banked: Partial<Record<HarvestKey, number>>) => {
  for (const [key, amount] of Object.entries(banked) as [HarvestKey, number][]) hud.pool[key] += amount;
};

describe("startBank", () => {
  it("starts every readout counting on the press, across its resource's whole flight", () => {
    const hud = new FakeHud();
    const fx = new FakeFx();
    startBank(predicted, fx, hud);
    expect(fx.balls).toHaveLength(3);
    expect(hud.counts).toEqual([
      ["r1", 500, 1200],
      ["r4", 100, 900],
    ]);
    expect(hud.floats).toEqual([
      ["r1", 500],
      ["r4", 100],
    ]);
    expect(hud.target("r1")).toBe(1_500);
    expect(hud.expecting).toMatchObject({ r1: 1, r4: 1 });
  });

  it("holds the answer's credit so the count neither jumps nor stops, and ends on the pool", () => {
    const hud = new FakeHud();
    const fx = new FakeFx();
    const answer = startBank(predicted, fx, hud)!;
    credit(hud, { r1: 500, r4: 100 });
    answer({ banked: { r1: 500, r4: 100 } });
    expect(hud.target("r1")).toBe(1_500);
    expect(hud.expecting).toMatchObject({ r1: 0, r4: 0 });
    fx.landAll();
    // Predicted right: no correction.
    expect(hud.counts).toHaveLength(2);
    expect(hud.held).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
  });

  it("counts in or out what the prediction got wrong once the last ball is down", () => {
    const hud = new FakeHud();
    const fx = new FakeFx();
    const answer = startBank(predicted, fx, hud)!;
    // A silo filled: the server credits less twigs, and some pebbles nobody threw.
    credit(hud, { r1: 350, r2: 40, r4: 100 });
    answer({ banked: { r1: 350, r2: 40, r4: 100 } });
    expect(hud.counts).toHaveLength(2);
    fx.landAll();
    expect(hud.counts.slice(2)).toEqual([
      ["r1", -150, undefined],
      ["r2", 40, undefined],
    ]);
    expect(hud.held).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
    expect(hud.target("r1")).toBe(1_350);
    expect(hud.target("r2")).toBe(1_040);
  });

  it("settles when the answer comes after every ball has landed", () => {
    const hud = new FakeHud();
    const fx = new FakeFx();
    const answer = startBank(predicted, fx, hud)!;
    fx.landAll();
    credit(hud, { r1: 450, r4: 100 });
    answer({ banked: { r1: 450, r4: 100 } });
    expect(hud.counts.slice(2)).toEqual([["r1", -50, undefined]]);
    expect(hud.held).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
  });

  it("on a refusal takes the balls away and counts the readouts back to the pool", () => {
    const hud = new FakeHud();
    const fx = new FakeFx();
    const answer = startBank(predicted, fx, hud)!;
    answer(null);
    expect(fx.cancelled).toEqual([7]);
    expect(fx.balls).toHaveLength(0);
    expect(hud.counts.slice(2)).toEqual([
      ["r1", -500, undefined],
      ["r4", -100, undefined],
    ]);
    expect(hud.target("r1")).toBe(1_000);
    expect(hud.target("r4")).toBe(1_000);
    expect(hud.held).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
    expect(hud.expecting).toMatchObject({ r1: 0, r4: 0 });

    // A second answer changes nothing.
    answer({ banked: { r1: 500 } });
    expect(hud.held).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
    expect(hud.counts).toHaveLength(4);
  });

  it("counts back cleanly even when the refusal comes after the balls have landed", () => {
    const hud = new FakeHud();
    const fx = new FakeFx();
    const answer = startBank(predicted, fx, hud)!;
    fx.landAll();
    answer(null);
    expect(hud.target("r1")).toBe(1_000);
    expect(hud.held).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
  });

  it("throws nothing, and leaves the answer to the HUD, with no Town Hall or nothing predicted", () => {
    const hud = new FakeHud();
    const fx = new FakeFx();
    fx.townHall = false;
    expect(startBank(predicted, fx, hud)).toBeNull();
    expect(startBank({}, new FakeFx(), hud)).toBeNull();
    expect(hud.expecting).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
    expect(hud.counts).toEqual([]);
  });
});
