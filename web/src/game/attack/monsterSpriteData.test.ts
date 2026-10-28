import { describe, expect, it } from "vitest";
import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MONSTER_SPRITES, type MonsterSheet } from "./monsterSpriteData";
import { applyLayout, REPAINTED_SHEETS } from "./monsterSprites";
import { SHEET_VERSIONS } from "./sheetVersions";
import { sheetCopies } from "@/game/quality";

/**
 * The generated sprite table, checked against the PNGs on the game server's
 * disk.
 *
 * The table is machine-written, so these are a tripwire on
 * `web/tools/gen-monster-sprites.mjs` and on the asset folder: a sheet that
 * goes missing, or a regex that stops matching `SPRITES.as`, should fail here
 * rather than draw nothing during an attack. The sheets are read straight from
 * `server/public/assets/`, relative to the repo root, the same place the
 * generator read them.
 */

const ASSETS = fileURLToPath(new URL("../../../../server/public/assets/", import.meta.url));

/** A PNG's pixel size from its IHDR header; the generator does the same. */
const pngSize = (path: string): { width: number; height: number } => {
  const head = Buffer.alloc(24);
  const handle = openSync(path, "r");
  try {
    readSync(handle, head, 0, 24, 0);
  } finally {
    closeSync(handle);
  }
  expect(head.toString("latin1", 1, 4)).toBe("PNG");
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
};

/** A PNG's tEXt notes ahead of its pixels, as {key: value}. */
const pngNotes = (path: string): Record<string, string> => {
  const head = Buffer.alloc(1 << 16);
  const handle = openSync(path, "r");
  let read: number;
  try {
    read = readSync(handle, head, 0, head.length, 0);
  } finally {
    closeSync(handle);
  }
  const notes: Record<string, string> = {};
  for (let at = 8; at + 8 <= read; ) {
    const length = head.readUInt32BE(at);
    const kind = head.toString("latin1", at + 4, at + 8);
    if (kind === "IDAT") break;
    if (kind === "tEXt") {
      const body = head.toString("latin1", at + 8, at + 8 + length);
      const split = body.indexOf("\0");
      if (split > 0) notes[body.slice(0, split)] = body.slice(split + 1);
    }
    at += 12 + length;
  }
  return notes;
};

/**
 * The painted sheets (`name@4x.png`, `name@3x.png`, Korath 5 and 6 `name@2x.png`)
 * and their Quality copies: `name@2x.png` (`name@1.5x.png`), `name.png`.
 */
const paintings = Object.values(REPAINTED_SHEETS).flatMap((file) => {
  const copies = sheetCopies(file);
  if (!copies) return [];
  const scaleOf = (name: string): number => Number(/@([\d.]+)x\.png$/.exec(name)?.[1] ?? 1);
  return [{ file, scale: scaleOf(file), half: copies.medium, halfScale: scaleOf(copies.medium), one: copies.low }];
});

/**
 * Sheets whose size is not a whole multiple of the frame size, with the
 * leftover in pixels. Mirrors `KNOWN_SLACK` in the generator; anything else
 * must divide exactly.
 */
const SLACK: Readonly<Record<string, { x: number; y: number }>> = {
  "monsters/sprite.11.v2.png": { x: 0, y: -1 },
  "monsters/13.png": { x: 0, y: 1 },
  "monsters/slimeattikusmini_anim.png": { x: 0, y: -4 },
  "monsters/zagnoid.png": { x: 1, y: 0 },
  "monsters/grokus.v2.png": { x: 8, y: 0 },
};

const sheets: MonsterSheet[] = Object.values(MONSTER_SPRITES);
const champions = sheets.filter((one) => one.family !== one.key);

describe("MONSTER_SPRITES", () => {
  it("holds every monsters/ sheet SPRITES.as declares", () => {
    // 2 workers, C1-C19 plus the gold D.A.V.E., IC1-IC8, 27 champion sheets,
    // the looter, two shadows and the rocket (`SPRITES.as:19-83`).
    expect(sheets).toHaveLength(61);
    expect(champions).toHaveLength(27);
    for (const [key, sheet] of Object.entries(MONSTER_SPRITES)) expect(sheet.key).toBe(key);
  });

  it("names only files that exist under server/public/assets/", () => {
    for (const sheet of sheets) {
      expect(existsSync(`${ASSETS}${sheet.file}`), sheet.file).toBe(true);
    }
  });

  // Reads every sprite PNG from disk, so slow on a busy machine (issue #210).
  it("records each PNG's real size, and columns x frame size matches it", () => {
    for (const sheet of sheets) {
      const size = pngSize(`${ASSETS}${sheet.file}`);
      expect(size, sheet.key).toEqual({ width: sheet.width, height: sheet.height });
      const slack = SLACK[sheet.file] ?? { x: 0, y: 0 };
      expect(sheet.columns * sheet.frameWidth + slack.x, sheet.key).toBeCloseTo(size.width, 6);
      expect(sheet.rows * sheet.frameHeight + slack.y, sheet.key).toBeCloseTo(size.height, 6);
      expect(sheet.columns, sheet.key).toBeGreaterThan(0);
      expect(sheet.rows, sheet.key).toBeGreaterThan(0);
    }
  }, 20_000);

  it("keeps every animation cycle inside its sheet", () => {
    for (const sheet of sheets) {
      for (const [name, cycle] of Object.entries(sheet.animations)) {
        expect(cycle.first, `${sheet.key}.${name}`).toBeGreaterThanOrEqual(0);
        expect(cycle.count, `${sheet.key}.${name}`).toBeGreaterThan(0);
        expect(cycle.ticksPerFrame, `${sheet.key}.${name}`).toBeGreaterThan(0);
        expect(cycle.first + cycle.count, `${sheet.key}.${name}`).toBeLessThanOrEqual(sheet.rows);
      }
    }
  });

  it("splits the circle into 30, 32 or 16 headings, or 1 for a shadow", () => {
    for (const sheet of sheets) {
      expect([1, 16, 30, 32], sheet.key).toContain(sheet.directions);
      expect(sheet.directionOffset, sheet.key).toBe(sheet.directions === 16 ? 45 : 0);
    }
    expect(MONSTER_SPRITES["shadow"]?.directions).toBe(1);
    expect(MONSTER_SPRITES["bigshadow"]?.directions).toBe(1);
  });

  it("gives every champion family contiguous sheets from level 1 (SPRITES.as:53-79)", () => {
    const byFamily = new Map<string, number[]>();
    for (const sheet of champions) {
      expect(sheet.directions, sheet.key).toBe(16);
      const list = byFamily.get(sheet.family) ?? [];
      list.push(Number(sheet.key.slice(sheet.family.length + 1)));
      byFamily.set(sheet.family, list);
    }
    expect([...byFamily.keys()].sort()).toEqual(["G1", "G2", "G3", "G4", "G5"]);
    for (const [family, levels] of byFamily) {
      levels.sort((a, b) => a - b);
      expect(levels, family).toEqual(levels.map((_, i) => i + 1));
    }
    expect(byFamily.get("G5")).toHaveLength(3);
  });

  it("lays out champion rows as GetSprite reads them (SPRITES.as:229-337)", () => {
    // Gorgo and Drull: idle row 0, walk 1-7, attack 8-14 then 8-15 from level 4.
    expect(MONSTER_SPRITES["G1_1"]?.animations).toEqual({
      idle: { first: 0, count: 1, ticksPerFrame: 8 },
      walk: { first: 1, count: 7, ticksPerFrame: 8 },
      attack: { first: 8, count: 7, ticksPerFrame: 8 },
    });
    expect(MONSTER_SPRITES["G2_6"]?.animations.attack).toEqual({
      first: 8,
      count: 8,
      ticksPerFrame: 8,
    });
    // Fomor has no attack cycle of its own.
    expect(MONSTER_SPRITES["G3_2"]?.animations.attack).toBeUndefined();
    expect(MONSTER_SPRITES["G3_2"]?.animations.walk).toEqual({
      first: 1,
      count: 8,
      ticksPerFrame: 8,
    });
    // Korath: only the two 30-row sheets can stomp.
    expect(MONSTER_SPRITES["G4_4"]?.animations.stomp).toBeUndefined();
    expect(MONSTER_SPRITES["G4_5"]?.animations.stomp).toEqual({
      first: 20,
      count: 10,
      ticksPerFrame: 8,
    });
    // Korath level 3 asks for rows 9-18 of an 18-row sheet; the phantom row is dropped.
    expect(MONSTER_SPRITES["G4_3"]?.rows).toBe(18);
    expect(MONSTER_SPRITES["G4_3"]?.animations.attack).toEqual({
      first: 9,
      count: 9,
      ticksPerFrame: 8,
    });
    // Krallen walks and idles on the same rows.
    expect(MONSTER_SPRITES["G5_1"]?.animations.idle).toEqual(MONSTER_SPRITES["G5_1"]?.animations.walk);
  });

  it("gives the classic creeps a single pose and the later ones their cycles", () => {
    for (const key of ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C10", "C11", "C12"]) {
      expect(MONSTER_SPRITES[key]?.animations, key).toEqual({
        walk: { first: 0, count: 1, ticksPerFrame: 8 },
      });
    }
    expect(MONSTER_SPRITES["C9"]?.animations.invisible).toEqual({ first: 1, count: 1, ticksPerFrame: 8 });
    expect(MONSTER_SPRITES["C14"]?.animations.walk).toEqual({ first: 0, count: 3, ticksPerFrame: 3 });
    expect(MONSTER_SPRITES["C19"]?.animations).toEqual({
      idle: { first: 1, count: 1, ticksPerFrame: 8 },
      walk: { first: 1, count: 5, ticksPerFrame: 8 },
    });
    expect(MONSTER_SPRITES["IC3"]?.animations.walk).toEqual({ first: 1, count: 8, ticksPerFrame: 8 });
    // Wormzer's burrow rows are not on its one-row sheet.
    expect(MONSTER_SPRITES["C13"]?.rows).toBe(1);
    expect(MONSTER_SPRITES["C13"]?.animations.burrowed).toBeUndefined();
  });

  it("draws a shadow under flyers only (CreepBase.as:118-125, :1709-1728)", () => {
    for (const sheet of sheets) {
      const flies = sheet.movement === "fly" || sheet.movement === "fly_low";
      expect(sheet.shadow !== null, sheet.key).toBe(flies);
    }
    expect(MONSTER_SPRITES["C14"]?.shadow).toBe("shadow");
    expect(MONSTER_SPRITES["C16"]?.shadow).toBe("shadow");
    expect(MONSTER_SPRITES["IC5"]?.shadow).toBe("shadow");
    expect(MONSTER_SPRITES["C15"]?.shadow).toBe("bigshadow");
    // Fomor takes off at level 3 (CHAMPIONCAGE.as:160).
    expect(MONSTER_SPRITES["G3_2"]?.shadow).toBeNull();
    expect(MONSTER_SPRITES["G3_3"]?.shadow).toBe("bigshadow");
    expect(MONSTER_SPRITES["G1_1"]?.shadow).toBeNull();
  });

  it("folds the CHAMPIONCAGE offsets into the champion anchors", () => {
    // `offset_x: [-48, ...]`, `offset_y: [-38, ...]` for G1 (CHAMPIONCAGE.as:74-75).
    expect(MONSTER_SPRITES["G1_1"]).toMatchObject({ anchorX: 48, anchorY: 38 });
    expect(MONSTER_SPRITES["G4_6"]).toMatchObject({ anchorX: 70, anchorY: 130 });
    // Creeps keep the SpriteData anchor as written (`SPRITES.as:25`).
    expect(MONSTER_SPRITES["C1"]).toMatchObject({ anchorX: 8, anchorY: 14, frameWidth: 24, frameHeight: 21 });
  });

  it("knows the Golden D.A.V.E. skin and nothing else", () => {
    expect(MONSTER_SPRITES["C12"]?.skins).toEqual(["C12Gold"]);
    expect(MONSTER_SPRITES["C12Gold"]).toMatchObject({ frameWidth: 53, frameHeight: 46, skins: [] });
    expect(sheets.filter((one) => one.skins.length > 0).map((one) => one.key)).toEqual(["C12"]);
  });

  it("has every repaint on disk at its scale times the original's size", () => {
    for (const [original, repaint] of Object.entries(REPAINTED_SHEETS)) {
      const sheet = sheets.find((one) => one.file === original);
      expect(sheet, original).toBeDefined();
      if (!sheet) continue;
      const scale = Number(/@(\d+)x\./.exec(repaint)?.[1] ?? 1);
      // A repaint with its own layout (more or fewer rows, taller cells, packed) sizes by that layout.
      const { width, height } = applyLayout(sheet);
      expect(pngSize(`${ASSETS}${repaint}`), repaint).toEqual({
        width: width * scale,
        height: height * scale,
      });
    }
  });

  // The Quality setting (`game/quality.ts`) draws these on Medium and Low; a
  // painting without them would show nothing there. `web/tools/sheet_copies.py`
  // makes them, and the animated kits' `shrink-sheet.py` runs it.
  it("has a half-size and a 1x copy beside every painted sheet", () => {
    expect(paintings.length).toBeGreaterThan(30);
    for (const { file, scale, half, halfScale, one } of paintings) {
      const painted = pngSize(`${ASSETS}${file}`);
      for (const [copy, times] of [[half, halfScale], [one, 1]] as const) {
        expect(existsSync(`${ASSETS}${copy}`), `${copy} is missing: run python web/tools/sheet_copies.py`).toBe(true);
        expect(pngSize(`${ASSETS}${copy}`), copy).toEqual({
          width: (painted.width * times) / scale,
          height: (painted.height * times) / scale,
        });
      }
      // Made from this painting, not an older one: the copy names it and its byte size.
      const made = `${file.split("/").pop()} ${statSync(`${ASSETS}${file}`).size}`;
      expect(pngNotes(`${ASSETS}${half}`)["bymr-copy-of"], `${half} is stale: run python web/tools/sheet_copies.py`).toBe(made);
      const oneMark = pngNotes(`${ASSETS}${one}`)["bymr-copy-of"];
      if (oneMark !== undefined) expect(oneMark, one).toBe(made);
    }
  });

  it("asks for every painting and copy with its current version (sheetVersions.ts)", () => {
    const want: Record<string, string> = {};
    for (const { file, half, one } of paintings) {
      for (const path of [file, half, one]) want[path] = statSync(`${ASSETS}${path}`).size.toString(36);
    }
    expect(SHEET_VERSIONS, "out of date: run python web/tools/sheet_copies.py").toEqual(want);
  });

  it("paints Krallen's and Korath's ground shadow into every sheet and copy, once", () => {
    // Without the Flash sheets' baked shadow she looked as if she floated
    // (owner, 2026-10-25). `web/tools/add-champ-ground-shadow.py` marks a sheet
    // it has shadowed with a tEXt chunk ahead of the pixels, and refuses one
    // already marked.
    const keys = ["G5_1", "G5_2", "G5_3", "G4_1", "G4_2", "G4_3", "G4_4", "G4_5", "G4_6"];
    for (const key of keys) {
      const repaint = REPAINTED_SHEETS[MONSTER_SPRITES[key]?.file ?? ""];
      expect(repaint, key).toBeDefined();
      const copies = sheetCopies(repaint ?? "");
      for (const file of [repaint ?? "", copies?.medium ?? "", copies?.low ?? ""]) {
        const head = Buffer.alloc(256);
        const handle = openSync(`${ASSETS}${file}`, "r");
        try {
          readSync(handle, head, 0, 256, 0);
        } finally {
          closeSync(handle);
        }
        expect(head.toString("latin1"), file).toContain("tEXtbymr-ground-shadow");
      }
    }
  });
});
