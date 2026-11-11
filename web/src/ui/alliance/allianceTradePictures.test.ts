import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { setClassicLook } from "@/game/classicLook";
import { LISTED_MONSTERS } from "@/game/monsters/monsterCatalogue";
import { monsterPortrait } from "@/game/portraits";
import { buildPictureAt } from "@/game/yard/buildButtonArt";
import { BUILDABLE_TYPES } from "@/game/yard/buildCatalogue";
import { maxLevel } from "@/game/yard/buildingCosts";

/**
 * Every picture a request "for" can show is a file on disk (lead, 11 Nov 2026:
 * the Town Hall's was broken). What a player can ask for is the server's
 * `tradeChoicesOf`: every main-yard building the build menu builds, and the
 * Town Hall, at levels 2 to its top, and every listed monster.
 */

const SERVER_PUBLIC = fileURLToPath(new URL("../../../../server/public", import.meta.url));
const WEB_PUBLIC = fileURLToPath(new URL("../../../public", import.meta.url));

/** The file a URL the game asks for is served from. */
const onDisk = (url: string): boolean => {
  if (url.startsWith("/assets/")) return existsSync(SERVER_PUBLIC + url);
  const local = url.replace(/^\/+/, "/");
  return existsSync(WEB_PUBLIC + local);
};

afterEach(() => setClassicLook(false));

describe("the pictures on an alliance request", () => {
  it("has a building picture on disk for every building and level a player can ask for, in both looks", () => {
    const missing: string[] = [];
    let checked = 0;
    for (const type of [14, ...BUILDABLE_TYPES]) {
      for (let level = 2; level <= maxLevel(type); level += 1) {
        for (const classic of [true, false]) {
          const url = buildPictureAt(type, level, classic);
          checked += 1;
          if (!onDisk(url)) missing.push(`${type} L${level} ${classic ? "classic" : "modern"}: ${url}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
    expect(missing).toEqual([]);
  });

  it("shows the Town Hall at its level", () => {
    expect(buildPictureAt(14, 2, true)).toBe("/assets/buildingbuttons/14.2.jpg");
    expect(buildPictureAt(14, 99, true)).toBe("/assets/buildingbuttons/14.10.jpg");
  });

  it("has a portrait on disk for every monster a player can ask for, in both looks", () => {
    const missing: string[] = [];
    for (const classic of [true, false]) {
      setClassicLook(classic);
      for (const entry of LISTED_MONSTERS) {
        const picture = monsterPortrait(entry.id, "icon");
        if (!onDisk(picture.src)) missing.push(`${entry.id} ${classic ? "classic" : "modern"}: ${picture.src}`);
        if (picture.fallback !== null && !onDisk(picture.fallback)) missing.push(`${entry.id} fallback: ${picture.fallback}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
