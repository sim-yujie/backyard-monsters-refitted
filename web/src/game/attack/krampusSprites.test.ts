import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setClassicLook } from "@/game/classicLook";
import { setQuality, sheetCopies } from "@/game/quality";
import { auraEllipse } from "./frostAuraFx";
import { KRAMPUS_SPRITES } from "./krampusSprites";
import { REPAINTED_SHEETS, directionColumn, sheetUrl, spriteFor } from "./monsterSprites";

const ASSETS = fileURLToPath(new URL("../../../../server/public/assets/", import.meta.url));
const bare = (url: string): string => url.replace(/^.*?\/assets\//, "/assets/").split("?")[0] ?? "";

describe("Krampus's battle sheets (G6, beta 10)", () => {
  beforeEach(() => {
    const kept = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => kept.set(key, value) },
    });
  });
  afterEach(() => {
    setClassicLook(false);
    vi.unstubAllGlobals();
  });

  it("gives each level its own sheet, growing", () => {
    const widths = [1, 2, 3, 4, 5, 6].map((level) => {
      const sheet = spriteFor("G6", level);
      expect(sheet?.key).toBe(`G6_${level}`);
      return sheet?.frameHeight ?? 0;
    });
    expect([...widths].sort((a, b) => a - b)).toEqual(widths);
  });

  it("draws the painting with the Modern look and the Flash-tone sheet with Classic, every file on disk", () => {
    setQuality("high");
    for (const sheet of Object.values(KRAMPUS_SPRITES)) {
      const painted = REPAINTED_SHEETS[sheet.file];
      expect(painted).toBe(sheet.file.replace(".png", "-anim@2x.png"));
      const copies = sheetCopies(painted ?? "");
      for (const file of [sheet.file, painted ?? "", copies?.medium ?? "", copies?.low ?? ""]) {
        expect(existsSync(`${ASSETS}${file}`), file).toBe(true);
      }
    }
    expect(bare(sheetUrl(spriteFor("G6", 3)!))).toBe("/assets/monsters/krampus_3-anim@2x.png");
    setClassicLook(true);
    expect(bare(sheetUrl(spriteFor("G6", 3)!))).toBe("/assets/monsters/krampus_3.png");
  });

  it("turns 8 ways: right is column 0, towards the viewer 2, left 4, away 6", () => {
    const sheet = spriteFor("G6", 1)!;
    const column = (degrees: number) => directionColumn((degrees * Math.PI) / 180, sheet.directions, sheet.directionOffset);
    expect([0, 90, 180, 270, 135, 350].map(column)).toEqual([0, 2, 4, 6, 3, 0]);
  });

  it("draws the frost aura as the yard circle seen on screen", () => {
    expect(auraEllipse(200).rx).toBeCloseTo(282.84, 1);
    expect(auraEllipse(200).ry).toBeCloseTo(141.42, 1);
  });
});
