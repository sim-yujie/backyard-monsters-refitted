import { describe, expect, it } from "vitest";
import { mulberry32 } from "@/game/combat/rules/rng";
import {
  blendOf,
  isInfernoMonster,
  GIBLETS_IN_AIR_LIMIT,
  gibletPose,
  JUICER_SPOUT_HEIGHT,
  JUICER_TICK_HZ,
  JuicerBlend,
  planGiblets,
  spurtAmount,
  type BlendEvent,
} from "./juicerShow";

/** Runs a blend one 40 fps frame at a time, noting each event's frame. */
const run = (blend: JuicerBlend, frames: number): { frame: number; event: BlendEvent }[] => {
  const seen: { frame: number; event: BlendEvent }[] = [];
  for (let frame = 0; frame < frames; frame++) {
    for (const event of blend.advance(1 / JUICER_TICK_HZ)) seen.push({ frame, event });
  }
  return seen;
};

describe("spurtAmount (BUILDING9.as AnimFrame)", () => {
  it("caps the blend at 70 and scales it x1.2 at level 2, x1.4 at level 3, whole numbers", () => {
    expect(spurtAmount(5, 1)).toBe(5);
    expect(spurtAmount(500, 1)).toBe(70);
    expect(spurtAmount(500, 2)).toBe(84);
    expect(spurtAmount(500, 3)).toBe(98);
    expect(spurtAmount(7, 2)).toBe(8);
    expect(spurtAmount(7, 3)).toBe(9);
  });

  it("counts a monster's blend as ceil(hatch cost / 400)", () => {
    expect(blendOf(0)).toBe(0);
    expect(blendOf(1)).toBe(1);
    expect(blendOf(400)).toBe(1);
    expect(blendOf(401)).toBe(2);
  });
});

describe("JuicerBlend (BUILDING9.as TickFast)", () => {
  it("stands still with nothing to blend", () => {
    const blend = new JuicerBlend(1);
    expect(run(blend, 200)).toEqual([]);
    expect(blend.cell).toBe(0);
  });

  it("plays the sound after cell 1, spurts and spends the blend after cell 15, and stops after one loop", () => {
    const blend = new JuicerBlend(3);
    blend.add(10);
    const seen = run(blend, 400);
    // A cell every other frame: the 1st at frame 0, the 15th at frame 28.
    expect(seen).toEqual([
      { frame: 0, event: { kind: "sound" } },
      { frame: 28, event: { kind: "spurt", amount: 14 } },
      { frame: 28, event: { kind: "goo" } },
    ]);
    expect(blend.blend).toBe(0);
    expect(blend.running).toBe(false);
    // 52 cells shown, 0..51, then back to the start: it rests on the last shown.
    expect(blend.cell).toBe(51);
    expect(blend.animTick).toBe(0);
  });

  it("adds arrivals before the spurt into it, and runs again for one after it", () => {
    const blend = new JuicerBlend(1);
    blend.add(2);
    run(blend, 10);
    blend.add(3);
    const first = run(blend, 30);
    expect(first.find(({ event }) => event.kind === "spurt")?.event).toEqual({ kind: "spurt", amount: 5 });
    blend.add(4);
    const rest = run(blend, 400);
    expect(rest.filter(({ event }) => event.kind === "spurt").map(({ event }) => event)).toEqual([
      { kind: "spurt", amount: 4 },
    ]);
    expect(rest.filter(({ event }) => event.kind === "sound")).toHaveLength(1);
  });

  it("catches up a long frame by at most 20 frames", () => {
    const blend = new JuicerBlend(1);
    blend.add(1);
    blend.advance(60);
    expect(blend.animTick).toBe(10);
  });
});

const rng7 = mulberry32(7);
const rng3 = mulberry32(3);

describe("planGiblets (GIBLETS.Create)", () => {
  it("throws one giblet per count, staggered by 1/100 s, landing round the spout", () => {
    const giblets = planGiblets({ x: 100, y: 50 }, 30, 0, () => rng7.float());
    expect(giblets).toHaveLength(30);
    giblets.forEach((giblet, i) => {
      expect(giblet.delay).toBeCloseTo(i / 100);
      expect(giblet.duration).toBeGreaterThanOrEqual(0.3);
      expect(Math.abs(giblet.fromX - 100)).toBeLessThanOrEqual(3);
      expect(Math.abs(giblet.fromY - 50)).toBeLessThanOrEqual(2);
      // At most 150 yard units out: 150 * sqrt(2) px across, half that down, plus the spout height.
      expect(Math.abs(giblet.toX - giblet.fromX)).toBeLessThanOrEqual(150 * Math.SQRT2 + 1);
      expect(Math.abs(giblet.toY - giblet.fromY - JUICER_SPOUT_HEIGHT)).toBeLessThanOrEqual(75 * Math.SQRT2 + 1);
    });
  });

  it("throws none while 20 are in the air", () => {
    expect(planGiblets({ x: 0, y: 0 }, 10, GIBLETS_IN_AIR_LIMIT)).toEqual([]);
    expect(planGiblets({ x: 0, y: 0 }, 10, GIBLETS_IN_AIR_LIMIT - 1)).toHaveLength(10);
  });

  it("hides a giblet until it leaves, hops it on the way and lands it at its end", () => {
    const [giblet] = planGiblets({ x: 0, y: 0 }, 1, 0, () => rng3.float());
    expect(gibletPose(giblet!, -0.01)).toBeNull();
    const start = gibletPose(giblet!, 0)!;
    expect(start.x).toBeCloseTo(giblet!.fromX);
    expect(start.lift).toBeCloseTo(0);
    const middle = gibletPose(giblet!, giblet!.duration / 2)!;
    expect(middle.lift).toBeCloseTo(giblet!.hop);
    expect(gibletPose(giblet!, giblet!.duration)).toBeNull();
  });
  it("throws magma for an Inferno monster, as BUILDING9.Blend's IC test, and goo for the rest", () => {
    expect(isInfernoMonster("IC1")).toBe(true);
    expect(isInfernoMonster("IC7")).toBe(true);
    expect(isInfernoMonster("C6")).toBe(false);
    expect(isInfernoMonster("C14")).toBe(false);
    expect(isInfernoMonster("G1")).toBe(false);
  });
});
