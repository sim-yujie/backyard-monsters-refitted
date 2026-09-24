import { describe, expect, it } from "vitest";
import fixture from "../../../test/fixtures/baseload-sandbox-yard.json";
import manifest from "../../../test/fixtures/building-art-files.json";
import { BUILDING_ART_ROWS } from "./buildingArtData";
import {
  artFolder,
  artTypes,
  ArtState,
  buildingName,
  maxHealth,
  prettifyArtKey,
  resolveArt,
} from "./buildingArt";
import { stripCells } from "./yardAnim";

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

/** The real pixel size of each animation strip, keyed by `folder + file`. */
const strips = manifest.strips as Record<string, { width: number; height: number } | null>;

/** The distinct building types in the captured 575-building yard. */
const fixtureTypes = [
  ...new Set(Object.values(fixture.buildingdata as Record<string, { t: number }>).map((b) => b.t)),
].sort((a, b) => a - b);

/** The file part of a resolved URL, which is what the manifest lists. */
const fileOf = (url: string): string => url.slice(url.lastIndexOf("/") + 1);

describe("the art table", () => {
  it("covers 131 building types with no duplicates", () => {
    expect(BUILDING_ART_ROWS.length).toBe(131);
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

  it("names only files the game server actually has", () => {
    // Every file the table references exists. It did not always: the props file
    // keeps dead image lines commented out, and reading those as live named
    // seven shadows that are not on disk. The generator strips comments.
    expect(manifest.missing).toEqual([]);
  });

  it("keeps the Inferno Portal, whose level keys are bare numbers", () => {
    // The one entry in YARD_PROPS.as spelled `1: {` rather than `"1": {`.
    const portal = BUILDING_ART_ROWS.find((row) => row[0] === 127);
    expect(portal?.[3].map((level) => level[0])).toEqual([1, 2, 3, 4, 5]);
    // Its level 1 to 4 shadows are commented out in the props, so only the
    // level 5 one is live.
    expect(resolveArt(127, 1, ArtState.DEFAULT)?.shadow).toBeNull();
    expect(resolveArt(127, 5, ArtState.DEFAULT)?.shadow?.url).toContain("shadow.5.v2.jpg");
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

  it("names every type in the table, with no string keys left showing", () => {
    // The Find panel and the planner's drawer print this straight out, so a
    // key that never got looked up reads as "bi_blackspurtzcannon" (issue #51).
    // The props table spells some names `#b_key#` and some bare, and the
    // generator now searches both sections of the string file for them.
    const keys = artTypes().filter((type) => (buildingName(type) ?? "").includes("_"));
    expect(keys).toEqual([]);
    for (const type of artTypes()) expect(buildingName(type)).not.toBe("");
  });

  it("names the types the archived string tables predate", () => {
    // From docs/specs/base-building.md and docs/specs/combat.md; en.v612.txt
    // has no entry for any of them.
    expect(buildingName(137)).toBe("Black Spurtz Cannon");
    expect(buildingName(136)).toBe("Spurtz Cannon");
    expect(buildingName(133)).toBe("Siege Factory");
    expect(buildingName(134)).toBe("Siege Works");
    expect(buildingName(138)).toBe("Stronghold");
    expect(buildingName(139)).toBe("Resource Outpost");
    expect(buildingName(140)).toBe("Outpost Defender");
  });

  it("reads the decorations out of the strings' second section", () => {
    // These carry a bare key rather than `#bdg_acorn#`, and used to fall
    // through to it.
    expect(buildingName(55)).toBe("Acorn");
    expect(buildingName(68)).toBe("Toy Raceway");
    expect(buildingName(110)).toBe("D.A.V.E. Pumpkin");
  });

  it("makes words of a key nothing names", () => {
    expect(prettifyArtKey("bi_blackspurtzcannon")).toBe("Blackspurtzcannon");
    expect(prettifyArtKey("bdg_dave_trophy")).toBe("Dave Trophy");
    expect(prettifyArtKey("#b_stronghold#")).toBe("Stronghold");
    expect(prettifyArtKey("hwn_pumpkin")).toBe("Pumpkin");
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

describe("animation layers", () => {
  it("cuts every strip into cells the file on disk actually holds", () => {
    // The one check that catches a mis-read rectangle. `stripCells` is the same
    // fitting the renderer does, so this asserts what ends up on the GPU: every
    // cell inside its source, and at least one cell per strip. Sizes come from
    // the generated manifest, so no filesystem is touched.
    const wrong: string[] = [];

    for (const [type, , folder, levels] of BUILDING_ART_ROWS) {
      for (const level of levels) {
        for (const anim of [...(level[7] ?? []), ...(level[8] ?? [])]) {
          const [file, , , width, height, frames] = anim;
          const size = strips[`${folder}${file}`];
          if (!size) {
            wrong.push(`${type} ${folder}${file}: not on disk`);
            continue;
          }
          const cut = stripCells({ width, height, frames }, size.width, size.height);
          if (cut.frames < 1 || cut.frames * cut.width > size.width || cut.height > size.height) {
            wrong.push(
              `${type} ${folder}${file}: cut ${cut.frames} x ${cut.width}x${cut.height} ` +
                `does not fit ${size.width}x${size.height}`,
            );
          }
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  it("records the nine strips whose props entry disagrees with its file", () => {
    // Pinned rather than fixed: the table is a faithful copy of YARD_PROPS.as,
    // and these nine entries are wrong in the original. The list exists so a
    // tenth shows up as a diff instead of quietly being clamped away. Anything
    // outside it must satisfy `width * frames == file width` exactly.
    const disagreeing: string[] = [];

    for (const [type, , folder, levels] of BUILDING_ART_ROWS) {
      for (const level of levels) {
        for (const [file, , , width, height, frames] of [
          ...(level[7] ?? []),
          ...(level[8] ?? []),
        ]) {
          const size = strips[`${folder}${file}`];
          if (size && (size.width !== width * frames || size.height !== height)) {
            disagreeing.push(`${type} ${file}`);
          }
        }
      }
    }

    expect(disagreeing).toEqual([
      // 21 cells claimed of a 21-cell file, but the table plays 20 of them.
      "8 anim.2.png",
      // 21 cells claimed of a 20-cell file.
      "8 anim.4.png",
      // Cells 57 tall claimed of a 27-tall file.
      "25 anim.3.damaged.png",
      // A 15 x 3 grid described as 45 cells in a row.
      "54 large-anim-6.png",
      // 45 cells on disk, 42 played.
      "105 anim.png",
      // Cells a pixel taller than the file, and 51 wide where the pitch is 54.
      "136 top-normal-anim.v2.png",
      "136 top-damaged-anim.v2.png",
      // 32 cells on disk, 31 played.
      "137 top-normal-anim.v2.png",
      "137 top-damaged-anim.v2.png",
    ]);
  });

  it("covers every animated type the captured yard contains", () => {
    const animated = fixtureTypes.filter(
      (type) => (resolveArt(type, 1, ArtState.DEFAULT)?.anims.length ?? 0) > 0,
    );
    expect(animated).toEqual([1, 2, 3, 4, 6, 8, 9, 13, 19, 21, 22, 23, 25, 26, 115, 116, 118, 137]);
  });

  it("reads the Sniper Tower's turret strip", () => {
    // YARD_PROPS.as: ["anim.3.png", new Rectangle(-27, -50, 55, 47), 30].
    const art = resolveArt(21, 1, ArtState.DEFAULT);
    expect(art?.anims).toHaveLength(1);
    expect(art?.anims[0]).toMatchObject({ x: -27, y: -50, width: 55, height: 47, frames: 30 });
    expect(art?.anims[0]?.url).toContain("snipertower/anim.3.png");
  });

  it("reads all three layers of the Monster Lab", () => {
    const art = resolveArt(116, 1, ArtState.DEFAULT);
    expect(art?.anims.map((one) => one.frames)).toEqual([32, 5, 5]);
    expect(art?.anims.map((one) => fileOf(one.url))).toEqual([
      "anim.1.png",
      "anim.2.png",
      "anim.3.png",
    ]);
  });

  it("swaps in the damaged strip for a damaged building", () => {
    expect(fileOf(resolveArt(21, 1, ArtState.DAMAGED)?.anims[0]?.url ?? "")).toBe(
      "anim.3.damaged.png",
    );
  });

  it("gives a destroyed building no animation at all", () => {
    // There is no `animdestroyed` anywhere in the props table.
    for (const type of fixtureTypes) {
      expect(resolveArt(type, 1, ArtState.DESTROYED)?.anims ?? [], `type ${type}`).toEqual([]);
    }
  });

  it("leaves a type with no strip alone", () => {
    // The Block is a wall: one picture, no moving parts.
    expect(resolveArt(17, 1, ArtState.DEFAULT)?.anims).toEqual([]);
    expect(resolveArt(17, 1, ArtState.DEFAULT)?.topIsAnim).toBe(false);
  });

  it("flags the four types whose top is only their first cell", () => {
    const flagged = artTypes().filter((type) => resolveArt(type, 1, ArtState.DEFAULT)?.topIsAnim);
    expect(flagged).toEqual([22, 53, 105, 129]);
  });
});
