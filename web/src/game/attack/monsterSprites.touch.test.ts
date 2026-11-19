// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MONSTER_SPRITES } from "@/game/attack/monsterSpriteData";
import { REPAINTED_SHEETS, sheetStandInUrl, sheetUrl } from "@/game/attack/monsterSprites";
import { monsterSheetLevel, setDeviceDefaultQuality, setDeviceTextureLimit } from "@/game/quality";
import { SAFE_MODE_KEY } from "@/game/safeMode";
import { setTouchDevice } from "@/game/touchDevice";

/**
 * Patch 7.11: a phone or tablet never draws its monsters from the `@4x`
 * sheets, even when the player chose High: iOS closed the tab on a yard of
 * them. Both ways of asking `sheetUrl` (a sheet's table row, or its file
 * name) are capped.
 */

const SHEETS = Object.values(MONSTER_SPRITES);
const sheetOf = (file: string) => {
  const sheet = SHEETS.find((one) => one.file === file);
  if (!sheet) throw new Error(`no sheet ${file}`);
  return sheet;
};

/** Painted at 4x, 3x and 2x. */
const POKEY = sheetOf("monsters/sprite.1.v1.png");
const KORATH_4 = sheetOf("monsters/korath_4.png");
const KORATH_5 = sheetOf("monsters/korath_5.png");

const bare = (url: string): string => url.replace(/\?v=.*$/, "");
/** The URL by both ways of asking: the sheet's row (`sheetForDevice`) and its file name (`sheetAtQuality`). */
const both = (sheet: { file: string }): [string, string] => [
  bare(sheetUrl(sheet as (typeof SHEETS)[number])),
  bare(sheetUrl(sheet.file)),
];

describe("monster sheets on a phone or tablet (patch 7.11)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setDeviceDefaultQuality("high");
    // An iPhone's limit: nothing steps down because of the graphics card.
    setDeviceTextureLimit(16384);
  });
  afterEach(() => {
    window.localStorage.clear();
    setTouchDevice(null);
    setDeviceDefaultQuality(null);
    setDeviceTextureLimit(null);
  });

  it("a chosen High on a touch device draws the @2x copy, through both branches; Korath 5 the @1.5x", () => {
    window.localStorage.setItem("bymr.quality", "high");
    setTouchDevice(true);
    expect(both(POKEY)).toEqual(["/assets/monsters/pokey-anim@2x.png", "/assets/monsters/pokey-anim@2x.png"]);
    expect(both(KORATH_4)).toEqual([
      "/assets/monsters/korath_4-repaint@2x.png",
      "/assets/monsters/korath_4-repaint@2x.png",
    ]);
    expect(both(KORATH_5)).toEqual([
      "/assets/monsters/korath_5-repaint@1.5x.png",
      "/assets/monsters/korath_5-repaint@1.5x.png",
    ]);
    // No painted sheet at all is asked for at more than 2x.
    for (const sheet of SHEETS) {
      if (!REPAINTED_SHEETS[sheet.file]) continue;
      for (const url of both(sheet)) expect(url, sheet.file).not.toMatch(/@[34]x\./);
    }
    // The 1x stand-in is still the smaller copy.
    expect(bare(sheetStandInUrl(POKEY) ?? "")).toBe("/assets/monsters/pokey-anim.png");
  });

  it("a chosen High on a desktop draws the painted sheet (@4x, @3x, Korath 5 @2x), through both branches", () => {
    window.localStorage.setItem("bymr.quality", "high");
    setTouchDevice(false);
    expect(both(POKEY)).toEqual(["/assets/monsters/pokey-anim@4x.png", "/assets/monsters/pokey-anim@4x.png"]);
    expect(both(KORATH_4)[0]).toBe("/assets/monsters/korath_4-repaint@3x.png");
    expect(both(KORATH_5)).toEqual([
      "/assets/monsters/korath_5-repaint@2x.png",
      "/assets/monsters/korath_5-repaint@2x.png",
    ]);
  });

  it("Medium and Low are the same on both kinds of device", () => {
    for (const touch of [true, false]) {
      setTouchDevice(touch);
      window.localStorage.setItem("bymr.quality", "medium");
      expect(both(POKEY)).toEqual(["/assets/monsters/pokey-anim@2x.png", "/assets/monsters/pokey-anim@2x.png"]);
      expect(both(KORATH_5)[0]).toBe("/assets/monsters/korath_5-repaint@1.5x.png");
      window.localStorage.setItem("bymr.quality", "low");
      expect(both(POKEY)).toEqual(["/assets/monsters/pokey-anim.png", "/assets/monsters/pokey-anim.png"]);
      expect(both(KORATH_5)).toEqual(["/assets/monsters/korath_5-repaint.png", "/assets/monsters/korath_5-repaint.png"]);
    }
  });

  it("a touch device that never chose is on Medium's copies; the texture limit still steps a sheet down", () => {
    setTouchDevice(true);
    setDeviceDefaultQuality(null);
    expect(both(POKEY)).toEqual(["/assets/monsters/pokey-anim@2x.png", "/assets/monsters/pokey-anim@2x.png"]);
    // A card that cannot hold the @2x copy gets the 1x one, as before.
    setDeviceTextureLimit(Math.max(POKEY.width, POKEY.height) + 1);
    expect(both(POKEY)[0]).toBe("/assets/monsters/pokey-anim.png");
    setTouchDevice(false);
    window.localStorage.setItem("bymr.quality", "high");
    expect(both(POKEY)[0]).toBe("/assets/monsters/pokey-anim.png");
  });

  it("safe mode's cap lowers the sheets on any device", () => {
    window.localStorage.setItem("bymr.quality", "high");
    window.localStorage.setItem(SAFE_MODE_KEY, '{"cap":"low","loads":{}}');
    for (const touch of [true, false]) {
      setTouchDevice(touch);
      expect(both(POKEY)).toEqual(["/assets/monsters/pokey-anim.png", "/assets/monsters/pokey-anim.png"]);
    }
  });

  it("monsterSheetLevel caps only High, only on touch", () => {
    expect(monsterSheetLevel("high", true)).toBe("medium");
    expect(monsterSheetLevel("high", false)).toBe("high");
    for (const touch of [true, false]) {
      expect(monsterSheetLevel("medium", touch)).toBe("medium");
      expect(monsterSheetLevel("low", touch)).toBe("low");
    }
  });
});
