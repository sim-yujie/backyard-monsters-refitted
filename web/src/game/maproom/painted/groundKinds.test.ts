import { describe, expect, it } from "vitest";
import type { MapCell } from "@/api/types";
import { Ground, encodeCell, groundOf, groundOfHeight } from "./groundKinds";
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
});
