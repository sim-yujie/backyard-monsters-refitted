import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import { popScale } from "./creepFx";
import {
  EyeraBlastFx,
  MAX_BITS,
  MAX_MARKS,
  bitPath,
  blastNoise,
  blastStyleNamed,
  tintAt,
  type BlastStyle,
} from "./eyeraBlastFx";

const fxOf = (style: BlastStyle, reducedMotion = false) => {
  const air = new Container();
  const ground = new Container();
  const shakes: [number, number][] = [];
  const fx = new EyeraBlastFx(
    { air, ground: () => ground, shake: (dx, dy) => shakes.push([dx, dy]) },
    style,
    reducedMotion,
  );
  return { fx, air, ground, shakes };
};

describe("the Eye-ra blast styles (feat/eyera-explosion)", () => {
  it("reads the ?blast= names, and nothing else", () => {
    expect(blastStyleNamed("a")).toBe("punchy");
    expect(blastStyleNamed(" B ")).toBe("fiery");
    expect(blastStyleNamed("goo")).toBe("goo");
    expect(blastStyleNamed("off")).toBe("ring");
    expect(blastStyleNamed("nuke")).toBeNull();
    expect(blastStyleNamed(null)).toBeNull();
  });

  it("leaves today's rings to the layer: the ring style draws nothing", () => {
    const { fx, air, ground } = fxOf("ring");
    fx.blast(10, { x: 0, y: 0 }, 85);
    fx.update(11);
    expect(fx.bitCount).toBe(0);
    expect(air.children.length + ground.children.length).toBe(0);
  });

  for (const style of ["punchy", "fiery", "goo"] as const) {
    it(`${style}: plays out and leaves nothing behind`, () => {
      const { fx, air, ground } = fxOf(style);
      fx.blast(10, { x: 100, y: 50 }, 85);
      fx.update(12);
      expect(fx.bitCount).toBeGreaterThan(5);
      // Long after: every bit back in the pool, every mark gone.
      fx.update(10 + 400);
      expect(fx.bitCount).toBe(0);
      expect(fx.markCount).toBe(0);
      expect(air.children.length).toBe(0);
      expect(ground.children.length).toBe(0);
    });
  }

  it("draws the same blast for the same tick: the replay looks alike", () => {
    expect(blastNoise(120, 3)).toBe(blastNoise(120, 3));
    expect(blastNoise(120, 3)).not.toBe(blastNoise(121, 3));
    const a = fxOf("goo");
    const b = fxOf("goo");
    a.fx.blast(50, { x: 0, y: 0 }, 85);
    b.fx.blast(50, { x: 0, y: 0 }, 85);
    a.fx.update(60);
    b.fx.update(60);
    const where = (air: Container) => air.children.map((child) => [child.x, child.y]);
    expect(where(a.air)).toEqual(where(b.air));
  });

  it("caps the sprites with many Eye-ras at once", () => {
    const { fx, ground } = fxOf("fiery");
    for (let index = 0; index < 40; index += 1) fx.blast(10, { x: index * 10, y: 0 }, 85);
    expect(fx.bitCount).toBeLessThanOrEqual(MAX_BITS);
    expect(fx.markCount).toBeLessThanOrEqual(MAX_MARKS);
    expect(ground.children.length).toBeLessThanOrEqual(MAX_MARKS);
  });

  it("shakes the yard for a punchy blast, then puts it back", () => {
    const { fx, shakes } = fxOf("punchy");
    fx.blast(10, { x: 0, y: 0 }, 85);
    for (let tick = 10; tick < 40; tick += 1) fx.update(tick);
    expect(shakes.some(([dx, dy]) => dx !== 0 || dy !== 0)).toBe(true);
    expect(shakes.at(-1)).toEqual([0, 0]);
    for (const [dx, dy] of shakes) {
      expect(Math.abs(dx)).toBeLessThanOrEqual(8);
      expect(Math.abs(dy)).toBeLessThanOrEqual(8);
    }
  });

  it("does not shake, nor throw bits, for a viewer who asked for less motion", () => {
    const { fx, shakes } = fxOf("punchy", true);
    fx.blast(10, { x: 0, y: 0 }, 85);
    for (let tick = 10; tick < 40; tick += 1) fx.update(tick);
    expect(shakes.every(([dx, dy]) => dx === 0 && dy === 0)).toBe(true);
    // The flashes and rings only.
    const still = fxOf("punchy", true);
    still.fx.blast(10, { x: 0, y: 0 }, 85);
    expect(still.fx.bitCount).toBeLessThanOrEqual(5);
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

  it("pops a goo blast's number in big, then settles", () => {
    expect(popScale(0)).toBe(1);
    expect(popScale(4)).toBeCloseTo(2.3);
    expect(popScale(30)).toBeCloseTo(1.6);
  });
});
