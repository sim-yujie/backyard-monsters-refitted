import { describe, expect, it } from "vitest";
import { HOLD_LIMIT_TICKS, ShotLedger, type HeldShot, type WoundLike } from "./shotLedger";

/**
 * Which wounds a tower's bullet holds back until it lands (issue #77), and
 * what its landing lets go of — pure, in the order the engine emits events.
 */

interface Death {
  readonly creepId: number;
}

const shotAt = (overrides: Partial<HeldShot> = {}): HeldShot => ({
  key: 1,
  tick: 10,
  creepId: 5,
  splash: 0,
  ix: 100,
  iy: 100,
  ...overrides,
});

const wound = (overrides: Partial<WoundLike> = {}): WoundLike => ({
  tick: 10,
  creepId: 5,
  ix: 100,
  iy: 100,
  amount: 40,
  ...overrides,
});

describe("ShotLedger", () => {
  it("holds a bullet's wound on its target until the bullet lands, then lets it go", () => {
    const ledger = new ShotLedger<Death>();
    ledger.shot(shotAt());
    expect(ledger.hurt(wound())).toBe(true);
    expect(ledger.heldAmount(5)).toBe(40);
    expect(ledger.holds(5)).toBe(true);
    expect(ledger.heldShots).toBe(1);

    const released = ledger.land(1);
    expect(released.wounds).toEqual([wound()]);
    expect(released.deaths).toEqual([]);
    expect(ledger.heldAmount(5)).toBe(0);
    expect(ledger.holds(5)).toBe(false);
    expect(ledger.heldShots).toBe(0);
    // A second landing report for the same bullet changes nothing.
    expect(ledger.land(1).wounds).toEqual([]);
  });

  it("shows a wound at once after a shot that does not travel: a beam, a bolt, a rail", () => {
    const ledger = new ShotLedger<Death>();
    ledger.shot(null);
    expect(ledger.hurt(wound())).toBe(false);
    expect(ledger.heldAmount(5)).toBe(0);
  });

  it("does not claim a wound from another tick, another creep, or after something else happened", () => {
    const ledger = new ShotLedger<Death>();
    ledger.shot(shotAt());
    expect(ledger.hurt(wound({ tick: 11 }))).toBe(false);

    ledger.shot(shotAt({ key: 2 }));
    // Not the target, and the sniper has no splash: a trap's or a creep's.
    expect(ledger.hurt(wound({ creepId: 6 }))).toBe(false);

    ledger.shot(shotAt({ key: 3 }));
    ledger.interrupt();
    expect(ledger.hurt(wound())).toBe(false);

    ledger.shot(shotAt({ key: 4 }));
    expect(ledger.hurt(wound())).toBe(true);
    // The target's wound came; a second one on it is someone else's bite.
    expect(ledger.hurt(wound())).toBe(false);
    expect(ledger.heldAmount(5)).toBe(40);
  });

  it("holds a splash tower's blast on the creeps inside it and lets the rest through", () => {
    const ledger = new ShotLedger<Death>();
    ledger.shot(shotAt({ splash: 30 }));
    expect(ledger.hurt(wound())).toBe(true);
    // Twenty yard units along x: inside a blast of thirty.
    expect(ledger.hurt(wound({ creepId: 6, ix: 120, amount: 12 }))).toBe(true);
    // Two hundred along x is far outside it: not this shot's.
    expect(ledger.hurt(wound({ creepId: 7, ix: 300, amount: 12 }))).toBe(false);
    // And the shot is closed after that.
    expect(ledger.hurt(wound({ creepId: 8, ix: 101, amount: 12 }))).toBe(false);

    const released = ledger.land(1);
    expect(released.wounds.map((held) => held.creepId)).toEqual([5, 6]);
  });

  it("holds a death until the last bullet carrying a wound to that creep has landed", () => {
    const ledger = new ShotLedger<Death>();
    // Two towers hit creep 5 on the same tick; the second kills it.
    ledger.shot(shotAt({ key: 1 }));
    ledger.hurt(wound({ amount: 60 }));
    ledger.shot(shotAt({ key: 2 }));
    ledger.hurt(wound({ amount: 40 }));
    expect(ledger.death({ creepId: 5 })).toBe(true);
    expect(ledger.holdsDeath(5)).toBe(true);
    expect(ledger.heldAmount(5)).toBe(100);

    // The slower bullet lands second, whichever tower it came from.
    const first = ledger.land(2);
    expect(first.wounds.map((held) => held.amount)).toEqual([40]);
    expect(first.deaths).toEqual([]);
    expect(ledger.heldAmount(5)).toBe(60);
    expect(ledger.holds(5)).toBe(true);

    const second = ledger.land(1);
    expect(second.deaths).toEqual([{ creepId: 5 }]);
    expect(ledger.holds(5)).toBe(false);
    expect(ledger.holdsDeath(5)).toBe(false);
  });

  it("lets a death through at once when nothing is on its way to that creep", () => {
    const ledger = new ShotLedger<Death>();
    expect(ledger.death({ creepId: 5 })).toBe(false);
    ledger.shot(shotAt());
    ledger.hurt(wound());
    expect(ledger.death({ creepId: 9 })).toBe(false);
  });

  it("lands a bullet that never reported itself once it is too old to still be flying", () => {
    const ledger = new ShotLedger<Death>();
    ledger.shot(shotAt({ tick: 10 }));
    ledger.hurt(wound({ tick: 10 }));
    ledger.death({ creepId: 5 });
    expect(ledger.expire(10 + HOLD_LIMIT_TICKS - 1).wounds).toEqual([]);
    const released = ledger.expire(10 + HOLD_LIMIT_TICKS);
    expect(released.wounds).toHaveLength(1);
    expect(released.deaths).toEqual([{ creepId: 5 }]);
    expect(ledger.heldShots).toBe(0);
  });

  it("forgets everything on clear", () => {
    const ledger = new ShotLedger<Death>();
    ledger.shot(shotAt());
    ledger.hurt(wound());
    ledger.clear();
    expect(ledger.heldShots).toBe(0);
    expect(ledger.holds(5)).toBe(false);
    expect(ledger.hurt(wound())).toBe(false);
  });
});
