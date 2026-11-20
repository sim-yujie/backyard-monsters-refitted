import { describe, expect, it } from "vitest";
import { inHandMarks } from "./inHand";

const NONE: ReadonlySet<number> = new Set();
const base = { placing: null, carrying: false, dragging: false, faulted: NONE };

/** Desk fix B (owner, 19 Nov 2026): what is in hand is boxed green or red, like the yard's placing box. */
describe("inHandMarks", () => {
  it("marks nothing in hand when nothing is carried, picked up or dragged", () => {
    const marks = inHandMarks(base);
    expect(marks.inHand).toBe(false);
    expect(marks.invalid).toBe(NONE);
  });

  it("boxes a building out of Stored green on a free spot", () => {
    const marks = inHandMarks({ ...base, placing: { id: 7, ok: true } });
    expect(marks.inHand).toBe(true);
    expect(marks.invalid.has(7)).toBe(false);
  });

  it("turns a building out of Stored red half on another, with the one in the way", () => {
    const marks = inHandMarks({ ...base, placing: { id: 7, ok: false }, faulted: new Set([31]) });
    expect([...marks.invalid].sort()).toEqual([31, 7]);
  });

  it("turns a building out of Stored red off the plot, where nothing is in the way", () => {
    const marks = inHandMarks({ ...base, placing: { id: 7, ok: false } });
    expect([...marks.invalid]).toEqual([7]);
  });

  it("boxes a picked-up or dragged selection, keeping the move's own faults", () => {
    const faulted = new Set([36, 31]);
    expect(inHandMarks({ ...base, carrying: true, faulted })).toEqual({ inHand: true, invalid: faulted });
    expect(inHandMarks({ ...base, dragging: true, faulted })).toEqual({ inHand: true, invalid: faulted });
  });
});
