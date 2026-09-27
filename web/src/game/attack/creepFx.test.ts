import { describe, expect, it } from "vitest";
import type { Point } from "@/game/yard/YardGrid";
import {
  BURST_TICKS,
  CreepFx,
  FLASH_COOLDOWN_TICKS,
  FLASH_TICKS,
  LABEL_MERGE_TICKS,
  LABEL_POOL,
  LABEL_RISE,
  LABEL_TICKS,
  LUNGE_PX,
  LUNGE_TICKS,
  PROJECTILE_TICKS,
  SMOKE_TICKS,
  drawsProjectile,
  flightPoint,
  labelPose,
  lungeOffset,
  type CreepFxHost,
} from "./creepFx";

/**
 * The creep-side effects of issues #63 and #68 without a renderer: the lunge
 * and flight arithmetic, and the effects object driven by hand — projectiles
 * that land and flash, smoke that pools, damage numbers that follow their
 * creep, merge, expire and recycle.
 */

describe("arithmetic", () => {
  it("lunges out and back, peaking halfway and resting outside the window", () => {
    expect(lungeOffset(-1)).toBe(0);
    expect(lungeOffset(0)).toBe(0);
    expect(lungeOffset(LUNGE_TICKS / 2)).toBeCloseTo(LUNGE_PX);
    expect(lungeOffset(LUNGE_TICKS)).toBe(0);
    expect(lungeOffset(LUNGE_TICKS + 5)).toBe(0);
    expect(lungeOffset(1)).toBeGreaterThan(0);
    expect(lungeOffset(1)).toBeLessThan(LUNGE_PX);
  });

  it("flies from the body to the target with an arc that lifts the middle", () => {
    const from: Point = { x: 0, y: 100 };
    const to: Point = { x: 100, y: 100 };
    expect(flightPoint(from, to, 0)).toEqual({ x: 0, y: 100 });
    expect(flightPoint(from, to, PROJECTILE_TICKS).x).toBe(100);
    expect(flightPoint(from, to, PROJECTILE_TICKS).y).toBeCloseTo(100);
    const middle = flightPoint(from, to, PROJECTILE_TICKS / 2);
    expect(middle.x).toBe(50);
    expect(middle.y).toBeLessThan(100);
    // Never overshoots.
    expect(flightPoint(from, to, PROJECTILE_TICKS * 2)).toEqual(flightPoint(from, to, PROJECTILE_TICKS));
  });

  it("rises a damage number steadily and fades it in its second half", () => {
    expect(labelPose(0)).toEqual({ rise: 0, alpha: 1 });
    expect(labelPose(LABEL_TICKS / 2).alpha).toBe(1);
    expect(labelPose(LABEL_TICKS / 2).rise).toBeCloseTo(LABEL_RISE / 2);
    expect(labelPose(LABEL_TICKS).rise).toBe(LABEL_RISE);
    expect(labelPose(LABEL_TICKS).alpha).toBeCloseTo(0);
  });

  it("draws a projectile for a ranged swing unless the monster stomps", () => {
    expect(drawsProjectile("G3", true)).toBe(true);
    expect(drawsProjectile("C14", true)).toBe(true);
    expect(drawsProjectile("C1", false)).toBe(false);
    // Gorgo's reach of 35 is a stomp, not a shot.
    expect(drawsProjectile("G1", true)).toBe(false);
    expect(drawsProjectile("G4", true)).toBe(false);
  });
});

/* ── The effects object ─────────────────────────────────────────────────── */

interface Host extends CreepFxHost {
  anchors: Map<number, { ground: Point; top: number }>;
  flashes: Array<{ id: number; on: boolean }>;
}

const hostOf = (): Host => {
  const anchors = new Map<number, { ground: Point; top: number }>();
  const flashes: Array<{ id: number; on: boolean }> = [];
  return {
    anchors,
    flashes,
    creepAnchor: (id) => anchors.get(id) ?? null,
    flashBuilding: (id, on) => flashes.push({ id, on }),
  };
};

describe("CreepFx", () => {
  it("lands a projectile after its flight, flashes the building, then puts it back", () => {
    const host = hostOf();
    const fx = new CreepFx(host);
    fx.projectile(10, { x: 0, y: 0 }, { x: 80, y: 40 }, 7, true);
    expect(fx.projectileCount).toBe(1);
    fx.update(11);
    expect(host.flashes).toEqual([]);
    fx.update(10 + PROJECTILE_TICKS);
    expect(host.flashes).toEqual([{ id: 7, on: true }]);
    expect(fx.flashing).toEqual([7]);
    fx.update(10 + PROJECTILE_TICKS + FLASH_TICKS);
    expect(host.flashes).toEqual([
      { id: 7, on: true },
      { id: 7, on: false },
    ]);
    // The burst lingers a little past the landing, then the projectile is gone.
    expect(fx.projectileCount).toBe(1);
    fx.update(10 + PROJECTILE_TICKS + BURST_TICKS + 1);
    expect(fx.projectileCount).toBe(0);
    fx.destroy();
  });

  it("does not strobe a building hit by a mob: one flash per cooldown", () => {
    const host = hostOf();
    const fx = new CreepFx(host);
    fx.flash(3, 100);
    fx.flash(3, 101);
    fx.flash(3, 102);
    expect(host.flashes.filter((flash) => flash.on)).toHaveLength(1);
    fx.update(100 + FLASH_TICKS);
    expect(host.flashes.at(-1)).toEqual({ id: 3, on: false });
    fx.flash(3, 100 + FLASH_COOLDOWN_TICKS - 1);
    expect(host.flashes.filter((flash) => flash.on)).toHaveLength(1);
    fx.flash(3, 100 + FLASH_COOLDOWN_TICKS);
    expect(host.flashes.filter((flash) => flash.on)).toHaveLength(2);
    // Nothing for a swing at a creep rather than a building.
    fx.flash(-1, 500);
    expect(host.flashes.filter((flash) => flash.on)).toHaveLength(2);
    fx.destroy();
  });

  it("puffs smoke that fades out and is pooled for the next poof", () => {
    const fx = new CreepFx(hostOf());
    fx.poof(0, { x: 100, y: 100 }, false);
    expect(fx.puffCount).toBe(4);
    fx.update(SMOKE_TICKS + 1);
    expect(fx.puffCount).toBe(0);
    fx.poof(SMOKE_TICKS + 1, { x: 100, y: 100 }, true);
    expect(fx.puffCount).toBe(8);
    // A destroyed building goes on streaming puffs for a while.
    fx.update(SMOKE_TICKS + 1 + 20);
    expect(fx.puffCount).toBeGreaterThan(8);
    fx.update(SMOKE_TICKS * 4);
    expect(fx.puffCount).toBe(0);
    fx.destroy();
  });

  it("shows a wound as a number bound to the creep, following it as it moves", () => {
    const host = hostOf();
    host.anchors.set(5, { ground: { x: 100, y: 200 }, top: 170 });
    const fx = new CreepFx(host);
    fx.hurt(10, 5, 20, { x: 100, y: 164 }, false);
    expect(fx.labelCount).toBe(1);
    fx.update(10);
    expect(fx.labelFor(5)).toEqual({ amount: 20, x: 100, y: 164 });
    host.anchors.set(5, { ground: { x: 130, y: 200 }, top: 170 });
    fx.update(10 + LABEL_TICKS / 2);
    const later = fx.labelFor(5);
    expect(later?.x).toBe(130);
    expect(later?.y).toBeCloseTo(164 - LABEL_RISE / 2, 0);
    fx.destroy();
  });

  it("adds a wound within the merge window to the number already showing", () => {
    const fx = new CreepFx(hostOf());
    fx.hurt(10, 5, 20, { x: 0, y: 0 }, false);
    fx.hurt(10 + LABEL_MERGE_TICKS - 1, 5, 7.4, { x: 0, y: 0 }, false);
    expect(fx.labelCount).toBe(1);
    fx.update(10 + LABEL_MERGE_TICKS - 1);
    expect(fx.labelFor(5)?.amount).toBe(27);
    // Past the window, a second number.
    fx.hurt(10 + LABEL_MERGE_TICKS, 5, 5, { x: 0, y: 0 }, false);
    expect(fx.labelCount).toBe(2);
    fx.update(10 + LABEL_MERGE_TICKS);
    expect(fx.labelFor(5)?.amount).toBe(5);
    fx.destroy();
  });

  it("recycles an expired number and caps how many are on screen", () => {
    const fx = new CreepFx(hostOf());
    fx.hurt(0, 1, 20, { x: 0, y: 0 }, false);
    fx.update(LABEL_TICKS + 1);
    expect(fx.labelCount).toBe(0);
    expect(fx.pooledLabelCount).toBe(1);
    expect(fx.labelFor(1)).toBeNull();
    fx.hurt(LABEL_TICKS + 1, 2, 30, { x: 0, y: 0 }, true);
    expect(fx.pooledLabelCount).toBe(0);
    expect(fx.labelCount).toBe(1);

    // Six hundred creeps hit in the same tick make at most LABEL_POOL numbers,
    // the oldest giving way to the newest.
    for (let creep = 100; creep < 700; creep += 1) {
      fx.hurt(LABEL_TICKS + 2, creep, 10, { x: 0, y: 0 }, false);
    }
    expect(fx.labelCount).toBe(LABEL_POOL);
    fx.update(LABEL_TICKS + 2);
    expect(fx.labelFor(2)).toBeNull();
    expect(fx.labelFor(699)?.amount).toBe(10);
    fx.destroy();
  });

  it("puts nothing in motion under reduced motion, but still shows the number", () => {
    const host = hostOf();
    host.anchors.set(1, { ground: { x: 50, y: 50 }, top: 30 });
    const fx = new CreepFx(host, true);
    fx.hurt(0, 1, 15, { x: 50, y: 24 }, false);
    fx.update(LABEL_TICKS / 2);
    expect(fx.labelFor(1)?.y).toBe(24);
    fx.poof(0, { x: 0, y: 0 }, true);
    fx.update(20);
    // No stream under reduced motion: only the poof itself.
    expect(fx.puffCount).toBe(8);
    fx.destroy();
  });

  it("switches every flash off and leaves the overlay when destroyed", () => {
    const host = hostOf();
    const fx = new CreepFx(host);
    fx.flash(4, 0);
    fx.destroy();
    expect(host.flashes.at(-1)).toEqual({ id: 4, on: false });
    expect(fx.root.parent).toBeNull();
  });
});
