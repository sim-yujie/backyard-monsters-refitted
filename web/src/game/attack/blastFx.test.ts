import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import { BlastFx, MAX_BITS, MAX_MARKS, MAX_SHAKE, bitPath, blastNoise, tintAt } from "./blastFx";

const fxOf = (reducedMotion = false) => {
  const air = new Container();
  const ground = new Container();
  const shakes: [number, number][] = [];
  const fx = new BlastFx(
    { air, ground: () => ground, shake: (dx, dy) => shakes.push([dx, dy]) },
    reducedMotion,
  );
  return { fx, air, ground, shakes };
};

describe("the drawn blasts (feat/eyera-explosion)", () => {
  for (const kind of ["punchy", "fiery"] as const) {
    it(`${kind}: plays out and leaves nothing behind`, () => {
      const { fx, air, ground } = fxOf();
      fx[kind](10, { x: 100, y: 50 }, 85);
      fx.update(12);
      expect(fx.blastsMade).toBe(1);
      expect(fx.bitCount).toBeGreaterThan(5);
      // Long after: every bit back in the pool, every mark gone.
      fx.update(10 + 400);
      expect(fx.bitCount).toBe(0);
      expect(fx.markCount).toBe(0);
      expect(air.children.length).toBe(0);
      expect(ground.children.length).toBe(0);
    });
  }

  it("fiery: leaves a scorch on the ground and does not shake", () => {
    const { fx, ground, shakes } = fxOf();
    fx.fiery(10, { x: 0, y: 0 }, 85);
    fx.update(11);
    expect(fx.markCount).toBe(1);
    expect(ground.children.length).toBe(1);
    for (let tick = 11; tick < 40; tick += 1) fx.update(tick);
    expect(shakes.every(([dx, dy]) => dx === 0 && dy === 0)).toBe(true);
  });

  it("draws the same blast for the same tick: the replay looks alike", () => {
    expect(blastNoise(120, 3)).toBe(blastNoise(120, 3));
    expect(blastNoise(120, 3)).not.toBe(blastNoise(121, 3));
    const a = fxOf();
    const b = fxOf();
    a.fx.fiery(50, { x: 0, y: 0 }, 85);
    b.fx.fiery(50, { x: 0, y: 0 }, 85);
    a.fx.update(60);
    b.fx.update(60);
    const where = (air: Container) => air.children.map((child) => [child.x, child.y]);
    expect(where(a.air)).toEqual(where(b.air));
  });

  it("caps the sprites with many Eye-ras at once", () => {
    const { fx, ground } = fxOf();
    for (let index = 0; index < 40; index += 1) fx.fiery(10, { x: index * 10, y: 0 }, 85);
    expect(fx.bitCount).toBeLessThanOrEqual(MAX_BITS);
    expect(fx.markCount).toBeLessThanOrEqual(MAX_MARKS);
    expect(ground.children.length).toBeLessThanOrEqual(MAX_MARKS);
  });

  it("shakes the yard for a punchy blast, then puts it back", () => {
    const { fx, shakes } = fxOf();
    fx.punchy(10, { x: 0, y: 0 }, 85);
    for (let tick = 10; tick < 40; tick += 1) fx.update(tick);
    expect(shakes.some(([dx, dy]) => dx !== 0 || dy !== 0)).toBe(true);
    expect(shakes.at(-1)).toEqual([0, 0]);
    for (const [dx, dy] of shakes) {
      expect(Math.abs(dx)).toBeLessThanOrEqual(8);
      expect(Math.abs(dy)).toBeLessThanOrEqual(8);
    }
  });

  it("does not shake, nor throw bits, for a viewer who asked for less motion", () => {
    const { fx, shakes } = fxOf(true);
    fx.punchy(10, { x: 0, y: 0 }, 85);
    for (let tick = 10; tick < 40; tick += 1) fx.update(tick);
    expect(shakes.every(([dx, dy]) => dx === 0 && dy === 0)).toBe(true);
    // The flashes and rings only.
    const still = fxOf(true);
    still.fx.punchy(10, { x: 0, y: 0 }, 85);
    expect(still.fx.bitCount).toBeLessThanOrEqual(5);
  });
});

describe("punchy strengths and the shared shake (feat/punchy-trial)", () => {
  it("light: the flash and the shockwave only, no sparks and no shake", () => {
    const light = fxOf();
    light.fx.punchy(10, { x: 0, y: 0 }, 85, "light");
    // One flash, two shockwave rings.
    expect(light.fx.bitCount).toBe(3);
    expect(light.fx.shakeAmp).toBe(0);
    for (let tick = 10; tick < 40; tick += 1) light.fx.update(tick);
    expect(light.shakes.every(([dx, dy]) => dx === 0 && dy === 0)).toBe(true);

    const full = fxOf();
    full.fx.punchy(10, { x: 0, y: 0 }, 85, "full");
    expect(full.fx.bitCount).toBeGreaterThan(10);
    expect(full.fx.shakeAmp).toBeGreaterThan(0);
  });

  it("is full when no strength is given", () => {
    const { fx } = fxOf();
    fx.punchy(10, { x: 0, y: 0 }, 85);
    expect(fx.shakeAmp).toBeGreaterThan(0);
  });

  it("never shakes past the cap, even for a huge blast", () => {
    const { fx, shakes } = fxOf();
    fx.punchy(10, { x: 0, y: 0 }, 2000);
    expect(fx.shakeAmp).toBeLessThanOrEqual(MAX_SHAKE);
    for (let tick = 10; tick < 40; tick += 1) fx.update(tick);
    for (const [dx, dy] of shakes) {
      expect(Math.abs(dx)).toBeLessThanOrEqual(MAX_SHAKE);
      expect(Math.abs(dy)).toBeLessThanOrEqual(MAX_SHAKE);
    }
  });

  it("runs one shake at a time: blasts together shake no harder than one", () => {
    const one = fxOf();
    one.fx.punchy(10, { x: 0, y: 0 }, 85);
    const many = fxOf();
    for (let index = 0; index < 6; index += 1) many.fx.punchy(10, { x: index * 30, y: 0 }, 85);
    for (let tick = 10; tick < 40; tick += 1) {
      one.fx.update(tick);
      many.fx.update(tick);
    }
    expect(many.shakes).toEqual(one.shakes);
  });

  it("lets a harder blast take over a fading shake, and not a softer one", () => {
    const { fx } = fxOf();
    fx.punchy(10, { x: 0, y: 0 }, 85);
    const first = fx.shakeAmp;
    // A small blast while the first still shakes hard: the first goes on.
    fx.punchy(11, { x: 0, y: 0 }, 40);
    expect(fx.shakeAmp).toBe(first);
    // Late in the first one's life, a fresh blast starts its own.
    fx.punchy(22, { x: 0, y: 0 }, 60);
    expect(fx.shakeAmp).toBeLessThan(first);
    expect(fx.shakeAmp).toBeGreaterThan(0);
    // Long after, none runs and the yard is back in place.
    fx.update(60);
    expect(fx.shakeAmp).toBe(0);
  });
});

describe("the blast's arithmetic", () => {
  it("blends tints between stops", () => {
    expect(tintAt([0xff0000, 0x0000ff], 0)).toBe(0xff0000);
    expect(tintAt([0xff0000, 0x0000ff], 1)).toBe(0x0000ff);
    expect(tintAt([0x000000, 0xffffff], 0.5)).toBe(0x808080);
  });

  it("lands a thrown bit and keeps it on the ground", () => {
    const bit = { x: 0, y: 0, z: 0, vx: 2, vy: 1, vz: 4, drag: 0, gravity: 0.5 };
    // Up and back down in 16 ticks.
    expect(bitPath(bit, 8).z).toBeCloseTo(16);
    const landed = bitPath(bit, 16);
    expect(landed.landed).toBe(true);
    expect(landed.z).toBe(0);
    expect(bitPath(bit, 40)).toEqual(landed);
  });

  it("slows a dragged bit to a stop", () => {
    const bit = { x: 0, y: 0, z: 0, vx: 10, vy: 0, vz: 0, drag: 0.2, gravity: 0 };
    expect(bitPath(bit, 1).x).toBeCloseTo(10);
    expect(bitPath(bit, 200).x).toBeCloseTo(50);
  });
});
