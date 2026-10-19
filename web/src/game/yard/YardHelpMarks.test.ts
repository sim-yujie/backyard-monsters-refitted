import { describe, expect, it } from "vitest";
import { jobBarScale } from "./YardJobBars";
import { YardHelpMarks } from "./YardHelpMarks";

/** The wrenches over a friend's yard (#374): one per helpable building, and a tap on one picks it. */

const anchor = (id: number) => (id === 99 ? null : { x: id * 100, y: 50 });

describe("YardHelpMarks", () => {
  it("draws one badge per building, none for a building with no anchor", () => {
    const marks = new YardHelpMarks(anchor);
    marks.set(new Set([1, 2, 99]));
    expect(marks.drawn).toEqual([1, 2, 99]);
    expect(marks.root.children.filter((badge) => badge.visible)).toHaveLength(2);
    marks.set(new Set());
    expect(marks.active).toBe(false);
  });

  it("picks the building whose wrench is tapped, at any zoom", () => {
    const marks = new YardHelpMarks(anchor);
    marks.set(new Set([1, 2, 99]));
    // The disc's centre sits 20 world px over the anchor at zoom 1.
    expect(marks.pick(100, 30)).toBe(1);
    expect(marks.pick(212, 30)).toBe(2);
    expect(marks.pick(100, 50 + 5)).toBeNull();
    expect(marks.pick(9900, 30)).toBeNull();

    marks.setZoom(0.5);
    const scale = jobBarScale(0.5);
    expect(marks.pick(100, 50 - 20 * scale)).toBe(1);
    expect(marks.pick(100 + 13 * scale, 50 - 20 * scale)).toBe(1);
    expect(marks.pick(100 + 15 * scale, 50 - 20 * scale)).toBeNull();
  });
});
