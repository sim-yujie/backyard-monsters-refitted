import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildingArtCopy } from "./buildingArtCopies";
import { BUILDING_ART_COPIES } from "./buildingArtCopiesData";
import { modernBuildingArtUses } from "./buildingArtUses";
import { stripCells } from "./yardAnim";

const PUBLIC = fileURLToPath(new URL("../../../../server/public/", import.meta.url));

/** A picture's size in pixels: a WebP's `VP8X` / `VP8 ` header, or a PNG's `IHDR`. */
const pictureSize = (file: string): [number, number] => {
  const bytes = readFileSync(file);
  if (bytes.toString("latin1", 1, 4) === "PNG")
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  const chunk = bytes.toString("latin1", 12, 16);
  if (chunk === "VP8 ")
    return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
  if (chunk === "VP8L") {
    const bits = bytes.readUInt32LE(21);
    return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
  }
  expect(chunk, file).toBe("VP8X");
  return [bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1];
};

describe("buildingArtCopy (beta 9: smaller Modern building pictures for Low and Medium)", () => {
  const sniper = "/assets/buildings/snipertower/turret.t2@2x.webp";

  it("keeps the @2x on High, and takes the @1.5x on Medium and the @1x on Low", () => {
    expect(BUILDING_ART_COPIES["snipertower/turret.t2@2x.webp"]).toBe(2);
    expect(buildingArtCopy(sniper, "high")).toBe(sniper);
    expect(buildingArtCopy(sniper, "medium")).toBe(
      "/assets/buildings/snipertower/turret.t2@1.5x.webp",
    );
    expect(buildingArtCopy(sniper, "low")).toBe(
      "/assets/buildings/snipertower/turret.t2@1x.webp",
    );
  });

  it("keeps the @2x on Medium for a strip with no @1.5x, and leaves unlisted pictures alone", () => {
    const odd = Object.entries(BUILDING_ART_COPIES).find(([, copies]) => copies === 1)?.[0];
    expect(odd).toBeDefined();
    const url = `/assets/buildings/${odd!}`;
    expect(buildingArtCopy(url, "medium")).toBe(url);
    expect(buildingArtCopy(url, "low")).toBe(url.replace("@2x.", "@1x."));
    for (const other of [
      "/assets/buildings/cannontower/top.1.png",
      "/assets/monsters/fly_6-repaint@2x.png",
      "/assets/buildings/nothere@2x.webp",
    ]) {
      expect(buildingArtCopy(other, "low")).toBe(other);
    }
  });

  it("lists every Modern building picture the yard can ask for, with copies on disk that cut into the same cells", () => {
    const uses = modernBuildingArtUses();
    expect(uses.size).toBeGreaterThan(400);
    // Run `web/tools/building-copies/` again when this fails: a new picture has no copies yet.
    expect(Object.keys(BUILDING_ART_COPIES).sort()).toEqual(
      [...uses.keys()].map((path) => path.slice("assets/buildings/".length)),
    );
    for (const [path, use] of uses) {
      const original = PUBLIC + path;
      const [width2, height2] = pictureSize(original);
      const cells = [
        ...use.strips,
        ...use.frames.map((frame) => ({ ...frame, frames: 1, columns: null })),
      ];
      const copies: [string, number][] = [[original.replace("@2x.", "@1x."), 1]];
      if (BUILDING_ART_COPIES[path.slice("assets/buildings/".length)] === 2)
        copies.push([original.replace("@2x.", "@1.5x."), 1.5]);
      else
        expect(
          cells.some((cell) => cell.w % 2 !== 0 || cell.h % 2 !== 0),
          path,
        ).toBe(true);
      for (const [copy, scale] of copies) {
        expect(existsSync(copy), copy).toBe(true);
        const [width, height] = pictureSize(copy);
        // Within a pixel of the @2x's size at this scale, and never short of a whole cell.
        expect(Math.abs(width - (width2 * scale) / 2), copy).toBeLessThanOrEqual(1);
        expect(Math.abs(height - (height2 * scale) / 2), copy).toBeLessThanOrEqual(1);
        for (const cell of cells) {
          const anim = {
            width: cell.w,
            height: cell.h,
            frames: cell.frames,
            ...(cell.columns ? { columns: cell.columns } : {}),
          };
          // As `YardTextures` cuts it: Pixi's size in game units is the pixels over the scale in the name.
          expect(stripCells(anim, width / scale, height / scale), copy).toEqual(
            stripCells(anim, width2 / 2, height2 / 2),
          );
        }
      }
    }
  });
});
