import { describe, expect, it } from "vitest";
import { panClearOfPanel, type KeepClearInput } from "./keepClear";

/** A selected cell kept out from under its own cell panel (issue #153). */

const phone = (y: number): KeepClearInput => ({
  point: { x: 265, y },
  halfWidth: 38,
  halfHeight: 19,
  // The bottom sheet: the whole width, from 684 down (a 390 x 844 phone).
  panel: { left: 0, top: 684, right: 390, bottom: 844 },
  viewportWidth: 390,
  hudBottom: 90,
});

const desktop = (x: number): KeepClearInput => ({
  point: { x, y: 200 },
  halfWidth: 75,
  halfHeight: 37,
  // The side panel on the right of a 1440 x 900 screen.
  panel: { left: 1052, top: 80, right: 1424, bottom: 430 },
  viewportWidth: 1440,
  hudBottom: 64,
});

describe("panClearOfPanel", () => {
  it("leaves a cell the panel does not cover where it is", () => {
    expect(panClearOfPanel(phone(400))).toBeNull();
    expect(panClearOfPanel(desktop(600))).toBeNull();
  });

  it("lifts a cell under the phone's sheet into the band between the HUD and the sheet", () => {
    const pan = panClearOfPanel(phone(760))!;
    expect(pan.dx).toBe(0);
    // The band runs from 90 to 684: its middle is 387.
    expect(760 + pan.dy).toBe(387);
  });

  it("counts a cell only partly under the sheet as covered", () => {
    expect(panClearOfPanel(phone(684 - 10))).not.toBeNull();
    expect(panClearOfPanel(phone(684 - 25))).toBeNull();
  });

  it("moves a cell under the side panel left of it, not up", () => {
    const pan = panClearOfPanel(desktop(1200))!;
    expect(pan.dy).toBe(0);
    expect(1200 + pan.dx).toBe(526);
  });
});
