import { describe, expect, it } from "vitest";
import { deadRuns } from "./DeadZoneLayer";

/** The dead-zone hatching draws one shape per uncovered run along a row (#55). */

describe("deadRuns", () => {
  it("splits each row where a covered cell interrupts it", () => {
    // 5 x 2: row 0 is . X . . X, row 1 all uncovered.
    const mask = new Uint8Array([0, 1, 0, 0, 1, 0, 0, 0, 0, 0]);
    expect(deadRuns(mask, 5, 2)).toEqual([
      [0, 0, 0],
      [0, 2, 3],
      [1, 0, 4],
    ]);
  });

  it("draws nothing for a fully covered mask", () => {
    expect(deadRuns(new Uint8Array([1, 1, 1, 1]), 2, 2)).toEqual([]);
  });
});
