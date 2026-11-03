import { describe, expect, it } from "vitest";
import type { MapCell } from "@/api/types";
import { Ground, GroundTexture, OCCUPIED_FLAG, SHADER_TEXTURES, encodeCell, groundOf, groundOfHeight } from "./groundKinds";
import { GROUND_FRAGMENT } from "./groundShader";

const land = (i: number, extra: Record<string, unknown> = {}): MapCell => ({ i, ...extra }) as unknown as MapCell;

describe("painted ground kinds", () => {
  it("follows the server's height bands", () => {
    expect(groundOfHeight(40)).toBe(Ground.DEEP);
    expect(groundOfHeight(95)).toBe(Ground.SHALLOWS);
    expect(groundOfHeight(100)).toBe(Ground.SAND);
    expect(groundOfHeight(109)).toBe(Ground.SAND);
    expect(groundOfHeight(110)).toBe(Ground.MEADOW);
    expect(groundOfHeight(150)).toBe(Ground.LUSH);
    expect(groundOfHeight(175)).toBe(Ground.ROCK);
    expect(groundOfHeight(190)).toBe(Ground.SNOW);
  });

  it("fog and unloaded cells get their flat colours", () => {
    expect(groundOf(undefined)).toBe(Ground.UNLOADED);
    expect(groundOf({ fog: 1 } as unknown as MapCell)).toBe(Ground.FOG);
  });

  it("a land feature (feat/mr2-land's lf) picks forest floor, rock or marsh on land only", () => {
    expect(groundOf(land(130, { lf: 1 }))).toBe(Ground.FOREST_FLOOR);
    expect(groundOf(land(130, { lf: 2 }))).toBe(Ground.ROCK);
    expect(groundOf(land(130, { lf: 3 }))).toBe(Ground.MARSH);
    expect(groundOf(land(130, { lf: 5 }))).toBe(Ground.MEADOW);
    expect(groundOf(land(80, { lf: 1 }))).toBe(Ground.DEEP);
  });

  it("packs height, feature and ground into one texel", () => {
    const out = new Uint8Array(8);
    encodeCell(land(300, { lf: 3 }), out, 4);
    expect([...out.slice(4)]).toEqual([255, 3, 0, Ground.MARSH]);
    encodeCell(undefined, out, 0);
    expect([...out.slice(0, 4)]).toEqual([0, 0, 0, Ground.UNLOADED]);
  });

  it("the shader paints fog and unloaded flat, and every ground below them from a texture", () => {
    expect(GROUND_FRAGMENT).toContain(`if (g == ${Ground.FOG}) return uFog;`);
    expect(GROUND_FRAGMENT).toContain(`if (g == ${Ground.UNLOADED}) return uUnloaded;`);
    for (let g = 0; g <= Ground.DEEP; g++) expect(GROUND_FRAGMENT).toContain(`uGround${g}, uv, dx, dy`);
  });

  it("flags cells with a camp, yard or outpost picture so the ground details keep clear", () => {
    const out = new Uint8Array(4);
    encodeCell(land(130, { b: 2, uid: 0 }), out, 0);
    expect(out[3]).toBe(Ground.MEADOW | OCCUPIED_FLAG);
    expect(out[3]! & 15).toBe(Ground.MEADOW);
    encodeCell(land(95), out, 0);
    expect(out[3]).toBe(Ground.SHALLOWS);
    encodeCell({ fog: 1 } as unknown as MapCell, out, 0);
    expect(out[3]).toBe(Ground.FOG);
  });

  it("binds the coast's wet sand and foam after the cell grounds, and the shader draws coast and details", () => {
    expect(SHADER_TEXTURES.indexOf(GroundTexture.WET_SAND)).toBe(10);
    expect(SHADER_TEXTURES.indexOf(GroundTexture.FOAM)).toBe(11);
    // Every cell ground stays below the flat colours, in the data texture's low 4 bits.
    expect(SHADER_TEXTURES.length).toBeLessThan(Ground.FOG);
    expect(GROUND_FRAGMENT).toContain(`& ${OCCUPIED_FLAG}`);
    expect(GROUND_FRAGMENT).toContain("uGround10, uv, dx, dy");
    expect(GROUND_FRAGMENT).toContain("uGround11, uv, dx, dy");
    expect(GROUND_FRAGMENT).toContain("drawRocks(");
    expect(GROUND_FRAGMENT).toContain("drawDecals(");
    // No template placeholder left unfilled.
    expect(GROUND_FRAGMENT).not.toContain("${");
  });
});
