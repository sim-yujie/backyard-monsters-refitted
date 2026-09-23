import { describe, expect, it } from "vitest";
import fixture from "../../../test/fixtures/baseload-sandbox-yard.json";
import manifest from "../../../test/fixtures/building-art-files.json";
import { BUILDING_ART_ROWS } from "./buildingArtData";
import { artFolder, artTypes, ArtState, buildingName, maxHealth, resolveArt } from "./buildingArt";

/**
 * The art table against the art that is actually on the game server.
 *
 * `building-art-files.json` is generated beside the table by
 * `tools/gen-building-art.mjs`, which walks `server/public/assets/` once and
 * records which of the files the table names exist. Checking against that
 * rather than reading the filesystem here keeps the test meaningful in a
 * checkout without the server's assets, and makes a missing file a visible diff
 * in the fixture rather than a test that quietly starts passing.
 */

const folders = manifest.folders as Record<string, { exists: boolean; files: string[] }>;

/** The distinct building types in the captured 575-building yard. */
const fixtureTypes = [
  ...new Set(Object.values(fixture.buildingdata as Record<string, { t: number }>).map((b) => b.t)),
].sort((a, b) => a - b);

/** The file part of a resolved URL, which is what the manifest lists. */
const fileOf = (url: string): string => url.slice(url.lastIndexOf("/") + 1);

describe("the art table", () => {
  it("covers 130 building types with no duplicates", () => {
    expect(BUILDING_ART_ROWS.length).toBe(130);
    expect(artTypes().length).toBe(BUILDING_ART_ROWS.length);
  });

  it("names a folder that exists for every type", () => {
    const missing = artTypes().filter((type) => folders[artFolder(type) ?? ""]?.exists !== true);
    expect(missing).toEqual([]);
  });

  it("lists image levels in ascending order", () => {
    for (const [, , , levels] of BUILDING_ART_ROWS) {
      const ordered = levels.map((level) => level[0]);
      expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
      expect(new Set(ordered).size).toBe(ordered.length);
    }
  });

  it("resolves the default picture of every type to a file on disk", () => {
    const missing: string[] = [];
    for (const type of artTypes()) {
      for (const [level] of BUILDING_ART_ROWS.find((row) => row[0] === type)?.[3] ?? []) {
        const art = resolveArt(type, level, ArtState.DEFAULT);
        if (!art) {
          missing.push(`${type} level ${level}: unresolved`);
          continue;
        }
        const listed = folders[art.folder]?.files ?? [];
        if (!listed.includes(fileOf(art.top.url))) {
          missing.push(`${type} level ${level}: ${art.top.url}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("knows the seven shadows the game server is missing, and nothing else", () => {
    // Every one is an Inferno or Map Room 3 building's shadow, and each falls
    // back to a drawn building with no shadow rather than to a hole.
    expect(manifest.missing).toEqual([
      "132 buildings/imagmatower/shadow.1.destroyed.v2.jpg",
      "136 buildings/spurtztower/destroyed_shadow.jpg",
      "137 buildings/blackspurtztower/destroyed_shadow.jpg",
      "138 buildings/guardtower/shadow.v2.1.damaged.png",
      "138 buildings/guardtower/shadow.v2.1.destroyed.png",
      "138 buildings/guardtower/shadow.v2.1.png",
      "139 buildings/resourceoutpost/shadow.v2.1.png",
    ]);
  });
});

describe("the captured yard", () => {
  it("uses 31 building types", () => {
    expect(fixtureTypes).toEqual([
      1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24, 25, 26, 51,
      114, 115, 116, 117, 118, 119, 137,
    ]);
  });

  it("resolves every one of them to art that exists", () => {
    const unresolved: string[] = [];
    for (const type of fixtureTypes) {
      for (const state of [ArtState.DEFAULT, ArtState.DAMAGED, ArtState.DESTROYED]) {
        const art = resolveArt(type, 1, state);
        if (!art) {
          unresolved.push(`${type} ${state || "default"}: no art`);
          continue;
        }
        const listed = folders[art.folder]?.files ?? [];
        if (!listed.includes(fileOf(art.top.url))) {
          unresolved.push(`${type} ${state || "default"}: ${art.top.url}`);
        }
      }
    }
    expect(unresolved).toEqual([]);
  });

  it("resolves every building at its own level", () => {
    const buildings = Object.values(
      fixture.buildingdata as Record<string, { t: number; l?: number }>,
    );
    for (const building of buildings) {
      // An absent level means 1 (BFOUNDATION.as:2975-2977).
      const art = resolveArt(building.t, building.l ?? 1, ArtState.DEFAULT);
      expect(art, `type ${building.t}`).not.toBeNull();
      expect(folders[art!.folder]?.files).toContain(fileOf(art!.top.url));
    }
  });
});

describe("choosing the image for a level", () => {
  it("takes the exact entry when there is one", () => {
    // The Twig Snapper changes art at levels 1, 3, 6 and 10.
    expect(resolveArt(1, 3, ArtState.DEFAULT)?.level).toBe(3);
    expect(resolveArt(1, 10, ArtState.DEFAULT)?.level).toBe(10);
  });

  it("walks down to the nearest lower entry", () => {
    expect(resolveArt(1, 2, ArtState.DEFAULT)?.level).toBe(1);
    expect(resolveArt(1, 5, ArtState.DEFAULT)?.level).toBe(3);
    expect(resolveArt(1, 9, ArtState.DEFAULT)?.level).toBe(6);
  });

  it("uses the level 1 art for a building still under construction", () => {
    expect(resolveArt(1, 0, ArtState.DEFAULT)?.top.url).toBe(
      resolveArt(1, 1, ArtState.DEFAULT)?.top.url,
    );
  });

  it("stays on the highest entry above the ladder", () => {
    expect(resolveArt(1, 99, ArtState.DEFAULT)?.level).toBe(10);
  });

  it("clamps the two buildings capped below their art on Map Room 2", () => {
    // Flinger art goes to 5 but Map Room 2 stops at 4 (BFOUNDATION.as:835-843).
    expect(resolveArt(5, 5, ArtState.DEFAULT)?.level).toBe(4);
    expect(resolveArt(5, 4, ArtState.DEFAULT)?.level).toBe(4);
    // Monster Housing has one picture, so the clamp is invisible but harmless.
    expect(resolveArt(15, 10, ArtState.DEFAULT)?.level).toBe(1);
  });

  it("returns null for a type with no art at all", () => {
    expect(resolveArt(9999, 1, ArtState.DEFAULT)).toBeNull();
    // Mushrooms were an embedded Flash MovieClip, so the server has no file.
    expect(resolveArt(7, 1, ArtState.DEFAULT)).toBeNull();
  });
});

describe("choosing the image for a state", () => {
  it("picks the damaged and destroyed pictures when they exist", () => {
    expect(resolveArt(14, 1, ArtState.DAMAGED)?.top.url).toContain("top.1.damaged.png");
    expect(resolveArt(14, 1, ArtState.DESTROYED)?.top.url).toContain("top.1.destroyed.png");
  });

  it("falls back to the default picture when a state has none", () => {
    // The Booby Trap has no damaged art; it is one hit and gone.
    const damaged = resolveArt(24, 1, ArtState.DAMAGED);
    expect(damaged?.top.url).toBe(resolveArt(24, 1, ArtState.DEFAULT)?.top.url);
  });

  it("falls the shadow back with the picture, not separately", () => {
    const damaged = resolveArt(24, 1, ArtState.DAMAGED);
    expect(damaged?.shadow?.url).toBe(resolveArt(24, 1, ArtState.DEFAULT)?.shadow?.url);
  });

  it("reads an animation strip for a building with no still art", () => {
    // The Monster Bunker ships only anim.1.png, a 15-frame strip of 90 x 83.
    const art = resolveArt(22, 1, ArtState.DEFAULT);
    expect(art?.top.url).toContain("bunker/anim.1.png");
    expect(art?.top.frame).toEqual({ width: 90, height: 83 });
  });
});

describe("names and health", () => {
  it("uses the game's own English strings", () => {
    expect(buildingName(14)).toBe("Town Hall");
    expect(buildingName(1)).toBe("Twig Snapper");
    expect(buildingName(17)).toBe("Block");
    expect(buildingName(9999)).toBeNull();
  });

  it("reads maximum health off the props ladder", () => {
    // docs/specs/base-building.md section 3, "Full ladder — Town Hall".
    expect(maxHealth(14, 1)).toBe(4_000);
    expect(maxHealth(14, 10)).toBe(600_000);
    // Level 0 is a foundation and takes hp[0] (BFOUNDATION.as:3123-3129).
    expect(maxHealth(14, 0)).toBe(4_000);
    // Past the ladder, the last rung.
    expect(maxHealth(14, 99)).toBe(600_000);
  });

  it("gives a decoration the single rung the props table lists", () => {
    expect(maxHealth(28, 1)).toBe(100);
    expect(maxHealth(28, 5)).toBe(100);
  });

  it("has no ladder for a type it does not know", () => {
    expect(maxHealth(9999, 1)).toBeNull();
  });
});
