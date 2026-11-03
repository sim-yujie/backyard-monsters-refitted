import { describe, expect, it, vi } from "vitest";
import type { ZoneRecord } from "../ZoneStore";
import { GroundData } from "./GroundData";
import { Ground } from "./groundKinds";
import { groundShaderCompiles } from "./PaintedGround";

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
