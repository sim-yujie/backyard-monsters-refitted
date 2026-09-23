import { describe, expect, it } from "vitest";
import {
  clipRect,
  cornersBounds,
  fitWorld,
  fractionToZoom,
  projectPoint,
  projectRect,
  sameZoom,
  unprojectPoint,
  zoomPercent,
  zoomToFraction,
} from "./minimap";

/**
 * The arithmetic under F15.
 *
 * Two worlds go through this: the isometric yard, which is roughly twice as
 * wide as it is tall, and the blueprint's 3400 by 2760 box. Both are fitted
 * into the same landscape frame, so the tests use one of each rather than a
 * convenient square, which would hide an axis swap.
 */

const BOX_WIDTH = 176;
const BOX_HEIGHT = 128;

describe("fitWorld", () => {
  it("uses one scale for both axes so the shape is preserved", () => {
    const fit = fitWorld({ width: 4000, height: 2000 }, BOX_WIDTH, BOX_HEIGHT);
    expect(fit.scale).toBeCloseTo(176 / 4000);
    expect(fit.width).toBeCloseTo(176);
    expect(fit.height).toBeCloseTo(88);
  });

  it("centres the letterboxing", () => {
    const fit = fitWorld({ width: 4000, height: 2000 }, BOX_WIDTH, BOX_HEIGHT);
    expect(fit.offsetX).toBeCloseTo(0);
    expect(fit.offsetY).toBeCloseTo((128 - 88) / 2);
  });

  it("fits a tall world against the box's height", () => {
    const fit = fitWorld({ width: 100, height: 400 }, BOX_WIDTH, BOX_HEIGHT);
    expect(fit.scale).toBeCloseTo(128 / 400);
    expect(fit.height).toBeCloseTo(128);
    expect(fit.offsetX).toBeCloseTo((176 - 32) / 2);
  });

  it("survives a world with no size rather than dividing by zero", () => {
    const fit = fitWorld({ width: 0, height: 0 }, BOX_WIDTH, BOX_HEIGHT);
    expect(Number.isFinite(fit.scale)).toBe(true);
    expect(fit.scale).toBeGreaterThan(0);
  });
});

describe("projection", () => {
  const fit = fitWorld({ width: 3400, height: 2760 }, BOX_WIDTH, BOX_HEIGHT);

  it("puts the world's origin at the top-left of the drawn area", () => {
    expect(projectPoint(fit, 0, 0)).toEqual({ x: fit.offsetX, y: fit.offsetY });
  });

  it("puts the far corner at the bottom-right of the drawn area", () => {
    const corner = projectPoint(fit, 3400, 2760);
    expect(corner.x).toBeCloseTo(fit.offsetX + fit.width);
    expect(corner.y).toBeCloseTo(fit.offsetY + fit.height);
  });

  it("round-trips a point through unproject", () => {
    const back = unprojectPoint(fit, ...pointArgs(projectPoint(fit, 1234, 567)));
    expect(back.x).toBeCloseTo(1234);
    expect(back.y).toBeCloseTo(567);
  });

  it("scales a rectangle's size as well as its corner", () => {
    const rect = projectRect(fit, { x: 100, y: 200, width: 340, height: 276 });
    expect(rect.width).toBeCloseTo(340 * fit.scale);
    expect(rect.height).toBeCloseTo(276 * fit.scale);
  });
});

describe("cornersBounds", () => {
  it("boxes an isometric diamond", () => {
    // diamondCorners for a 2 by 2 footprint at the origin.
    const bounds = cornersBounds([
      [0, 0],
      [2, 1],
      [0, 2],
      [-2, 1],
    ]);
    expect(bounds).toEqual({ x: -2, y: 0, width: 4, height: 2 });
  });

  it("boxes a blueprint tile to itself", () => {
    const bounds = cornersBounds([
      [10, 20],
      [40, 20],
      [40, 50],
      [10, 50],
    ]);
    expect(bounds).toEqual({ x: 10, y: 20, width: 30, height: 30 });
  });

  it("answers null for no corners", () => {
    expect(cornersBounds([])).toBeNull();
  });
});

describe("clipRect", () => {
  const box = { x: 0, y: 0, width: 176, height: 128 };

  it("leaves a rectangle already inside alone", () => {
    const rect = { x: 10, y: 10, width: 20, height: 20 };
    expect(clipRect(rect, box)).toEqual(rect);
  });

  it("trims a viewport larger than the world on both axes", () => {
    expect(clipRect({ x: -50, y: -40, width: 400, height: 300 }, box)).toEqual(box);
  });

  it("trims one edge only", () => {
    expect(clipRect({ x: 150, y: 10, width: 100, height: 20 }, box)).toEqual({
      x: 150,
      y: 10,
      width: 26,
      height: 20,
    });
  });

  it("answers null when the two do not meet", () => {
    expect(clipRect({ x: 200, y: 10, width: 20, height: 20 }, box)).toBeNull();
    expect(clipRect({ x: 10, y: -40, width: 20, height: 20 }, box)).toBeNull();
  });
});

describe("the zoom slider's curve", () => {
  const MIN = 0.08;
  const MAX = 2.5;

  it("pins the two ends", () => {
    expect(zoomToFraction(MIN, MIN, MAX)).toBeCloseTo(0);
    expect(zoomToFraction(MAX, MIN, MAX)).toBeCloseTo(1);
  });

  it("round-trips every position", () => {
    for (const fraction of [0, 0.13, 0.5, 0.77, 1]) {
      expect(zoomToFraction(fractionToZoom(fraction, MIN, MAX), MIN, MAX)).toBeCloseTo(fraction);
    }
  });

  it("puts the geometric middle at the halfway mark, not the arithmetic one", () => {
    const middle = fractionToZoom(0.5, MIN, MAX);
    expect(middle).toBeCloseTo(Math.sqrt(MIN * MAX));
    expect(middle).toBeLessThan((MIN + MAX) / 2);
  });

  it("gives equal travel to equal multiples, which is what a wheel notch is", () => {
    const a = zoomToFraction(0.2, MIN, MAX) - zoomToFraction(0.1, MIN, MAX);
    const b = zoomToFraction(0.8, MIN, MAX) - zoomToFraction(0.4, MIN, MAX);
    expect(a).toBeCloseTo(b);
  });

  it("clamps rather than running off either end", () => {
    expect(zoomToFraction(0.001, MIN, MAX)).toBe(0);
    expect(zoomToFraction(99, MIN, MAX)).toBe(1);
    expect(fractionToZoom(-1, MIN, MAX)).toBeCloseTo(MIN);
    expect(fractionToZoom(2, MIN, MAX)).toBeCloseTo(MAX);
  });

  it("collapses to the floor when the range is empty or impossible", () => {
    expect(zoomToFraction(1, 0, 2.5)).toBe(0);
    expect(zoomToFraction(1, 2.5, 2.5)).toBe(0);
    expect(fractionToZoom(0.5, 2.5, 2.5)).toBe(2.5);
  });
});

describe("zoomPercent", () => {
  it("reads 100 at native size", () => {
    expect(zoomPercent(1)).toBe(100);
  });

  it("rounds to whole percents in the working range", () => {
    expect(zoomPercent(0.8712)).toBe(87);
    expect(zoomPercent(2.5)).toBe(250);
  });

  it("keeps a decimal below 10 percent, where a whole number would read 0", () => {
    expect(zoomPercent(0.064)).toBe(6.4);
  });
});

describe("sameZoom", () => {
  it("ignores a round trip's floating-point dust", () => {
    expect(sameZoom(0.3, 0.1 + 0.2)).toBe(true);
  });

  it("does not ignore a real change", () => {
    expect(sameZoom(0.3, 0.3001)).toBe(false);
  });
});

const pointArgs = (point: { x: number; y: number }): [number, number] => [point.x, point.y];
