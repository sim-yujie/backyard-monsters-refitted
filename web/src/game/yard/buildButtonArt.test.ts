import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BUILDABLE_TYPES } from "./buildCatalogue";
import { buttonFile, buttonUrl, SILHOUETTE_FILE, silhouetteUrl } from "./buildButtonArt";

/**
 * The build menu's pictures against the files on the game server's disk, so a
 * renamed or missing button fails here rather than as a broken image.
 */

const BUTTONS = fileURLToPath(
  new URL("../../../../server/public/assets/buildingbuttons/", import.meta.url),
);

describe("build button art", () => {
  it("every buildable type has its button on disk", () => {
    for (const type of BUILDABLE_TYPES) expect(existsSync(BUTTONS + buttonFile(type)), `${type}`).toBe(true);
  });

  it("every silhouette listed is on disk", () => {
    for (const file of Object.values(SILHOUETTE_FILE)) expect(existsSync(BUTTONS + file), file).toBe(true);
  });

  it("the Block's button is the props table's 17.1; a type without a silhouette has none", () => {
    expect(buttonUrl(17)).toBe("/assets/buildingbuttons/17.1.jpg");
    expect(buttonUrl(20)).toBe("/assets/buildingbuttons/20.jpg");
    expect(silhouetteUrl(13)).toBe("/assets/buildingbuttons/13.2.silhouette.jpg");
    expect(silhouetteUrl(20)).toBeNull();
  });
});
