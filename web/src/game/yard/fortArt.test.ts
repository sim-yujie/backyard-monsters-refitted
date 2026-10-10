import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fortArtFor } from "./fortArt";

const ASSETS = resolve(__dirname, "../../../../server/public");

describe("fortArtFor", () => {
  it("draws nothing for an unfortified building or a type without overlay art", () => {
    expect(fortArtFor(20, 0)).toBeNull();
    expect(fortArtFor(17, 2)).toBeNull();
    expect(fortArtFor(15, 1)).toBeNull();
  });

  it("picks the size and tier: towers and silo fort70, hall and core fort130", () => {
    expect(fortArtFor(20, 2)?.front.url).toBe("/assets/buildings/fortifications/fort70_F2.png");
    expect(fortArtFor(25, 4)?.back.url).toBe("/assets/buildings/fortifications/fort70_B4.png");
    expect(fortArtFor(6, 1)?.front.url).toBe("/assets/buildings/fortifications/fort70_F1.png");
    expect(fortArtFor(14, 3)?.back.url).toBe("/assets/buildings/fortifications/fort130_B3.png");
    expect(fortArtFor(112, 1)?.front.url).toBe("/assets/buildings/fortifications/fort130_F1.png");
  });

  it("uses the props table's offsets, which differ for the silo and the hall", () => {
    expect(fortArtFor(20, 1)).toMatchObject({ front: { x: -73, y: 21 }, back: { x: -70, y: -10 } });
    expect(fortArtFor(6, 1)).toMatchObject({ front: { x: -73, y: 28 }, back: { x: -71, y: -4 } });
    expect(fortArtFor(14, 4)).toMatchObject({ front: { x: -124, y: 15 }, back: { x: -116, y: -49 } });
  });

  it("clamps a tier above 4 to 4", () => {
    expect(fortArtFor(21, 9)?.front.url).toContain("fort70_F4");
  });

  it("every picture it names is on disk", () => {
    for (const type of [6, 14, 20, 21, 23, 25, 112, 115, 118]) {
      for (let fort = 1; fort <= 4; fort++) {
        const art = fortArtFor(type, fort)!;
        expect(existsSync(resolve(ASSETS, art.front.url.slice(1)))).toBe(true);
        expect(existsSync(resolve(ASSETS, art.back.url.slice(1)))).toBe(true);
      }
    }
  });
});
