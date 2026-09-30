import { describe, expect, it } from "vitest";
import { EDGE_BAND, EDGE_SPEED, edgeScroll, TAP_SLOP, TWO_FINGER_TAP_MS, TwoFingerTap } from "./touchGestures";

describe("TwoFingerTap", () => {
  it("fires when two fingers land and lift together", () => {
    const tap = new TwoFingerTap();
    tap.down(1, 100, 100, 0);
    tap.down(2, 200, 100, 30);
    expect(tap.up(2, 120)).toBe(false);
    expect(tap.up(1, 150)).toBe(true);
  });

  it("does not fire for one finger, or three", () => {
    const one = new TwoFingerTap();
    one.down(1, 0, 0, 0);
    expect(one.up(1, 50)).toBe(false);

    const three = new TwoFingerTap();
    three.down(1, 0, 0, 0);
    three.down(2, 50, 0, 10);
    three.down(3, 100, 0, 20);
    three.up(3, 60);
    three.up(2, 70);
    expect(three.up(1, 80)).toBe(false);
  });

  it("does not fire for a pinch, however quick", () => {
    const tap = new TwoFingerTap();
    tap.down(1, 100, 100, 0);
    tap.down(2, 200, 100, 10);
    tap.move(2, 200 + TAP_SLOP + 1, 100);
    tap.up(2, 100);
    expect(tap.up(1, 110)).toBe(false);
  });

  it("does not fire for a slow hold", () => {
    const tap = new TwoFingerTap();
    tap.down(1, 100, 100, 0);
    tap.down(2, 200, 100, 10);
    tap.up(2, TWO_FINGER_TAP_MS);
    expect(tap.up(1, TWO_FINGER_TAP_MS + 1)).toBe(false);
  });

  it("does not fire when the browser cancels a finger, and starts clean after", () => {
    const tap = new TwoFingerTap();
    tap.down(1, 0, 0, 0);
    tap.down(2, 50, 0, 10);
    tap.cancel(2);
    expect(tap.up(1, 60)).toBe(false);

    tap.down(1, 0, 0, 1000);
    tap.down(2, 50, 0, 1010);
    tap.up(1, 1100);
    expect(tap.up(2, 1120)).toBe(true);
  });

  it("ignores a lift it never saw land", () => {
    const tap = new TwoFingerTap();
    expect(tap.up(7, 0)).toBe(false);
  });
});

describe("edgeScroll", () => {
  const area = { left: 0, top: 60, right: 400, bottom: 800 };

  it("is still in the middle", () => {
    expect(edgeScroll({ x: 200, y: 400 }, area)).toEqual({ dx: 0, dy: 0 });
  });

  it("moves the view towards the edge the finger is near, fastest at the edge", () => {
    expect(edgeScroll({ x: 400, y: 400 }, area)).toEqual({ dx: EDGE_SPEED, dy: 0 });
    expect(edgeScroll({ x: 0, y: 400 }, area)).toEqual({ dx: -EDGE_SPEED, dy: 0 });
    // The top edge is the bar's, not the screen's.
    expect(edgeScroll({ x: 200, y: 60 }, area)).toEqual({ dx: 0, dy: -EDGE_SPEED });
    expect(edgeScroll({ x: 200, y: 800 }, area)).toEqual({ dx: 0, dy: EDGE_SPEED });
  });

  it("speeds up smoothly across the band", () => {
    const half = edgeScroll({ x: 400 - EDGE_BAND / 2, y: 400 }, area);
    expect(half.dx).toBeCloseTo(EDGE_SPEED / 2);
    expect(edgeScroll({ x: 400 - EDGE_BAND, y: 400 }, area).dx).toBe(0);
  });

  it("scrolls on both axes in a corner", () => {
    const corner = edgeScroll({ x: 400, y: 800 }, area);
    expect(corner).toEqual({ dx: EDGE_SPEED, dy: EDGE_SPEED });
  });

  it("keeps still along a side too short for two bands", () => {
    expect(edgeScroll({ x: 0, y: 0 }, { left: 0, top: 0, right: 0, bottom: 0 })).toEqual({ dx: 0, dy: 0 });
  });
});
