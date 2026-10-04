import { describe, expect, it } from "vitest";
import { Text } from "pixi.js";
import { jobBarScale } from "./YardJobBars";
import { sameMarks, YardHatchMarks, type HatcheryMarks } from "./YardHatchMarks";

/**
 * The hatchery numbers over the yard while the Hatch tab is open (#268, B):
 * one badge per hatchery with the tab's number, the chosen one marked, over
 * its anchor, and nothing once the tab hands over null.
 */

const marksOf = (
  chosen: number | null,
  numbers: [number, number][] = [
    [10, 1],
    [11, 2],
    [12, 3],
  ],
): HatcheryMarks => ({
  numbers: new Map(numbers),
  chosen,
});

const anchor = (id: number) => (id === 99 ? null : { x: id * 100, y: -id });

describe("sameMarks", () => {
  it("compares the numbers and the chosen one, not the objects", () => {
    expect(sameMarks(marksOf(11), marksOf(11))).toBe(true);
    expect(sameMarks(marksOf(11), marksOf(12))).toBe(false);
    expect(
      sameMarks(
        marksOf(11),
        marksOf(11, [
          [10, 1],
          [11, 2],
        ]),
      ),
    ).toBe(false);
    expect(
      sameMarks(
        marksOf(11),
        marksOf(11, [
          [10, 1],
          [11, 2],
          [12, 4],
        ]),
      ),
    ).toBe(false);
    expect(sameMarks(null, null)).toBe(true);
    expect(sameMarks(marksOf(11), null)).toBe(false);
  });
});

describe("YardHatchMarks", () => {
  it("draws one numbered badge per hatchery over its anchor, the chosen one on top", () => {
    const layer = new YardHatchMarks(anchor);
    expect(layer.set(marksOf(11))).toBe(true);
    expect(layer.drawn).toEqual([
      { id: 10, number: 1, chosen: false },
      { id: 12, number: 3, chosen: false },
      { id: 11, number: 2, chosen: true },
    ]);
    const top = layer.root.children.at(-1)!;
    expect(top.position.x).toBe(1100);
    expect(top.position.y).toBe(-11);
    expect(top.children.find((child): child is Text => child instanceof Text)?.text).toBe("2");
  });

  it("redraws only on a change, and clears with null", () => {
    const layer = new YardHatchMarks(anchor);
    layer.set(marksOf(11));
    expect(layer.set(marksOf(11))).toBe(false);
    expect(layer.set(marksOf(12))).toBe(true);
    expect(layer.drawn.at(-1)).toEqual({ id: 12, number: 3, chosen: true });
    expect(layer.set(null)).toBe(true);
    expect(layer.current).toBeNull();
    expect(layer.root.children).toHaveLength(0);
  });

  it("hides the badge of a hatchery that is not drawn, and grows with the zoom as the job bars do", () => {
    const layer = new YardHatchMarks(anchor);
    layer.set(
      marksOf(10, [
        [10, 1],
        [99, 2],
      ]),
    );
    // The chosen one is drawn last.
    const [hidden, shown] = layer.root.children;
    expect(shown!.visible).toBe(true);
    expect(hidden!.visible).toBe(false);
    layer.setZoom(0.5);
    expect(shown!.scale.x).toBe(jobBarScale(0.5));
  });
});
