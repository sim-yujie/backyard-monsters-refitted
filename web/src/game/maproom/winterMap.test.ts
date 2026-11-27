import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { setSeason } from "@/game/season";
import { terrainColour } from "./cellVisuals";
import { Ground, groundOfHeight, winterGround } from "./painted/groundKinds";

const PUBLIC = new URL("../../../public/maproom/", import.meta.url);

/** Christmas 2026's winter Map Room 2 (owner, 27 Nov 2026): snow on the land, water as it was, off after. */
describe("the winter map", () => {
  afterEach(() => setSeason("normal"));

  it("lays the painted ground's snow on every land ground at Christmas only", () => {
    const land = [100, 115, 150, 172, 190].map(groundOfHeight);
    expect(land.map(winterGround)).toEqual(land);
    setSeason("christmas");
    expect(land.map(winterGround)).toEqual(land.map(() => Ground.SNOW));
    expect(winterGround(Ground.SHALLOWS)).toBe(Ground.SHALLOWS);
    expect(winterGround(Ground.DEEP)).toBe(Ground.DEEP);
    expect(winterGround(Ground.FOG)).toBe(Ground.FOG);
  });

  it("colours the far view's land as snow, the water as before", () => {
    const grass = terrainColour(130);
    const sea = terrainColour(85);
    setSeason("christmas");
    expect(terrainColour(130)).not.toBe(grass);
    expect(terrainColour(85)).toBe(sea);
    // Light: each channel at least 0xa0.
    for (const height of [100, 107, 115, 130, 150, 165, 172, 200]) {
      const colour = terrainColour(height);
      for (const shift of [16, 8, 0]) expect((colour >> shift) & 0xff).toBeGreaterThanOrEqual(0xa0);
    }
  });

  it("has a winter copy of each ground sheet the map loads", () => {
    for (const name of ["ground", "ground-pointy100", "ground-pointy150", "ground-painted", "ground-painted-pointy150"]) {
      expect(existsSync(new URL(`${name}-winter@2x.webp`, PUBLIC)), name).toBe(true);
    }
  });
});
