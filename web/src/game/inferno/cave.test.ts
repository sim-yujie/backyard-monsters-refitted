import { describe, expect, it } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import type { InfernoLoadState } from "@/api/inferno";
import { YARD_MARGIN, YARD_SIZES, yardBounds, yardToWorld } from "@/game/yard/YardGrid";
import {
  CAVE_FOOTPRINT,
  CAVE_SPOT,
  caveCentre,
  caveState,
  caveTap,
  caveYardMargin,
  shakeOffset,
} from "./cave";
import { CAVERN_NOTES, ENTER_CAVERN_FAIL } from "./emergenceText";

/** Moloch's cave on the main yard (Inferno WP 1.10): where it stands and what a tap on it does. */

const loadState = (shown: boolean, level = 1): InfernoLoadState => ({
  now: 1_000,
  cave: { shown, level, maxLevel: 5 },
  emergence: { lastAt: null, nextAt: 0, done: false },
  descent: { level: 0, destroyed: [], passed: false },
  hasYard: false,
  korathNotice: false,
  raised: null,
});

describe("where the cave stands", () => {
  it.each([0, 3, YARD_SIZES.length - 1])("grows the grass at expansion %i to hold the cave's biggest art", (level) => {
    const margin = caveYardMargin(level);
    expect(margin).toBeGreaterThanOrEqual(YARD_MARGIN);
    const bounds = yardBounds(level, { margin });
    const origin = yardToWorld(bounds, CAVE_SPOT.x, CAVE_SPOT.y);
    // Level 5's shadow reaches 169 px left of the origin and its top 172 px above.
    expect(origin.x - 169).toBeGreaterThanOrEqual(0);
    expect(origin.y - 172).toBeGreaterThanOrEqual(0);
  });

  it("needs less extra grass on a bigger plot, which already reaches towards the cave", () => {
    expect(caveYardMargin(6)).toBeLessThan(caveYardMargin(0));
  });

  it("looks at the middle of the cave's footprint", () => {
    expect(caveCentre()).toEqual({
      x: CAVE_SPOT.x + CAVE_FOOTPRINT.width / 2,
      y: CAVE_SPOT.y + CAVE_FOOTPRINT.height / 2,
    });
  });
});

describe("whether the cave shows", () => {
  it("shows only when the load sent the Inferno state with the cave shown", () => {
    expect(caveState({})).toBeNull();
    expect(caveState({ infernostate: loadState(false) } as Pick<BaseLoadResponse, "infernostate">)).toBeNull();
    const shown = loadState(true, 2);
    expect(caveState({ infernostate: shown } as Pick<BaseLoadResponse, "infernostate">)).toBe(shown);
  });
});

describe("a tap on the cave", () => {
  it("opens the menu at level 5 with the hall at 5, even while a raid runs", () => {
    expect(caveTap(5, 5, false)).toEqual({ kind: "menu" });
    expect(caveTap(5, 7, true)).toEqual({ kind: "menu" });
  });

  it("gives the note for each level below 5, with Upgrade Now only below hall 5", () => {
    for (let level = 1; level <= 4; level++) {
      expect(caveTap(level, 5, false)).toEqual({ kind: "note", text: CAVERN_NOTES[level - 1], upgrade: false });
    }
    expect(caveTap(2, 4, false)).toEqual({ kind: "note", text: CAVERN_NOTES[1], upgrade: true });
  });

  it("gives the first note for a cave not yet raised", () => {
    expect(caveTap(0, 5, false)).toEqual({ kind: "note", text: CAVERN_NOTES[0], upgrade: false });
  });

  it("turns away an open cave while the hall is below 5", () => {
    expect(caveTap(5, 4, false)).toEqual({ kind: "note", text: ENTER_CAVERN_FAIL, upgrade: true });
  });

  it("does nothing below level 5 while Moloch's raid is under way", () => {
    expect(caveTap(3, 5, true)).toEqual({ kind: "none" });
    expect(caveTap(5, 4, true)).toEqual({ kind: "none" });
  });
});

describe("the earthquake's shake", () => {
  it("jolts up to a tenth of the frames left either way", () => {
    expect(shakeOffset(100, () => 0)).toEqual({ x: 10, y: 10 });
    expect(shakeOffset(100, () => 0.5)).toEqual({ x: 0, y: 0 });
    expect(shakeOffset(100, () => 0.999)).toEqual({ x: -9, y: -9 });
  });

  it("dies away as the frames run out", () => {
    for (let frames = 100; frames > 0; frames -= 7) {
      const { x, y } = shakeOffset(frames, Math.random);
      expect(Math.abs(x)).toBeLessThanOrEqual(frames / 10);
      expect(Math.abs(y)).toBeLessThanOrEqual(frames / 10);
    }
    expect(shakeOffset(5, () => 0)).toEqual({ x: 0, y: 0 });
  });

  it("stands still once it is over", () => {
    expect(shakeOffset(0, () => 0)).toEqual({ x: 0, y: 0 });
    expect(shakeOffset(-3, () => 0)).toEqual({ x: 0, y: 0 });
  });
});
