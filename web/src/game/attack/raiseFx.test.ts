import { describe, expect, it } from "vitest";
import { Container, Texture, TextureSource } from "pixi.js";
import {
  BOLT_TICKS,
  ORB_GLOW_ALPHA,
  ORB_HALF,
  ORB_ORBIT_PX,
  ORB_URL_CLASSIC,
  ORB_URL_MODERN,
  RISE_BITS_TICKS,
  RISE_CLODS,
  RISE_CLOD_REACH,
  RISE_DROP_PX,
  RISE_GLOW_TICKS,
  RISE_GOO,
  RISE_GOO_DROP,
  RISE_GOO_REACH,
  RISE_TICKS,
  RaiseFx,
  type RaiseFxOptions,
  ZOMBIE_FADE_TICKS,
  lightningPath,
  orbCentre,
  orbGlowAlpha,
  orbOrbit,
  orbProgress,
  raiseJitter,
  riseBitAt,
  riseBits,
  riseDrop,
  riseGlowAlpha,
  saturationMatrix,
  zombieSaturation,
} from "./raiseFx";

describe("the rise out of the ground (`RezghulResurrectAttack.as:80-85`)", () => {
  it("is 20 px over 0.8 s", () => {
    expect(RISE_DROP_PX).toBe(20);
    expect(RISE_TICKS).toBe(64);
  });

  it("starts 20 px down and climbs on Sine.easeOut, fastest first", () => {
    expect(riseDrop(0)).toBe(20);
    expect(riseDrop(RISE_TICKS / 2)).toBeCloseTo(20 * (1 - Math.SQRT1_2), 6);
    expect(riseDrop(RISE_TICKS - 1)).toBeLessThan(0.01);
    expect(riseDrop(RISE_TICKS)).toBe(0);
    expect(riseDrop(-1)).toBe(0);
    // Sine.easeOut: the first half climbs more than the second.
    expect(riseDrop(0) - riseDrop(RISE_TICKS / 2)).toBeGreaterThan(riseDrop(RISE_TICKS / 2));
    for (let age = 1; age <= RISE_TICKS; age += 1)
      expect(riseDrop(age)).toBeLessThan(riseDrop(age - 1));
  });
});

describe("the zombie's grey (`Zombiefy.as:34`)", () => {
  it("goes from full colour to none over 1 s on Quad.easeOut", () => {
    expect(ZOMBIE_FADE_TICKS).toBe(80);
    expect(zombieSaturation(0)).toBe(1);
    expect(zombieSaturation(40)).toBeCloseTo(0.25, 6);
    expect(zombieSaturation(80)).toBe(0);
    expect(zombieSaturation(500)).toBe(0);
  });

  it("is TweenMax's saturation matrix: identity at 1, luminance grey at 0", () => {
    expect(saturationMatrix(1)).toEqual([
      1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0,
    ]);
    const grey = saturationMatrix(0);
    // Every colour row is the same luminance weights, which add up to 1.
    expect(grey.slice(0, 3)).toEqual(grey.slice(5, 8));
    expect(grey.slice(0, 3)).toEqual(grey.slice(10, 13));
    expect((grey[0] ?? 0) + (grey[1] ?? 0) + (grey[2] ?? 0)).toBeCloseTo(1, 5);
    expect(grey[1]).toBeCloseTo(0.71516, 6);
    expect(grey.slice(15)).toEqual([0, 0, 0, 1, 0]);
  });
});

describe("the orb's flight (`ResurrectProjectile.as`, `Projectilev2.as`)", () => {
  it("moves on the loop it is thrown and lands on its last", () => {
    expect(orbProgress(0, 9)).toBeCloseTo(0.1, 6);
    expect(orbProgress(4, 9)).toBeCloseTo(0.5, 6);
    expect(orbProgress(9, 9)).toBe(1);
    expect(orbProgress(20, 9)).toBe(1);
    expect(orbProgress(0, 0)).toBe(1);
  });

  it("circles 10 px off its path, 0.05 rad a loop", () => {
    expect(ORB_ORBIT_PX).toBe(10);
    const first = orbOrbit(0);
    expect(first.x).toBeCloseTo(10 * Math.cos(0.05), 6);
    expect(first.y).toBeCloseTo(10 * Math.sin(0.05), 6);
    // 31 loops in, a quarter turn: below its path.
    const later = orbOrbit(30);
    expect(Math.abs(later.x)).toBeLessThan(0.5);
    expect(later.y).toBeCloseTo(10, 1);
  });

  it("is drawn from its corner: its middle is 10 px in from the corner on its path", () => {
    expect(ORB_HALF).toBe(10);
    const centre = orbCentre({ x: 0, y: 0 }, { x: 100, y: 0 }, 4, 9);
    const orbit = orbOrbit(4);
    expect(centre.x).toBeCloseTo(50 + orbit.x + 10, 6);
    expect(centre.y).toBeCloseTo(orbit.y + 10, 6);
  });

  it("glows white up to alpha 0.8 over its first second", () => {
    expect(ORB_GLOW_ALPHA).toBe(0.8);
    expect(orbGlowAlpha(0)).toBe(0);
    expect(orbGlowAlpha(40)).toBeCloseTo(0.6, 6);
    expect(orbGlowAlpha(80)).toBeCloseTo(0.8, 6);
    expect(orbGlowAlpha(200)).toBeCloseTo(0.8, 6);
  });
});

describe("`EFFECTS.Lightning` (`EFFECTS.as:112-142`)", () => {
  it("puts a corner every 30 px, each within -7..8 px of the line", () => {
    const path = lightningPath({ x: 0, y: 0 }, { x: 95, y: 0 }, () => 0.5);
    // trunc(95 / 30) = 3 corners from the start, then the end.
    expect(path).toHaveLength(5);
    expect(path[0]).toEqual({ x: 0, y: 0 });
    expect(path[1]).toEqual({ x: 0.5, y: 0.5 });
    expect(path[2]?.x).toBeCloseTo(31.5, 6);
    expect(path[4]).toEqual({ x: 95, y: -5 });
  });

  it("is a single jump under 30 px", () => {
    const path = lightningPath({ x: 0, y: 0 }, { x: 20, y: 10 }, () => 0);
    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 15, y: 10 },
    ]);
  });

  it("jitters the same way for the same tick, and differently for another", () => {
    expect(raiseJitter(10, 3, 1)).toBe(raiseJitter(10, 3, 1));
    expect(raiseJitter(10, 3, 1)).not.toBe(raiseJitter(11, 3, 1));
    for (let tick = 0; tick < 200; tick += 1) {
      const value = raiseJitter(tick, 7, 2);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("the rise's clods and goo (`EFFECTS.Dig`, `GIBLETS.Create`)", () => {
  const bits = riseBits(1234);

  it("throws twenty clods out to 30 px and twenty bits of goo out to 50 px", () => {
    expect(bits.filter((bit) => !bit.goo)).toHaveLength(RISE_CLODS);
    expect(bits.filter((bit) => bit.goo)).toHaveLength(RISE_GOO);
    for (const bit of bits) {
      const reach = bit.goo ? RISE_GOO_REACH : RISE_CLOD_REACH;
      const drop = bit.goo ? RISE_GOO_DROP : 0;
      // Back off the flat ground (`GRID.ToISO`): x = gx - gy, y = (gx + gy) / 2.
      const gx = (bit.dx + 2 * (bit.dy - drop)) / 2;
      const gy = (2 * (bit.dy - drop) - bit.dx) / 2;
      const distance = Math.hypot(gx, gy);
      expect(distance).toBeGreaterThanOrEqual(reach * 0.2 - 1e-9);
      expect(distance).toBeLessThanOrEqual(reach * 1.5 + 1e-9);
      // max(0.3, sqrt(d * 0.3) * 0.2) s, hopping 50 px a second of flight.
      expect(bit.flight / 80).toBeCloseTo(Math.max(0.3, Math.sqrt(distance * 0.3) * 0.2), 6);
      expect(bit.hop).toBeCloseTo((bit.flight / 80) * 50, 6);
    }
  });

  it("is the same for the same rise", () => {
    expect(riseBits(1234)).toEqual(bits);
    expect(riseBits(99)).not.toEqual(bits);
  });

  it("hops each bit from the middle to where it lands; clods lie, then fade; goo is gone", () => {
    for (const bit of bits) {
      expect(riseBitAt(bit, bit.delay - 1).alpha).toBe(0);
      const start = riseBitAt(bit, bit.delay);
      expect(start.x).toBeCloseTo(0, 6);
      expect(start.y).toBeCloseTo(0, 6);
      const top = riseBitAt(bit, bit.delay + bit.flight / 2);
      expect(top.y).toBeCloseTo(bit.dy / 2 - bit.hop, 6);
      const down = riseBitAt(bit, bit.delay + bit.flight + 1e-6);
      expect(down.x).toBeCloseTo(bit.dx, 6);
      expect(down.y).toBeCloseTo(bit.dy, 6);
      expect(down.alpha).toBe(bit.goo ? 0 : 1);
      expect(riseBitAt(bit, RISE_BITS_TICKS).alpha).toBe(0);
    }
  });

  it("look B's ground glow is full at once and gone in 1.2 s", () => {
    expect(riseGlowAlpha(0)).toBe(1);
    expect(riseGlowAlpha(RISE_GLOW_TICKS / 2)).toBeCloseTo(0.75, 6);
    expect(riseGlowAlpha(RISE_GLOW_TICKS)).toBe(0);
  });
});

describe("RaiseFx", () => {
  const picture = (): Promise<Texture> =>
    Promise.resolve(
      new Texture({ source: new TextureSource({ width: 40, height: 40, resolution: 2 }) }),
    );
  const fxOf = (options: Partial<RaiseFxOptions>): RaiseFx => {
    const layer = new Container();
    return new RaiseFx({
      air: () => layer,
      ground: () => layer,
      classic: true,
      load: picture,
      ...options,
    });
  };

  it("loads the look's own orb", () => {
    const asked: string[] = [];
    for (const classic of [true, false]) {
      const fx = fxOf({
        classic,
        load: (url) => {
          asked.push(url);
          return picture();
        },
      });
      fx.preload();
    }
    expect(asked).toEqual([ORB_URL_CLASSIC, ORB_URL_MODERN]);
    expect(ORB_URL_CLASSIC).toContain("rezghul_projectile");
    expect(ORB_URL_CLASSIC).not.toContain("fireball");
  });

  it("flies an orb until it lands, with no lightning unless asked for", async () => {
    for (const look of ["A", "B"] as const) {
      const fx = fxOf({ look });
      fx.throwOrb(100, 300, 5, { x: 0, y: 0 }, { x: 400, y: 0 });
      await Promise.resolve();
      for (let tick = 100; tick < 300; tick += 1) {
        fx.update(tick, () => ({ x: 10, y: 10 }), [{ id: 3, ground: { x: 5, y: 5 } }]);
        expect(fx.flightCount).toBe(1);
        expect(fx.boltCount).toBe(0);
      }
      fx.update(300, () => null, []);
      expect(fx.flightCount).toBe(0);
      fx.destroy();
    }
  });

  it("throws a rise's clods and goo, and clears them once they fade", () => {
    for (const look of ["A", "B"] as const) {
      const fx = fxOf({ look });
      fx.rise(10, { x: 0, y: 20 }, { x: 0, y: 0 });
      expect(fx.burstCount).toBe(1);
      fx.update(10 + RISE_BITS_TICKS, () => null, []);
      expect(fx.burstCount).toBe(1);
      fx.update(11 + Math.max(RISE_BITS_TICKS, RISE_GLOW_TICKS), () => null, []);
      expect(fx.burstCount).toBe(0);
      fx.destroy();
    }
  });

  it("throws goo for one of four monsters raised at once, as Flash's caps allow", () => {
    const fx = fxOf({});
    for (let index = 0; index < 4; index += 1)
      fx.rise(10, { x: index * 40, y: 20 }, { x: index * 40, y: 0 });
    expect(fx.bitCounts).toEqual({ clods: 4 * RISE_CLODS, goo: RISE_GOO });
    fx.destroy();
  });

  it("with Flash's lightning asked for, sparks off an orb on about a quarter of its loops", async () => {
    const fx = fxOf({ lightning: true });
    fx.throwOrb(100, 300, 5, { x: 0, y: 0 }, { x: 400, y: 0 });
    await Promise.resolve();
    expect(fx.flightCount).toBe(1);
    let sparks = 0;
    for (let tick = 100; tick < 300; tick += 1) {
      fx.update(tick, () => null, []);
      expect(fx.flightCount).toBe(1);
      // Each lives BOLT_TICKS + 1 ticks: count the new ones.
      sparks += fx.boltCount;
    }
    // About 200 / 4 sparks, each seen on BOLT_TICKS + 1 ticks.
    const thrown = sparks / (BOLT_TICKS + 1);
    expect(thrown).toBeGreaterThan(30);
    expect(thrown).toBeLessThan(75);
    fx.update(300, () => null, []);
    expect(fx.flightCount).toBe(0);
    fx.destroy();
  });

  it("with Flash's lightning asked for, sparks round a zombie's feet on about a tenth of its loops, none with reduced motion", () => {
    const zombie = { id: 9, ground: { x: 50, y: 50 } };
    const count = (reduced: boolean): number => {
      const fx = fxOf({ classic: false, reducedMotion: reduced, lightning: true });
      let shown = 0;
      for (let tick = 0; tick < 800; tick += 1) {
        fx.update(tick, () => null, [zombie]);
        shown += fx.boltCount;
      }
      fx.destroy();
      return shown / (BOLT_TICKS + 1);
    };
    const thrown = count(false);
    expect(thrown).toBeGreaterThan(50);
    expect(thrown).toBeLessThan(115);
    expect(count(true)).toBe(0);
  });
});
