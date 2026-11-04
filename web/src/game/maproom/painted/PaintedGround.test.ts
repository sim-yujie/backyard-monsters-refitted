import { DOMAdapter } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { ZoneRecord } from "../ZoneStore";
import { GroundData } from "./GroundData";
import { Ground } from "./groundKinds";
import { WATER_STEP_TICKS, groundProgram, waterTime, withFoamAlpha } from "./PaintedGround";

// GlProgram reads the GPU's float precision from a test canvas; these tests run without a DOM.
DOMAdapter.set({ ...DOMAdapter.get(), createCanvas: () => ({ getContext: () => null }) as unknown as HTMLCanvasElement });

describe("painted ground data texture", () => {
  it("starts as fog and takes each zone's cells", () => {
    const data = new GroundData(20, 20);
    expect(data.groundAt(3, 4)).toBe(Ground.FOG);
    const zone = {
      id: 0,
      data: { "3": { "4": { i: 105 }, "5": { i: 130 } }, "30": { "1": { i: 130 } } },
      fetchedAt: 0,
    } as unknown as ZoneRecord;
    data.applyZone(zone);
    expect(data.groundAt(3, 4)).toBe(Ground.MEADOW_PLAIN);
    expect(data.groundAt(3, 5)).toBe(Ground.MEADOW);
    data.reset();
    expect(data.groundAt(3, 4)).toBe(Ground.FOG);
    data.destroy();
  });
});

describe("painted water clock", () => {
  it("steps 10 times a second on High, 5 on Medium, and stays still on Low", () => {
    expect(WATER_STEP_TICKS).toEqual({ high: 3, medium: 6, low: null });
    expect(waterTime(1000, 1000, "high")).toBe(0);
    expect(waterTime(1000 + 1000, 1000, "high")).toBeCloseTo(1);
    expect(waterTime(1000 + 90, 1000, "high")).toBe(0);
    expect(waterTime(1000 + 100, 1000, "high")).toBeCloseTo(0.1);
    expect(waterTime(1000 + 170, 1000, "medium")).toBe(0);
    expect(waterTime(1000 + 200, 1000, "medium")).toBeCloseTo(0.2);
    expect(waterTime(99999, 1000, "low")).toBe(0);
  });

  it("runs only while water is in sight", () => {
    const data = new GroundData(40, 40);
    const range = { minCol: 0, maxCol: 9, minRow: 0, maxRow: 9 };
    expect(data.hasWater(range)).toBe(false);
    data.applyZone({ id: 0, data: { "5": { "5": { i: 130 } } }, fetchedAt: 0 } as unknown as ZoneRecord);
    expect(data.hasWater(range)).toBe(false);
    data.applyZone({ id: 0, data: { "7": { "2": { i: 60 } } }, fetchedAt: 0 } as unknown as ZoneRecord);
    expect(data.hasWater(range)).toBe(true);
    expect(data.hasWater({ minCol: 20, maxCol: 30, minRow: 20, maxRow: 30 })).toBe(false);
    expect(data.hasWater({ minCol: -50, maxCol: -10, minRow: 0, maxRow: 5 })).toBe(false);
    data.destroy();
  });
});

describe("painted ground programs and textures (plan step 10)", () => {
  it("puts the foam's brightness in the wet sand's alpha, keeping the sand's colour", () => {
    const wet = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
    const foam = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
    expect(Array.from(withFoamAlpha(wet, foam))).toEqual([10, 20, 30, 255, 40, 50, 60, 0]);
    // Luma weights: a pure green foam pixel is 59% bright.
    expect(withFoamAlpha(new Uint8ClampedArray(4), new Uint8ClampedArray([0, 255, 0, 255]))[3]).toBe(150);
  });

  it("has one program per Quality, the level fixed in its source, each built once", () => {
    const levels = ["low", "medium", "high"] as const;
    const programs = levels.map((level) => groundProgram(level));
    expect(new Set(programs).size).toBe(3);
    levels.forEach((level, index) => expect(groundProgram(level)).toBe(programs[index]));
    expect(programs[0]!.fragment).toContain("const float uQuality = 0.0;");
    expect(programs[1]!.fragment).toContain("const float uQuality = 1.0;");
    expect(programs[2]!.fragment).toContain("const float uQuality = 2.0;");
    for (const program of programs) expect(program.fragment).not.toContain("uniform float uQuality");
  });
});
