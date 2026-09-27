import { describe, expect, it } from "vitest";
import { Container, Texture, type Sprite } from "pixi.js";
import { BOMBS, TICKS_PER_SECOND, type BombStats } from "@/game/combat/rules";
import {
  ANIM_TICKS_PER_FRAME,
  BombFx,
  FALL_HEIGHT,
  PEBBLE_HIT_FRAMES,
  landedCell,
  planBombRain,
  sineEaseIn,
  type BombArt,
  type BombCell,
} from "./bombFx";

/** The rain of `ResourceBomb`/`ResourceBombParticle` (issue #87). */

const bomb = (id: string): BombStats => {
  const found = BOMBS.find((one) => one.id === id);
  if (!found) throw new Error(id);
  return found;
};

/** A repeatable stream in [0, 1). */
const seeded = (seed = 1): (() => number) => {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
};

/** Every cell is ready at once, and the last one asked for is remembered. */
const artOf = (): BombArt & { asked: BombCell[] } => {
  const asked: BombCell[] = [];
  return {
    asked,
    cell: (cell) => {
      asked.push(cell);
      return Texture.WHITE;
    },
    destroy() {},
  };
};

describe("planBombRain", () => {
  it("spreads a twig bomb's 200 particles inside the blast, falling after 1-5 s for 0.3-0.8 s", () => {
    const spec = bomb("tw0");
    const plans = planBombRain(spec, { x: 1000, y: 500 }, seeded());
    expect(plans).toHaveLength(200);
    for (const plan of plans) {
      const dx = (plan.x - 1000) / (spec.radius / 2);
      const dy = (plan.y - 500) / (spec.radius / 4);
      expect(dx * dx + dy * dy).toBeLessThanOrEqual(1 + 1e-9);
      expect(plan.delay).toBeGreaterThanOrEqual(1 * TICKS_PER_SECOND);
      expect(plan.delay).toBeLessThanOrEqual(5 * TICKS_PER_SECOND);
      expect(plan.fall).toBeGreaterThanOrEqual(0.3 * TICKS_PER_SECOND);
      expect(plan.fall).toBeLessThanOrEqual(0.8 * TICKS_PER_SECOND);
      expect(plan.shape).toBeLessThan(5);
    }
    // Spread over the whole window, not bunched.
    const delays = plans.map((plan) => plan.delay);
    expect(Math.max(...delays) - Math.min(...delays)).toBeGreaterThan(3 * TICKS_PER_SECOND);
  });

  it("drops putty after exactly one second, and as many blobs as the tier has", () => {
    for (const [id, count] of [
      ["pu0", 25],
      ["pu1", 37],
      ["pu2", 43],
      ["pu3", 50],
    ] as const) {
      const plans = planBombRain(bomb(id), { x: 0, y: 0 }, seeded(3));
      expect(plans).toHaveLength(count);
      expect(new Set(plans.map((plan) => plan.delay))).toEqual(new Set([TICKS_PER_SECOND]));
      expect(plans.every((plan) => plan.variation < 4)).toBe(true);
    }
  });

  it("gives pebbles one of 18 shapes and one of four dust rows", () => {
    const plans = planBombRain(bomb("pb0"), { x: 0, y: 0 }, seeded(5));
    expect(plans.every((plan) => plan.shape < 18 && plan.variation < 4)).toBe(true);
    expect(new Set(plans.map((plan) => plan.shape)).size).toBeGreaterThan(10);
  });
});

describe("the frames", () => {
  it("eases in: slow off the mark, all the way down at the end", () => {
    expect(sineEaseIn(0)).toBe(0);
    expect(sineEaseIn(1)).toBeCloseTo(1, 12);
    expect(sineEaseIn(0.5)).toBeLessThan(0.5);
  });

  it("plays the pebble's dust along its row and holds the last frame", () => {
    const plan = { x: 0, y: 0, delay: 80, fall: 30, variation: 2, shape: 7 };
    expect(landedCell(2, plan, 0)).toMatchObject({ sheet: "pebblehit", x: 0, y: 170 });
    expect(landedCell(2, plan, 5)).toMatchObject({ x: 400, y: 170 });
    expect(landedCell(2, plan, 99)).toMatchObject({ x: 80 * (PEBBLE_HIT_FRAMES - 1) });
    // Twigs lie down in the second row; putty rows are 52 px apart.
    expect(landedCell(1, plan, 3)).toMatchObject({ sheet: "twigs", x: 24 * 7, y: 30 });
    expect(landedCell(3, plan, 99)).toMatchObject({ sheet: "putty", x: 81 * 13, y: 104 });
  });
});

describe("BombFx", () => {
  const rig = (reducedMotion = false) => {
    const air = new Container();
    const ground = new Container();
    const landings: number[] = [];
    const art = artOf();
    const fx = new BombFx(
      { air: () => air, ground: () => ground, landed: (key) => landings.push(key) },
      { art, random: seeded(9), reducedMotion },
    );
    return { air, ground, landings, art, fx };
  };
  const visible = (layer: Container): Sprite[] =>
    layer.children.filter((child) => child.visible) as Sprite[];

  it("hides every particle until its delay, drops it from up and to the right, and lands it once", () => {
    const { air, ground, landings, fx } = rig();
    const at = { x: 500, y: 300 };
    fx.drop(4, bomb("pb1"), at, 100);
    expect(fx.airborne).toBe(200);
    fx.update(100 + TICKS_PER_SECOND - 1);
    expect(visible(air)).toHaveLength(0);

    // Two seconds in, some are falling: above and right of the blast.
    fx.update(100 + 2 * TICKS_PER_SECOND);
    const falling = visible(air);
    expect(falling.length).toBeGreaterThan(0);
    expect(falling.every((sprite) => sprite.y < at.y + 100)).toBe(true);
    const landedSoFar = landings.length;
    expect(landedSoFar).toBeGreaterThan(0);
    expect(landedSoFar).toBeLessThan(200);
    expect(ground.children).toHaveLength(landedSoFar);

    // Past the last landing every particle has landed exactly once.
    fx.update(100 + 6 * TICKS_PER_SECOND);
    expect(landings).toHaveLength(200);
    expect(new Set(landings)).toEqual(new Set([4]));
    expect(fx.airborne).toBe(0);
    expect(air.children).toHaveLength(0);
    expect(visible(ground)).toHaveLength(200);
    fx.update(100 + 9 * TICKS_PER_SECOND);
    expect(landings).toHaveLength(200);
    fx.destroy();
  });

  it("starts a particle a stage height above where it lands, scaled to the zoom", () => {
    const { air, fx } = rig();
    const at = { x: 0, y: 0 };
    fx.drop(0, bomb("pu0"), at, 0, 0.5);
    // Putty falls at one second; one tick in, every blob is near the top.
    fx.update(TICKS_PER_SECOND + 1);
    for (const sprite of visible(air))
      expect(sprite.y).toBeLessThan(-FALL_HEIGHT * 2 * 0.9 + 60);
    fx.destroy();
  });

  it("lands whatever is still in the air when the attack ends", () => {
    const { ground, landings, fx } = rig();
    fx.drop(1, bomb("tw0"), { x: 0, y: 0 }, 0);
    fx.update(TICKS_PER_SECOND * 2);
    fx.settle();
    expect(landings).toHaveLength(200);
    expect(fx.airborne).toBe(0);
    expect(fx.debris).toBe(200);
    expect(visible(ground)).toHaveLength(200);
    fx.destroy();
  });

  it("shows nothing falling under reduced motion, and the dust's last frame on landing", () => {
    const { air, ground, art, fx } = rig(true);
    fx.drop(2, bomb("pb0"), { x: 0, y: 0 }, 0);
    for (let tick = 0; tick <= 6 * TICKS_PER_SECOND; tick += 7) {
      fx.update(tick);
      expect(visible(air)).toHaveLength(0);
    }
    expect(visible(ground)).toHaveLength(200);
    const dust = art.asked.filter((cell) => cell.sheet === "pebblehit");
    expect(dust.every((cell) => cell.x === 80 * (PEBBLE_HIT_FRAMES - 1))).toBe(true);
    fx.destroy();
  });

  it("plays the dust one frame per two ticks after a pebble lands", () => {
    const { art, fx } = rig();
    fx.drop(3, bomb("pb0"), { x: 0, y: 0 }, 0);
    for (let tick = 0; tick <= 6 * TICKS_PER_SECOND; tick += ANIM_TICKS_PER_FRAME)
      fx.update(tick);
    const frames = new Set(
      art.asked.filter((cell) => cell.sheet === "pebblehit").map((cell) => cell.x / 80),
    );
    expect(frames.size).toBe(PEBBLE_HIT_FRAMES);
    fx.destroy();
  });

  it("waits for a sheet that is not in yet, then shows the particle", () => {
    const air = new Container();
    const ground = new Container();
    let ready = false;
    const fx = new BombFx(
      { air: () => air, ground: () => ground, landed: () => {} },
      { art: { cell: () => (ready ? Texture.WHITE : null), destroy() {} }, random: seeded(2) },
    );
    fx.drop(0, bomb("tw0"), { x: 0, y: 0 }, 0);
    fx.update(6 * TICKS_PER_SECOND);
    expect(visible(ground)).toHaveLength(0);
    ready = true;
    fx.update(6 * TICKS_PER_SECOND + 1);
    expect(visible(ground)).toHaveLength(200);
    fx.destroy();
  });
});
