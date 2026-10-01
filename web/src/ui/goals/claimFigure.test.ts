import { describe, expect, it } from "vitest";
import { claimFigure } from "./claimFigure";

const CAPS = { r1: 10_000, r2: 10_000, r3: 10_000, r4: 10_000 };

describe("claimFigure (#227, Q2)", () => {
  it("pays the whole reward when it fits", () => {
    expect(claimFigure({ r1: 2000, r2: 2000, r3: 0, r4: 0 }, { r1: 1000, r2: 1000 }, CAPS)).toEqual({
      credited: { r1: 2000, r2: 2000, r3: 0, r4: 0 },
      capped: false,
    });
  });

  it("fills up to the cap and says the rest is lost", () => {
    expect(claimFigure({ r1: 2000, r2: 2000, r3: 0, r4: 0 }, { r1: 9000, r2: 10_000 }, CAPS)).toEqual({
      credited: { r1: 1000, r2: 0, r3: 0, r4: 0 },
      capped: true,
    });
  });

  it("a pool already over the cap takes nothing and loses nothing", () => {
    expect(claimFigure({ r1: 500, r2: 0, r3: 0, r4: 0 }, { r1: 12_000 }, CAPS).credited.r1).toBe(0);
  });

  it("no caps yet counts as no cap", () => {
    expect(claimFigure({ r1: 500, r2: 0, r3: 0, r4: 0 }, { r1: 99_999 }, null)).toEqual({
      credited: { r1: 500, r2: 0, r3: 0, r4: 0 },
      capped: false,
    });
  });
});
