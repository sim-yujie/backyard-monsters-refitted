import { afterEach, describe, expect, it } from "vitest";
import { MONSTER_SPRITES } from "@/game/attack/monsterSpriteData";
import {
  directionColumn,
  MIRRORED_HEADINGS,
  REPAINT_LAYOUTS,
  REPAINTED_SHEETS,
  sheetColumn,
  sheetUrl,
  spriteFor,
} from "@/game/attack/monsterSprites";
import { championPortrait, monsterPortrait } from "@/game/portraits";
import { tierArtFor } from "@/game/yard/buildingArtTiers";
import {
  CLASSIC_ART_KEY,
  OLD_CLASSIC_ART_KEY,
  classicArt,
  saveClassicArt,
  savedClassicArt,
  setClassicArt,
} from "./classicArt";

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

afterEach(() => setClassicArt(false));

describe("the saved choice", () => {
  it("is off by default and is what Account Settings saved, read at the next load", () => {
    const store = memoryStore();
    expect(classicArt()).toBe(false);
    expect(savedClassicArt(store)).toBe(false);
    expect(saveClassicArt(true, store)).toBe(true);
    expect(store.getItem(CLASSIC_ART_KEY)).toBe("1");
    expect(savedClassicArt(store)).toBe(true);
    expect(saveClassicArt(false, store)).toBe(true);
    expect(savedClassicArt(store)).toBe(false);
    // Saving does not redraw the page that is open.
    expect(classicArt()).toBe(false);
  });

  it("still reads the old building-only key, and turning it off clears that too", () => {
    const store = memoryStore();
    store.setItem(OLD_CLASSIC_ART_KEY, "1");
    expect(savedClassicArt(store)).toBe(true);
    expect(saveClassicArt(false, store)).toBe(true);
    expect(store.getItem(OLD_CLASSIC_ART_KEY)).toBeNull();
    expect(savedClassicArt(store)).toBe(false);
  });

  it("reads as off when site data is blocked, and says it could not save", () => {
    expect(saveClassicArt(true, blockedStore())).toBe(false);
    expect(saveClassicArt(true, null)).toBe(false);
    expect(savedClassicArt(blockedStore())).toBe(false);
  });
});

describe("monsters and champions", () => {
  it("has repainted and re-laid sheets to test", () => {
    expect(REPAINTED.length).toBeGreaterThan(10);
    expect(RELAID.length).toBeGreaterThan(5);
  });

  it("draw the repaint and its layout with Classic art off", () => {
    for (const sheet of REPAINTED) expect(sheetUrl(sheet)).toBe(`/assets/${REPAINTED_SHEETS[sheet.file]}`);
    for (const sheet of RELAID) {
      const drawn = spriteFor(sheet.key);
      const layout = REPAINT_LAYOUTS[sheet.file];
      expect(drawn, sheet.key).not.toBe(sheet);
      expect(drawn?.frameWidth).toBe(layout?.frameWidth ?? sheet.frameWidth);
      expect(drawn?.anchorY).toBe(layout?.anchorY ?? sheet.anchorY);
    }
  });

  it("draw the Flash sheet with the Flash table row with Classic art on", () => {
    setClassicArt(true);
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
    setClassicArt(true);
    expect(sheetColumn(ichi, 0)).toBe(flash);
  });

  it("pick a champion's level sheet the same way either way", () => {
    const off = spriteFor("G1", 3);
    setClassicArt(true);
    expect(spriteFor("G1", 3)?.key).toBe(off?.key);
  });
});

describe("the other repainted art", () => {
  it("shows the original portraits with Classic art on", () => {
    expect(monsterPortrait("C1", "card").src).toContain("/portraits/");
    expect(championPortrait("G1", 2, "icon").src).toContain("/portraits/");
    setClassicArt(true);
    expect(monsterPortrait("C1", "card")).toEqual({ src: "/assets/monsters/C1-portrait.jpg", fallback: null });
    expect(championPortrait("G1", 2, "icon")).toEqual({ src: "/assets/monsters/G1_L2-small.png", fallback: null });
  });

  it("shows the Flash Town Hall with Classic art on", () => {
    expect(tierArtFor(14, 6)).not.toBeNull();
    setClassicArt(true);
    expect(tierArtFor(14, 6)).toBeNull();
  });
});
