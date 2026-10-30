import { afterEach, describe, expect, it } from "vitest";
import { MONSTER_SPRITES } from "@/game/attack/monsterSpriteData";
import {
  directionColumn,
  frameRow,
  MIRRORED_HEADINGS,
  REPAINT_LAYOUTS,
  REPAINTED_SHEETS,
  sheetColumn,
  sheetUrl,
  spriteFor,
} from "@/game/attack/monsterSprites";
import { championPortrait, monsterPortrait } from "@/game/portraits";
import { splashLook } from "@/game/attack/punchyMoments";
import { TUNES, tuneFile } from "@/game/sound/tunes";
import { tierArtFor } from "@/game/yard/buildingArtTiers";
import {
  CLASSIC_LOOK_KEY,
  OLD_CLASSIC_LOOK_KEYS,
  classicLook,
  saveClassicLook,
  savedClassicLook,
  setClassicLook,
} from "./classicLook";

/** A browser's site data, kept in memory. */
const memoryStore = (): Storage => {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  } as unknown as Storage;
};

const blockedStore = (): Storage =>
  ({
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  }) as unknown as Storage;

const SHEETS = Object.values(MONSTER_SPRITES);
const REPAINTED = SHEETS.filter((sheet) => REPAINTED_SHEETS[sheet.file] !== undefined);
const RELAID = SHEETS.filter((sheet) => REPAINT_LAYOUTS[sheet.file] !== undefined);

afterEach(() => setClassicLook(false));

describe("the saved choice", () => {
  it("is off by default and is what Account Settings saved, read at the next load", () => {
    const store = memoryStore();
    expect(classicLook()).toBe(false);
    expect(savedClassicLook(store)).toBe(false);
    expect(saveClassicLook(true, store)).toBe(true);
    expect(store.getItem(CLASSIC_LOOK_KEY)).toBe("classic");
    expect(savedClassicLook(store)).toBe(true);
    expect(saveClassicLook(false, store)).toBe(true);
    expect(savedClassicLook(store)).toBe(false);
    // Saving does not redraw the page that is open.
    expect(classicLook()).toBe(false);
  });

  it.each(OLD_CLASSIC_LOOK_KEYS)(
    "still reads the old key %s, and turning Classic off clears it",
    (key) => {
      const store = memoryStore();
      store.setItem(key, "1");
      expect(savedClassicLook(store)).toBe(true);
      expect(saveClassicLook(true, store)).toBe(true);
      // Saving moves the choice to the new key.
      expect(store.getItem(key)).toBeNull();
      expect(store.getItem(CLASSIC_LOOK_KEY)).toBe("classic");
      store.setItem(key, "1");
      expect(saveClassicLook(false, store)).toBe(true);
      expect(store.getItem(key)).toBeNull();
      expect(savedClassicLook(store)).toBe(false);
    },
  );

  it("reads as off when site data is blocked, and says it could not save", () => {
    expect(saveClassicLook(true, blockedStore())).toBe(false);
    expect(saveClassicLook(true, null)).toBe(false);
    expect(savedClassicLook(blockedStore())).toBe(false);
  });
});

describe("monsters and champions", () => {
  it("has repainted and re-laid sheets to test", () => {
    expect(REPAINTED.length).toBeGreaterThan(10);
    expect(RELAID.length).toBeGreaterThan(5);
  });

  it("draw the repaint and its layout with Classic art off", () => {
    for (const sheet of REPAINTED)
      expect(sheetUrl(sheet).replace(/\?v=.*$/, "")).toBe(`/assets/${REPAINTED_SHEETS[sheet.file]}`);
    for (const sheet of RELAID) {
      const drawn = spriteFor(sheet.key);
      const layout = REPAINT_LAYOUTS[sheet.file];
      expect(drawn, sheet.key).not.toBe(sheet);
      expect(drawn?.frameWidth).toBe(layout?.frameWidth ?? sheet.frameWidth);
      expect(drawn?.anchorY).toBe(layout?.anchorY ?? sheet.anchorY);
    }
  });

  it("draw the Flash sheet with the Flash table row with Classic art on", () => {
    setClassicLook(true);
    for (const sheet of SHEETS) {
      expect(sheetUrl(sheet)).toBe(`/assets/${sheet.file}`);
      // The table row itself: Flash's cells, anchor, rows and cycles, no strike frame.
      expect(spriteFor(sheet.key), sheet.key).toBe(sheet);
    }
    expect(sheetUrl(RELAID[0]!.file)).toBe(`/assets/${RELAID[0]!.file}`);
  });

  it("face true on the Flash sheet of a monster whose repaint was painted mirror-image", () => {
    const ichi = SHEETS.find((sheet) => MIRRORED_HEADINGS.has(sheet.file))!;
    const flash = directionColumn(0, ichi.directions, ichi.directionOffset);
    expect(sheetColumn(ichi, 0)).not.toBe(flash);
    setClassicLook(true);
    expect(sheetColumn(ichi, 0)).toBe(flash);
  });

  it("draw Korath from Flash's sheets in Classic, stomping only with Flash's own rows", () => {
    const korath = [1, 2, 3, 4, 5, 6].map((level) => MONSTER_SPRITES[`G4_${level}`]!);
    for (const sheet of korath) expect(REPAINTED_SHEETS[sheet.file], sheet.key).toMatch(/-repaint@\dx\.png$/);
    setClassicLook(true);
    for (const [index, sheet] of korath.entries()) {
      const level = index + 1;
      expect(spriteFor("G4", level), sheet.key).toBe(sheet);
      expect(sheetUrl(sheet)).toBe(`/assets/monsters/korath_${level}.png`);
      if (level > 4) {
        // Only levels 5 and 6 quake (`hasQuake`), and Flash's own sheet
        // carries the stomp: rows 20-29 of its 30 (`Korath.as:146-149`).
        expect(sheet.animations.stomp).toEqual({ first: 20, count: 10, ticksPerFrame: 8 });
        expect(sheet.rows * sheet.frameHeight).toBe(sheet.height);
        expect([0, 48, 72].map((tick) => frameRow(sheet, "stomp", tick))).toEqual([20, 26, 29]);
      } else {
        // No stomp in Flash's sheet, so none is drawn: it keeps walking.
        expect(sheet.animations.stomp, sheet.key).toBeUndefined();
        expect(frameRow(sheet, "stomp", 48)).toBe(frameRow(sheet, "walk", 48));
      }
    }
  });

  it("pick a champion's level sheet the same way either way", () => {
    const off = spriteFor("G1", 3);
    setClassicLook(true);
    expect(spriteFor("G1", 3)?.key).toBe(off?.key);
  });
});

describe("the other repainted art", () => {
  it("shows the original portraits with Classic art on", () => {
    expect(monsterPortrait("C1", "card").src).toContain("/portraits/");
    expect(championPortrait("G1", 2, "icon").src).toContain("/portraits/");
    setClassicLook(true);
    expect(monsterPortrait("C1", "card")).toEqual({
      src: "/assets/monsters/C1-portrait.jpg",
      fallback: null,
    });
    expect(championPortrait("G1", 2, "icon")).toEqual({
      src: "/assets/monsters/G1_L2-small.png",
      fallback: null,
    });
  });

  it("shows the Flash Town Hall with Classic art on", () => {
    expect(tierArtFor(14, 6)).not.toBeNull();
    setClassicLook(true);
    expect(tierArtFor(14, 6)).toBeNull();
  });
});

describe("battle effects and music", () => {
  it("gives every splash Flash's rings, Eye-ra's fireball included", () => {
    expect(splashLook("C5")).toBe("fiery");
    expect(splashLook("C5", true)).toBe("rings");
  });

  it("plays Flash's own yard tune, and the same attack tune either way", () => {
    expect(tuneFile("yard", false)).toBe(TUNES.yard);
    expect(tuneFile("yard", false).url).toContain("yard-theme");
    expect(tuneFile("yard", true).url).toBe("/assets/sounds/music/Music_Building.mp3");
    expect(tuneFile("yard", true).ogg).toBeUndefined();
    expect(tuneFile("attack", true)).toBe(tuneFile("attack", false));
    setClassicLook(true);
    expect(tuneFile("yard").url).toContain("Music_Building");
  });
});
