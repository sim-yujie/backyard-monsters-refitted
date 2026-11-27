import { closeSync, existsSync, openSync, readSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setClassicLook } from "@/game/classicLook";
import { setQuality } from "@/game/quality";
import { MONSTER_SPRITES } from "./monsterSpriteData";
import { creepSkin, devSkins, FROST_MONSTERS, hasSkin, skinFile, skinnedSheet } from "./monsterSkins";
import { REPAINTED_SHEETS, sheetStandInUrl, sheetUrl, spriteFor } from "./monsterSprites";

const ASSETS = fileURLToPath(new URL("../../../../server/public/assets/", import.meta.url));
const bare = (url: string): string => url.replace(/^.*?\/assets\//, "/assets/").split("?")[0] ?? "";

/** A PNG's width and height from its header. */
const pngSize = (path: string): [number, number] => {
  const fd = openSync(path, "r");
  const head = Buffer.alloc(24);
  readSync(fd, head, 0, 24, 0);
  closeSync(fd);
  return [head.readUInt32BE(16), head.readUInt32BE(20)];
};

describe("monster skins (frost tribe)", () => {
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

  it("covers roster C: Pokey, Eye-ra, Ichi, Fang, Brain, Crabatron, Teratorn, Vorg", () => {
    expect([...FROST_MONSTERS].sort()).toEqual(["C1", "C10", "C14", "C16", "C5", "C6", "C8", "C9"]);
  });

  it("puts a skin's copy of a file in a folder named after it", () => {
    expect(skinFile("monsters/pokey-anim@4x.png", "frost")).toBe("monsters/frost/pokey-anim@4x.png");
  });

  it("draws a frost monster from the frost files, with its own cache key and the base layout", () => {
    setQuality("high");
    const normal = spriteFor("C1", 1);
    const frost = spriteFor("C1", 1, "frost");
    expect(frost?.key).toBe("C1~frost");
    expect(frost?.file).toBe(normal?.file);
    expect(frost?.frameWidth).toBe(normal?.frameWidth);
    expect(frost?.animations).toEqual(normal?.animations);
    expect(bare(sheetUrl(frost!))).toBe("/assets/monsters/frost/pokey-anim@4x.png");
    expect(bare(sheetUrl(normal!))).toBe("/assets/monsters/pokey-anim@4x.png");
    expect(bare(sheetStandInUrl(frost!) ?? "")).toBe("/assets/monsters/frost/pokey-anim.png");
    // The same object each time, so the layout and texture caches hold.
    expect(spriteFor("C1", 1, "frost")).toBe(frost);
  });

  it("draws the Flash frost sheet with the Classic look on", () => {
    setClassicLook(true);
    const frost = spriteFor("C8", 1, "frost");
    expect(bare(sheetUrl(frost!))).toBe("/assets/monsters/frost/fang.png");
  });

  it("leaves a monster without frost art as itself", () => {
    expect(hasSkin("C2", "frost")).toBe(false);
    expect(spriteFor("C2", 1, "frost")).toBe(spriteFor("C2", 1));
  });

  it("gives each side its own skin, only to monsters that have it", () => {
    const skins = { attackers: "frost" } as const;
    expect(creepSkin(skins, "C1", false)).toBe("frost");
    expect(creepSkin(skins, "C1", true)).toBeUndefined();
    expect(creepSkin(skins, "C2", false)).toBeUndefined();
    expect(creepSkin(null, "C1", false)).toBeUndefined();
    expect(creepSkin({ defenders: "frost" }, "C14", true)).toBe("frost");
  });

  it("has every frost file on disk at the size of the file it recolours (Flash sheet and each Quality copy)", () => {
    for (const id of FROST_MONSTERS) {
      const sheet = MONSTER_SPRITES[id]!;
      const painted = REPAINTED_SHEETS[sheet.file]!;
      const name = painted.replace(/@4x\.png$/, "");
      const files = [sheet.file, painted, `${name}@2x.png`, `${name}.png`];
      for (const file of files) {
        const frost = skinFile(file, "frost");
        expect(existsSync(`${ASSETS}${frost}`), frost).toBe(true);
        expect(pngSize(`${ASSETS}${frost}`), frost).toEqual(pngSize(`${ASSETS}${file}`));
      }
      expect(skinnedSheet(sheet, "frost").key).toBe(`${id}~frost`);
    }
  });
});

describe("devSkins", () => {
  it("reads ?monsterSkin=frost and ?defenderSkin=frost, and nothing else", () => {
    expect(devSkins("?monsterSkin=frost")).toEqual({ skins: { attackers: "frost" } });
    expect(devSkins("?defenderSkin=frost&monsterSkin=frost")).toEqual({ skins: { attackers: "frost", defenders: "frost" } });
    expect(devSkins("?monsterSkin=gold&skin=auto")).toEqual({});
  });
});
