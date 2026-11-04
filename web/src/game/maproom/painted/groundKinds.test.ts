import { describe, expect, it } from "vitest";
import type { MapCell } from "@/api/types";
import { Ground, GroundTexture, OCCUPIED_FLAG, SHADER_TEXTURES, encodeCell, groundOf, groundOfHeight } from "./groundKinds";
import { GROUND_FRAGMENT, GROUND_SAMPLERS } from "./groundShader";

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

  it("paints the rock band as grassy hill top (mock-up B; rock shows as cliffs and rock fields)", () => {
    expect(groundOf(land(170))).toBe(Ground.LUSH);
    expect(groundOf(land(184))).toBe(Ground.LUSH);
    expect(groundOf(land(185))).toBe(Ground.SNOW);
  });

  it("a land feature (feat/mr2-land's lf) keeps the cell's own ground; forests stand on the meadow round them", () => {
    expect(groundOf(land(130, { lf: 1 }))).toBe(Ground.MEADOW);
    expect(groundOf(land(105, { lf: 1 }))).toBe(Ground.SAND);
    expect(groundOf(land(150, { lf: 1 }))).toBe(Ground.LUSH);
    expect(groundOf(land(175, { lf: 1 }))).toBe(Ground.LUSH);
    expect(groundOf(land(130, { lf: 2 }))).toBe(Ground.MEADOW);
    expect(groundOf(land(150, { lf: 3 }))).toBe(Ground.LUSH);
    expect(groundOf(land(130, { lf: 5 }))).toBe(Ground.MEADOW);
    expect(groundOf(land(80, { lf: 1 }))).toBe(Ground.DEEP);
  });

  it("binds the canopy and marsh mud textures for the features' overlays, which no cell wears", () => {
    expect(SHADER_TEXTURES[Ground.CANOPY]).toBe(GroundTexture.CANOPY);
    expect(SHADER_TEXTURES[Ground.MARSH]).toBe(GroundTexture.MARSH);
    for (const lf of [0, 1, 2, 3, 4]) {
      for (const height of [100, 120, 150, 175, 190]) {
        expect([Ground.CANOPY, Ground.MARSH]).not.toContain(groundOf(land(height, { lf })));
      }
    }
  });

  it("packs height, feature and ground into one texel", () => {
    const out = new Uint8Array(8);
    encodeCell(land(300, { lf: 3 }), out, 4);
    expect([...out.slice(4)]).toEqual([255, 3, 0, Ground.SNOW]);
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

  it("binds the coast's wet sand after the cell grounds, with the foam in its alpha, and the shader draws coast and details", () => {
    expect(SHADER_TEXTURES.indexOf(GroundTexture.WET_SAND)).toBe(10);
    expect(SHADER_TEXTURES.indexOf(GroundTexture.FOAM)).toBe(11);
    // Every cell ground stays below the flat colours, in the data texture's low 4 bits.
    expect(SHADER_TEXTURES.length).toBeLessThan(Ground.FOG);
    expect(GROUND_FRAGMENT).toContain(`& ${OCCUPIED_FLAG}`);
    expect(GROUND_FRAGMENT).toContain("uGround10, uv, dx, dy");
    // WebGL2 gives a fragment shader 16 samplers: the foam's brightness rides in the wet sand's
    // alpha (PaintedGround's withFoamAlpha) instead of a sampler of its own.
    expect(GROUND_SAMPLERS).not.toContain(11);
    expect(GROUND_FRAGMENT).not.toContain("uGround11");
    expect(GROUND_FRAGMENT).toContain("uGround10, uv * 1.7");
    expect(GROUND_FRAGMENT.match(/uniform sampler2D/g)!.length).toBeLessThanOrEqual(16);
    expect(GROUND_FRAGMENT).toContain("drawRocks(");
    expect(GROUND_FRAGMENT).toContain("drawDecals(");
    // No template placeholder left unfilled.
    expect(GROUND_FRAGMENT).not.toContain("${");
  });
});
