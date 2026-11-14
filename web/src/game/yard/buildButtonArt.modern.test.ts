import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MODERN_BUTTON_FILE } from "./buildButtonModernData";
import { buildPicture, buttonUrl, modernButtonFile } from "./buildButtonArt";
import { newLookFor } from "./buildingArt";
import { catalogueFor } from "./buildCatalogue";
import type { YardKind } from "./buildingCosts";

/**
 * The build menu's Modern pictures (owner, 2 Nov 2026: "refresh the images in
 * 'buildings' for both overworld and inferno to use our new look for the
 * modern setting"): one for every building that has a new look in the yard,
 * none for the rest, all on disk. When a building gains or loses a new look, this
 * fails until `web/tools/build-pictures/make.py` is run again (run it too when a look
 * changes).
 */

const MODERN = fileURLToPath(new URL("../../../../server/public/assets/buildingbuttons/modern/", import.meta.url));

const KINDS: readonly YardKind[] = ["main", "outpost", "inferno"];

const menuTypes = (kind: YardKind): number[] => catalogueFor(kind).flatMap((category) => category.types);

describe("the build menu's Modern pictures", () => {
  it.each(KINDS)("a picture for every %s-yard building with a new look, and only those", (kind) => {
    for (const type of menuTypes(kind)) {
      const looks = newLookFor(type, 1, kind) !== null;
      expect(modernButtonFile(type, kind) !== null, `type ${type}: run web/tools/build-pictures/make.py`).toBe(looks);
    }
  });

  it("every picture named is on disk", () => {
    for (const files of Object.values(MODERN_BUTTON_FILE)) {
      for (const file of Object.values(files)) expect(existsSync(MODERN + file), file).toBe(true);
    }
  });

  it("with the Modern look, the new look; with the Classic look, Flash's button", () => {
    expect(buildPicture(1, "main", false)).toEqual({
      url: `/assets/buildingbuttons/modern/${MODERN_BUTTON_FILE.main[1]}`,
      modern: true,
    });
    expect(buildPicture(1, "main", true)).toEqual({ url: buttonUrl(1), modern: false });
    // A building with no new look (type 133): Flash's button either way.
    expect(buildPicture(133, "main", false)).toEqual({ url: buttonUrl(133), modern: false });
    // The Monster Locker (8) has its 3D look's picture (10 Nov 2026).
    expect(buildPicture(8, "main", false).url).toMatch(/\/modern\/8\.main\.[0-9a-f]{8}\.webp$/);
    expect(buildPicture(8, "main", true)).toEqual({ url: buttonUrl(8), modern: false });
  });

  it("the Inferno's Incubator Control Centre shows its own 3D look, not the Hatchery Control Center's", () => {
    const icc = buildPicture(16, "inferno", false);
    expect(icc.modern).toBe(true);
    expect(icc.url).toMatch(/\/modern\/16\.inferno\./);
    expect(icc.url).not.toBe(buildPicture(16, "main", false).url);
    expect(buildPicture(16, "inferno", true).url).toBe(buttonUrl(16, "inferno"));
  });

  it("an Inferno building with no Inferno look of its own keeps its Inferno button", () => {
    // The main yard's 3D Academy and Pebble Shiner are not the Inferno's.
    expect(buildPicture(26, "inferno", false)).toEqual({ url: buttonUrl(26, "inferno"), modern: false });
    expect(buildPicture(2, "inferno", false)).toEqual({ url: buttonUrl(2, "inferno"), modern: false });
  });

  it("the Inferno's 3D Magma Pump has a Modern picture of its own, not the Goo Factory's", () => {
    const picture = buildPicture(4, "inferno", false);
    expect(picture.modern).toBe(true);
    expect(picture.url).toMatch(/\/modern\/4\.inferno\.[0-9a-f]{8}\.webp$/);
    expect(picture.url).not.toBe(buildPicture(4, "main", false).url);
    expect(buildPicture(4, "inferno", true)).toEqual({ url: buttonUrl(4, "inferno"), modern: false });
  });

  it("the Inferno's 3D Bone Cruncher has a Modern picture of its own, not the Twig Snapper's", () => {
    const picture = buildPicture(1, "inferno", false);
    expect(picture.modern).toBe(true);
    expect(picture.url).toMatch(/\/modern\/1\.inferno\.[0-9a-f]{8}\.webp$/);
    expect(picture.url).not.toBe(buildPicture(1, "main", false).url);
    expect(buildPicture(1, "inferno", true)).toEqual({ url: buttonUrl(1, "inferno"), modern: false });
  });

  it("an outpost draws the main yard's pictures", () => {
    expect(buildPicture(13, "outpost", false)).toEqual(buildPicture(13, "main", false));
  });
});
