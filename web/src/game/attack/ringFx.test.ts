import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import { RingFx } from "./ringFx";

/**
 * The ground rings (fix/bandito-lag): a crowd of Banditos swinging at once
 * used to make a fresh drawing per ring, triangulated and given its own
 * buffers each time. Now one drawing per size and colour is shared and the
 * rings are pooled.
 */
describe("ground rings, shared and pooled (fix/bandito-lag)", () => {
  it("sixty rings of one size share one drawing", () => {
    const parent = new Container();
    const fx = new RingFx(parent);
    const rings = Array.from({ length: 60 }, (_, index) => fx.take({ x: index, y: 0 }, 40, 0xe8d44d));
    expect(fx.shapeCount).toBe(1);
    expect(new Set(rings.map((ring) => ring.context)).size).toBe(1);
    expect(parent.children.length).toBe(60);
    expect(rings[5]?.position.x).toBe(5);
  });

  it("the drawing is the three rings it always was", () => {
    const fx = new RingFx(new Container());
    const ring = fx.take({ x: 0, y: 0 }, 40, 0xe8d44d);
    const bounds = ring.context.bounds;
    // The outer ellipse, 40 by 20, plus half the 2 px line.
    expect(bounds.width).toBeCloseTo(82, 0);
    expect(bounds.height).toBeCloseTo(42, 0);
    const strokes = ring.context.instructions.filter((step) => step.action === "stroke");
    expect(strokes).toHaveLength(1);
  });

  it("a ring given back is used again, with no new object or drawing", () => {
    const parent = new Container();
    const fx = new RingFx(parent);
    const first = Array.from({ length: 60 }, () => fx.take({ x: 0, y: 0 }, 40, 0xe8d44d));
    for (const ring of first) {
      ring.alpha = 0.2;
      ring.scale.set(1.4);
      fx.release(ring);
    }
    expect(parent.children.length).toBe(0);
    const second = Array.from({ length: 60 }, () => fx.take({ x: 3, y: 4 }, 40, 0xe8d44d));
    expect(fx.madeCount).toBe(60);
    expect(fx.shapeCount).toBe(1);
    expect(new Set([...first, ...second]).size).toBe(60);
    // Taken fresh: full alpha, its own size, on top of the parent.
    expect(second.every((ring) => ring.alpha === 1 && ring.scale.x === 1)).toBe(true);
    expect(parent.children.length).toBe(60);
  });

  it("another size or colour gets its own drawing, once", () => {
    const fx = new RingFx(new Container());
    const blink = fx.take({ x: 0, y: 0 }, 16, 0x9fd4ff);
    fx.release(blink);
    const quake = fx.take({ x: 0, y: 0 }, 40, 0xf28500);
    fx.take({ x: 0, y: 0 }, 40, 0xf28500);
    // The pooled blink ring now draws the quake's rings.
    expect(quake).toBe(blink);
    expect(fx.shapeCount).toBe(2);
    expect(fx.madeCount).toBe(2);
  });
});
