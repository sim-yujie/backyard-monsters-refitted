import { describe, expect, it } from "vitest";
import type { Point } from "@/game/yard/YardGrid";
import {
  BURST_TICKS,
  BUILDING_NUMBER_LIFT,
  CreepFx,
  FLASH_COOLDOWN_TICKS,
  FLASH_TICKS,
  LABEL_DIGIT_SHIFT,
  LABEL_MAX,
  LABEL_PER_TARGET,
  LABEL_RISE,
  LABEL_TICKS,
  LABEL_WINDOW_TICKS,
  LUNGE_PX,
  LUNGE_TICKS,
  PROJECTILE_TICKS,
  SMOKE_TICKS,
  drawsProjectile,
  flightPoint,
  labelPose,
  labelShift,
  lungeOffset,
  type CreepFxHost,
} from "./creepFx";

/**
 * The creep-side effects of issues #63 and #68 without a renderer: the lunge
 * and flight arithmetic, and the effects object driven by hand — projectiles
 * that land, flash and number their building, smoke that pools, damage
 * numbers that follow their creep, cap per target and overall, show healing
 * green, expire and recycle.
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

  it("rises a number 25 px with a cubic ease and fades only at the very end", () => {
    expect(labelPose(0)).toEqual({ rise: 0, alpha: 1 });
    const early = labelPose(LABEL_TICKS / 4);
    const half = labelPose(LABEL_TICKS / 2);
    const late = labelPose((LABEL_TICKS * 3) / 4);
    // Ease-in-out: slow start, half the rise at half time, slow finish.
    expect(early.rise).toBeLessThan(LABEL_RISE / 4);
    expect(half.rise).toBeCloseTo(LABEL_RISE / 2);
    expect(late.rise).toBeGreaterThan((LABEL_RISE * 3) / 4);
    expect(late.alpha).toBe(1);
    expect(labelPose(LABEL_TICKS).rise).toBe(LABEL_RISE);
    expect(labelPose(LABEL_TICKS).alpha).toBe(0);
  });

  it("shifts a target's second number right and third left, ten px a digit", () => {
    expect(labelShift(0, 3)).toBe(0);
    expect(labelShift(1, 2)).toBe(2 * LABEL_DIGIT_SHIFT);
    expect(labelShift(2, 3)).toBe(-3 * LABEL_DIGIT_SHIFT);
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
  zoomLevel: number;
}

const hostOf = (): Host => {
  const anchors = new Map<number, { ground: Point; top: number }>();
  const flashes: Array<{ id: number; on: boolean }> = [];
  const host: Host = {
    anchors,
    flashes,
    zoomLevel: 1,
    creepAnchor: (id) => anchors.get(id) ?? null,
    flashBuilding: (id, on) => flashes.push({ id, on }),
    zoom: () => host.zoomLevel,
  };
  return host;
};

const AT: Point = { x: 100, y: 164 };

describe("CreepFx", () => {
  it("lands a projectile after its flight, flashes and numbers the building, then puts it back", () => {
    const host = hostOf();
    const fx = new CreepFx(host);
    fx.projectile(10, { x: 0, y: 0 }, { x: 80, y: 40 }, 7, true, 120);
    expect(fx.projectileCount).toBe(1);
    fx.update(11);
    expect(host.flashes).toEqual([]);
    expect(fx.labelCount).toBe(0);
    fx.update(10 + PROJECTILE_TICKS);
    expect(host.flashes).toEqual([{ id: 7, on: true }]);
    expect(fx.flashing).toEqual([7]);
    expect(fx.labelsFor("building:7")).toEqual([
      { amount: -120, x: 80, y: 40 - BUILDING_NUMBER_LIFT },
    ]);
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

  it("shows a wound as a red number bound to the creep, following it as it moves", () => {
    const host = hostOf();
    host.anchors.set(5, { ground: { x: 100, y: 200 }, top: 170 });
    const fx = new CreepFx(host);
    fx.number(10, "creep:5", 5, 20, AT, "damage");
    expect(fx.labelCount).toBe(1);
    fx.update(10);
    expect(fx.labelsFor("creep:5")).toEqual([{ amount: -20, x: 100, y: 164 }]);
    host.anchors.set(5, { ground: { x: 130, y: 200 }, top: 170 });
    fx.update(10 + LABEL_TICKS / 2);
    const [later] = fx.labelsFor("creep:5");
    expect(later?.x).toBe(130);
    // Half the rise, on a whole pixel.
    expect(Math.abs((later?.y ?? 0) - (164 - LABEL_RISE / 2))).toBeLessThanOrEqual(0.5);
    fx.destroy();
  });

  it("shows healing as a green plus and rounds fractional amounts", () => {
    const fx = new CreepFx(hostOf());
    fx.number(0, "creep:2", 2, 33.4, AT, "heal");
    fx.update(0);
    expect(fx.labelsFor("creep:2")).toEqual([{ amount: 33, x: 100, y: 164 }]);
    fx.destroy();
  });

  it("shows at most three numbers per target in the window, shifted sideways", () => {
    const fx = new CreepFx(hostOf());
    fx.number(0, "creep:1", 1, 20, AT, "damage");
    fx.number(1, "creep:1", 1, 20, AT, "damage");
    fx.number(2, "creep:1", 1, 20, AT, "damage");
    fx.number(3, "creep:1", 1, 20, AT, "damage");
    fx.update(3);
    const shown = fx.labelsFor("creep:1");
    expect(shown).toHaveLength(LABEL_PER_TARGET);
    expect(shown.map((label) => label.x - AT.x)).toEqual([
      0,
      2 * LABEL_DIGIT_SHIFT,
      -2 * LABEL_DIGIT_SHIFT,
    ]);
    // Another target is not held back by this one.
    fx.number(3, "creep:9", 9, 5, AT, "damage");
    expect(fx.labelsFor("creep:9")).toHaveLength(1);
    // Once the window has passed the target may show numbers again.
    fx.number(LABEL_WINDOW_TICKS, "creep:1", 1, 7, AT, "damage");
    expect(fx.labelCount).toBe(5);
    fx.destroy();
  });

  it("recycles an expired number and shows no more than twenty at once", () => {
    const fx = new CreepFx(hostOf());
    fx.number(0, "creep:1", 1, 20, AT, "damage");
    fx.update(LABEL_TICKS + 1);
    expect(fx.labelCount).toBe(0);
    expect(fx.pooledLabelCount).toBe(1);
    expect(fx.labelsFor("creep:1")).toEqual([]);
    fx.number(LABEL_TICKS + 1, "creep:2", 2, 30, AT, "damage");
    expect(fx.pooledLabelCount).toBe(0);
    expect(fx.labelCount).toBe(1);

    // Six hundred creeps hit in the same tick make at most LABEL_MAX numbers;
    // the ones that do not fit are simply not shown, as Flash dropped them.
    for (let creep = 100; creep < 700; creep += 1) {
      fx.number(LABEL_TICKS + 2, `creep:${creep}`, creep, 10, AT, "damage");
    }
    expect(fx.labelCount).toBe(LABEL_MAX);
    fx.update(LABEL_TICKS + 2);
    expect(fx.labelsFor("creep:2")).toHaveLength(1);
    expect(fx.labelsFor("creep:699")).toEqual([]);
    fx.destroy();
  });

  it("keeps a number the same size on screen whatever the zoom", () => {
    const host = hostOf();
    const fx = new CreepFx(host);
    fx.number(0, "building:1", -1, 60, AT, "damage");
    host.zoomLevel = 2;
    fx.update(0);
    const text = fx.root.children[2]?.children[0] as { scale: { x: number } } | undefined;
    expect(text?.scale.x).toBeCloseTo(0.5);
    fx.destroy();
  });

  it("puts nothing in motion under reduced motion, but still shows the number", () => {
    const host = hostOf();
    host.anchors.set(1, { ground: { x: 50, y: 50 }, top: 30 });
    const fx = new CreepFx(host, true);
    fx.number(0, "creep:1", 1, 15, { x: 50, y: 24 }, "damage");
    fx.update(LABEL_TICKS / 2);
    expect(fx.labelsFor("creep:1")[0]?.y).toBe(24);
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
