import { describe, expect, it } from "vitest";
import { Container, Texture, TextureSource } from "pixi.js";
import {
  BOLT_TICKS,
  ORB_GLOW_ALPHA,
  ORB_HALF,
  ORB_ORBIT_PX,
  ORB_URL_CLASSIC,
  ORB_URL_MODERN,
  RISE_DROP_PX,
  RISE_TICKS,
  RaiseFx,
  ZOMBIE_FADE_TICKS,
  lightningPath,
  orbCentre,
  orbGlowAlpha,
  orbOrbit,
  orbProgress,
  raiseJitter,
  riseDrop,
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

describe("RaiseFx", () => {
  const picture = (): Promise<Texture> =>
    Promise.resolve(
      new Texture({ source: new TextureSource({ width: 40, height: 40, resolution: 2 }) }),
    );

  it("loads the look's own orb", () => {
    const asked: string[] = [];
    for (const classic of [true, false]) {
      const fx = new RaiseFx(
        () => new Container(),
        classic,
        false,
        (url) => {
          asked.push(url);
          return picture();
        },
      );
      fx.preload();
    }
    expect(asked).toEqual([ORB_URL_CLASSIC, ORB_URL_MODERN]);
    expect(ORB_URL_CLASSIC).toContain("rezghul_projectile");
    expect(ORB_URL_CLASSIC).not.toContain("fireball");
  });

  it("flies an orb until it lands, sparking about a quarter of its loops", async () => {
    const layer = new Container();
    const fx = new RaiseFx(() => layer, true, false, picture);
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

  it("sparks round a zombie's feet on about a tenth of its loops, none with reduced motion", () => {
    const zombie = { id: 9, ground: { x: 50, y: 50 } };
    const count = (reduced: boolean): number => {
      const fx = new RaiseFx(() => new Container(), false, reduced, picture);
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
