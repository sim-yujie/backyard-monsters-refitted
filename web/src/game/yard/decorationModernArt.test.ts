import { existsSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setClassicLook } from "@/game/classicLook";
import { buildPicture, buttonUrl } from "./buildButtonArt";
import { MODERN_BUTTON_FILE } from "./buildButtonModernData";
import { ArtState, newLookFor, resolveArt } from "./buildingArt";
import { kindOf } from "./buildingCosts";
import { DECORATION_MODERN_ART } from "./decorationModernArt";

const ASSETS = new URL("../../../../server/public/assets/", import.meta.url);
const onDisk = (url: string): URL => new URL(url.slice("/assets/".length), ASSETS);

/** A WebP with alpha's width and height, from its `VP8X` header. */
const webpSize = (url: URL): [number, number] => {
  const bytes = readFileSync(url);
  expect(bytes.toString("latin1", 12, 16), url.pathname).toBe("VP8X");
  return [bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1];
};

const TYPES = Object.keys(DECORATION_MODERN_ART).map(Number);
const FLAGS = Array.from({ length: 23 }, (_, i) => 28 + i);
/** The pilot's Flash decorations whose picture has a moving part: every flag's cloth and the Tiki Torch's flame. */
const KEEPS_FLASH_ANIM = [71, ...FLAGS];

describe("the Flash decorations' Modern look (owner, 10 Nov 2026: the pilot)", () => {
  it("covers the pilot: one of each kind and size, and every flag on one pole", () => {
    expect([...TYPES].sort((a, b) => a - b)).toEqual([...FLAGS, 65, 71, 73, 87, 93, 98, 99, 110].sort((a, b) => a - b));
    for (const type of TYPES) expect(kindOf(type), `${type}`).toBe("decoration");
  });

  describe("with the Classic look", () => {
    beforeAll(() => setClassicLook(true));
    afterAll(() => setClassicLook(false));

    it("stand on Flash's own art, untouched", () => {
      for (const type of TYPES) {
        expect(newLookFor(type, 1), `${type}`).toBeNull();
        const art = resolveArt(type, 1, ArtState.DEFAULT)!;
        expect(art.top.url, `${type}`).not.toContain(".modern");
        expect(art.shadow?.url ?? "", `${type}`).not.toContain(".modern");
      }
    });
  });

  describe("with the Modern look", () => {
    beforeAll(() => setClassicLook(false));

    it("stand on their Modern picture, on disk, at exactly 2x", () => {
      for (const type of TYPES) {
        expect(newLookFor(type, 1), `${type}`).not.toBeNull();
        const art = resolveArt(type, 1, ArtState.DEFAULT)!;
        expect(art.top.url, `${type}`).toMatch(/^\/assets\/buildings\/decorations\/[\w.-]+\/[\w-]+\.modern@2x\.webp$/);
        expect(existsSync(onDisk(art.top.url)), art.top.url).toBe(true);
        const [width, height] = webpSize(onDisk(art.top.url));
        expect(width % 2 + (height % 2), `${type} even`).toBe(0);
        expect(art.shadow, `${type} shadow`).not.toBeNull();
        expect(existsSync(onDisk(art.shadow!.url)), art.shadow!.url).toBe(true);
      }
    });

    it("draw their own Modern shadow, except those keeping a Flash moving part", () => {
      for (const type of TYPES.filter((t) => !KEEPS_FLASH_ANIM.includes(t))) {
        const art = resolveArt(type, 1, ArtState.DEFAULT)!;
        expect(art.shadow!.url, `${type}`).toMatch(/\.modern-shadow\.jpg$/);
        expect(art.anims, `${type}`).toEqual([]);
      }
    });

    it("keep Flash's waving cloth or flame, and its shadow, over the new pole or torch", () => {
      for (const type of KEEPS_FLASH_ANIM) {
        setClassicLook(true);
        const flash = resolveArt(type, 1, ArtState.DEFAULT)!;
        setClassicLook(false);
        const modern = resolveArt(type, 1, ArtState.DEFAULT)!;
        expect(flash.anims.length, `${type} has a Flash strip`).toBeGreaterThan(0);
        expect(modern.anims, `${type}`).toEqual(flash.anims);
        expect(modern.shadow, `${type}`).toEqual(flash.shadow);
        expect(modern.topIsAnim, `${type}`).toBe(false);
      }
      // One pole for every flag.
      const poles = new Set(FLAGS.map((type) => resolveArt(type, 1, ArtState.DEFAULT)!.top.url));
      expect([...poles]).toEqual(["/assets/buildings/decorations/flags/flagpole.modern@2x.webp"]);
    });

    it("keep the Modern look when damaged or destroyed (a decoration has no wreck)", () => {
      for (const type of TYPES) {
        const plain = resolveArt(type, 1, ArtState.DEFAULT)!;
        for (const state of [ArtState.DAMAGED, ArtState.DESTROYED]) {
          expect(resolveArt(type, 1, state)!.top.url, `${type} ${state}`).toBe(plain.top.url);
        }
      }
    });
  });

  it("show Flash's buttons with the Classic look and a Modern picture with the Modern look", () => {
    for (const type of TYPES) {
      expect(buildPicture(type, "main", true), `${type}`).toEqual({ url: buttonUrl(type), modern: false });
      const modern = buildPicture(type, "main", false);
      expect(modern.modern, `${type}: run web/tools/build-pictures/make.py`).toBe(true);
      expect(modern.url).toBe(`/assets/buildingbuttons/modern/${MODERN_BUTTON_FILE.main[type]}`);
      expect(existsSync(onDisk(modern.url)), modern.url).toBe(true);
    }
  });
});
