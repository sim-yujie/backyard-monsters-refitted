import { describe, expect, it, vi } from "vitest";
import type { ZoneRecord } from "../ZoneStore";
import { GroundData } from "./GroundData";
import { Ground } from "./groundKinds";
import { WATER_STEP_MS, groundShaderCompiles, waterTime } from "./PaintedGround";

/** A stand-in WebGL2 context that compiles (or refuses) every shader. */
const fakeGl = (compiles: boolean, links = true) => {
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => compiles),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => links),
    deleteProgram: vi.fn(),
    deleteShader: vi.fn(),
    getExtension: vi.fn(() => null),
  };
  return gl as unknown as WebGL2RenderingContext;
};

describe("painted ground fallback", () => {
  it("runs only where the shader compiles and links; otherwise the map keeps its tiles", () => {
    expect(groundShaderCompiles(fakeGl(true))).toBe(true);
    expect(groundShaderCompiles(fakeGl(false))).toBe(false);
    expect(groundShaderCompiles(fakeGl(true, false))).toBe(false);
    expect(groundShaderCompiles(null)).toBe(false);
  });
});

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
    expect(data.groundAt(3, 4)).toBe(Ground.SAND);
    expect(data.groundAt(3, 5)).toBe(Ground.MEADOW);
    data.reset();
    expect(data.groundAt(3, 4)).toBe(Ground.FOG);
    data.destroy();
  });
});

describe("painted water clock", () => {
  it("steps 12 times a second on High, 6 on Medium, and stays still on Low", () => {
    expect(waterTime(1000, 1000, "high")).toBe(0);
    expect(waterTime(1000 + 1000, 1000, "high")).toBeCloseTo(1);
    expect(waterTime(1000 + 50, 1000, "high")).toBe(0);
    expect(waterTime(1000 + 90, 1000, "high")).toBeCloseTo(WATER_STEP_MS.high! / 1000);
    expect(waterTime(1000 + 90, 1000, "medium")).toBe(0);
    expect(waterTime(1000 + 170, 1000, "medium")).toBeCloseTo(WATER_STEP_MS.medium! / 1000);
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
