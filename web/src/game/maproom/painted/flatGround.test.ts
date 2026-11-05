import { afterEach, describe, expect, it } from "vitest";
import type { MapCell } from "@/api/types";
import { cellLift, groundLift, setFlatGround } from "../ground";

describe("painted look switch off = today's map", () => {
  afterEach(() => setFlatGround(false));

  it("off: cells rise and sink to their height exactly as today", () => {
    for (const height of [40, 99, 100, 150, 220]) {
      expect(cellLift({ i: height } as unknown as MapCell)).toBe(groundLift(height));
    }
  });

  it("on: the painted ground is flat, so nothing is lifted", () => {
    setFlatGround(true);
    expect(cellLift({ i: 220 } as unknown as MapCell)).toBe(0);
    expect(cellLift({ i: 40 } as unknown as MapCell)).toBe(0);
  });
});
