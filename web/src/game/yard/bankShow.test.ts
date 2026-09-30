import { describe, expect, it } from "vitest";
import { startBank, type BankShowFx, type BankShowHud } from "./bankShow";
import type { BankedByBuilding, HarvestKey } from "./harvest";

/**
 * A bank on the press (#208): balls leave before the server answers, the bar
 * counts as they land, the answer corrects the totals, a refusal puts it back.
 *
 * The HUD stand-in keeps the two numbers the real one does: the pool (moved
 * only by the store's answer) and how far the readout is behind it (`held`),
 * so `shown` is what the readout ends up saying.
 */

class FakeHud implements BankShowHud {
  pool: Record<HarvestKey, number> = { r1: 1_000, r2: 1_000, r3: 1_000, r4: 1_000 };
  held: Record<HarvestKey, number> = { r1: 0, r2: 0, r3: 0, r4: 0 };
  expecting: Record<HarvestKey, number> = { r1: 0, r2: 0, r3: 0, r4: 0 };
  floats: [HarvestKey, number][] = [];
  expectBank(key: HarvestKey, change: 1 | -1): void {
    this.expecting[key] += change;
  }
  hold(key: HarvestKey, amount: number): void {
    this.held[key] += amount;
  }
  deliver(key: HarvestKey, amount: number): void {
    this.held[key] -= amount;
  }
  showChange(key: HarvestKey, delta: number): void {
    this.floats.push([key, delta]);
  }
  shown(key: HarvestKey): number {
    return this.pool[key] - this.held[key];
  }
}

/** Throws one ball per harvester, landed by hand. */
class FakeFx implements BankShowFx {
  balls: { resource: HarvestKey; share: number; land: () => void }[] = [];
  cancelled: number[] = [];
  townHall = true;
  throwBank(banked: BankedByBuilding, onLand: (resource: HarvestKey, share: number) => void) {
    if (!this.townHall) return { totals: {}, balls: 0, group: 0 };
    const totals: Partial<Record<HarvestKey, number>> = {};
    for (const { resource, amount } of Object.values(banked)) {
      totals[resource] = (totals[resource] ?? 0) + amount;
      this.balls.push({ resource, share: amount, land: () => onLand(resource, amount) });
    }
    return { totals, balls: this.balls.length, group: 7 };
  }
  cancelBank(group: number): void {
    this.cancelled.push(group);
    this.balls = [];
  }
  landNext(): void {
    this.balls.shift()?.land();
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
  it("throws on the press and counts landings before the server has answered", () => {
    const hud = new FakeHud();
    const fx = new FakeFx();
    const answer = startBank(predicted, fx, hud)!;
    expect(fx.balls).toHaveLength(3);
    expect(hud.expecting).toMatchObject({ r1: 1, r4: 1 });

    fx.landNext();
    expect(hud.shown("r1")).toBe(1_300);
    expect(hud.floats).toEqual([["r1", 500]]);

    // The answer: the store raises the pool, the bank holds it back.
    credit(hud, { r1: 500, r4: 100 });
    answer({ banked: { r1: 500, r4: 100 } });
    expect(hud.shown("r1")).toBe(1_300);
    expect(hud.shown("r4")).toBe(1_000);
    expect(hud.expecting).toMatchObject({ r1: 0, r4: 0 });

    fx.landNext();
    fx.landNext();
    expect(hud.shown("r1")).toBe(1_500);
    expect(hud.shown("r4")).toBe(1_100);
    expect(hud.held).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
    expect(hud.floats).toEqual([
      ["r1", 500],
      ["r4", 100],
    ]);
  });

  it("counts in or out what the prediction got wrong once the last ball is down", () => {
    const hud = new FakeHud();
    const fx = new FakeFx();
    const answer = startBank(predicted, fx, hud)!;
    // A silo filled: the server credits less twigs, and some pebbles nobody threw.
    credit(hud, { r1: 350, r2: 40, r4: 100 });
    answer({ banked: { r1: 350, r2: 40, r4: 100 } });
    expect(hud.shown("r2")).toBe(1_000);
    fx.landNext();
    fx.landNext();
    fx.landNext();
    expect(hud.held).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
    expect(hud.shown("r1")).toBe(1_350);
    expect(hud.shown("r2")).toBe(1_040);
  });

  it("settles when the answer comes after every ball has landed", () => {
    const hud = new FakeHud();
    const fx = new FakeFx();
    const answer = startBank(predicted, fx, hud)!;
    fx.landNext();
    fx.landNext();
    fx.landNext();
    expect(hud.shown("r1")).toBe(1_500);
    credit(hud, { r1: 500, r4: 100 });
    answer({ banked: { r1: 500, r4: 100 } });
    expect(hud.shown("r1")).toBe(1_500);
    expect(hud.held).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
  });

  it("on a refusal lands nothing more and puts the numbers back", () => {
    const hud = new FakeHud();
    const fx = new FakeFx();
    const answer = startBank(predicted, fx, hud)!;
    fx.landNext();
    expect(hud.shown("r1")).toBe(1_300);

    answer(null);
    expect(fx.cancelled).toEqual([7]);
    expect(fx.balls).toHaveLength(0);
    expect(hud.shown("r1")).toBe(1_000);
    expect(hud.shown("r4")).toBe(1_000);
    expect(hud.held).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
    expect(hud.expecting).toMatchObject({ r1: 0, r4: 0 });

    // A second answer, and any late landing, change nothing.
    answer({ banked: { r1: 500 } });
    expect(hud.held).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
  });

  it("throws nothing, and leaves the answer to the HUD, with no Town Hall or nothing predicted", () => {
    const hud = new FakeHud();
    const fx = new FakeFx();
    fx.townHall = false;
    expect(startBank(predicted, fx, hud)).toBeNull();
    expect(startBank({}, new FakeFx(), hud)).toBeNull();
    expect(hud.expecting).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
  });
});
