import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INFERNO_MENU_TYPES } from "./buildCatalogue";
import { buttonFile, buttonUrl, INFERNO_SILHOUETTE_FILE, silhouetteUrl } from "./buildButtonArt";

/** The Inferno build menu's pictures (WP 1.19): Flash's own buttons, on disk. */

const BUTTONS = fileURLToPath(
  new URL("../../../../server/public/assets/buildingbuttons/", import.meta.url),
);

describe("the Inferno build menu's pictures", () => {
  it("has a picture on disk for every type the menu offers", () => {
    for (const type of INFERNO_MENU_TYPES) {
      expect(existsSync(BUTTONS + buttonFile(type, "inferno")), `${type}`).toBe(true);
    }
  });

  it("uses the Inferno props table's button, not the surface's", () => {
    expect(buttonUrl(1, "inferno")).toBe("/assets/buildingbuttons/bone_crusher.v2.jpg");
    expect(buttonUrl(17, "inferno")).toBe("/assets/buildingbuttons/coal_wall.v3.jpg");
    expect(buttonUrl(129, "inferno")).toBe("/assets/buildingbuttons/quake_tower.v2.jpg");
    // Painted for the Inferno: Flash had no Inferno Yard Planner.
    expect(buttonUrl(10, "inferno")).toBe("/assets/buildingbuttons/yard_planner.v2.jpg");
    expect(existsSync(BUTTONS + "yard_planner.v2.jpg")).toBe(true);
    // The Juicer names none in either table.
    expect(buttonUrl(9, "inferno")).toBe("/assets/buildingbuttons/9.jpg");
    expect(buttonUrl(1)).toBe("/assets/buildingbuttons/1.jpg");
  });

  it("has only the silhouettes that are on disk", () => {
    for (const file of Object.values(INFERNO_SILHOUETTE_FILE)) expect(existsSync(BUTTONS + file), file).toBe(true);
    expect(silhouetteUrl(129, "inferno")).toBe("/assets/buildingbuttons/quake_tower.v2.silhouette.jpg");
    // The surface Locker's silhouette is not the Inferno Locker's.
    expect(silhouetteUrl(8, "inferno")).toBeNull();
  });
});
