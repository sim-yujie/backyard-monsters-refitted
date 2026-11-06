import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { CreepSnapshot } from "@/game/combat/rules/engine";
import { MONSTER_SPRITES } from "./monsterSpriteData";
import { layoutCreep } from "./AttackBattleLayer";
import {
  anchorOffset,
  applyLayout,
  attackRow,
  frameRect,
  frameRow,
  REPAINT_LAYOUTS,
  sheetUrl,
  spriteFor,
  type SheetLayoutOverride,
} from "./monsterSprites";

/**
 * The repaint animation layout (a 12-row sheet for a monster that has one row
 * in the Flash table) and which row an attacking, walking or standing monster
 * shows. The layout here is a made-up one on Pokey's real table row; no art.
 */

const POKEY = MONSTER_SPRITES["C1"];
if (!POKEY) throw new Error("no C1");

/** Row 0 idle, rows 1-6 walk, rows 7-11 attack (wind-up, strike, 3 more); taller cells. */
const TWELVE_ROWS: SheetLayoutOverride = {
  frameHeight: 40,
  anchorY: 31,
  rows: 12,
  animations: {
    idle: { first: 0, count: 1, ticksPerFrame: 8 },
    walk: { first: 1, count: 6, ticksPerFrame: 8 },
    attack: { first: 7, count: 5, ticksPerFrame: 4 },
  },
  strikeFrame: 1,
};
const LAYOUTS = { [POKEY.file]: TWELVE_ROWS };

const creepOf = (overrides: Partial<CreepSnapshot> = {}): CreepSnapshot => ({
  id: 1,
  monsterId: "C1",
  level: 1,
  champion: false,
  friendly: false,
  ix: 100,
  iy: 100,
  hp: 200,
  maxHp: 200,
  flying: false,
  state: "walking",
  targetBuilding: -1,
  targetCreep: -1,
  ...overrides,
});

describe("applyLayout", () => {
  it("returns the table sheet untouched when the file has no layout", () => {
    expect(applyLayout(POKEY, {})).toBe(POKEY);
  });

  it("ships only the Bandito, Pokey, Bolt, Fink, Eye-ra, Fang, Ichi, Crabatron, Brain, D.A.V.E. (both skins), Project X, Wormzer, Zafreeti, Vorg, Teratorn, Octo-ooze, Rezghul, Slimeattikus (big and mini) and Korath 5 and 6 layouts, so every other sheet is exactly the Flash table", () => {
    expect(Object.keys(REPAINT_LAYOUTS).sort()).toEqual([
      "monsters/13.png",
      "monsters/14.v1.png",
      "monsters/bandito.png",
      "monsters/brain.v2.png",
      "monsters/crabatron.png",
      "monsters/eyera.png",
      "monsters/fang.png",
      "monsters/fink.png",
      "monsters/ichi.png",
      "monsters/korath_5.png",
      "monsters/korath_6.png",
      "monsters/octoooze.png",
      "monsters/rezghul.png",
      "monsters/slimeattikus_anim.png",
      "monsters/slimeattikusmini_anim.png",
      "monsters/sprite.1.v1.png",
      "monsters/sprite.11.v2.png",
      "monsters/sprite.12.gold.png",
      "monsters/sprite.12.v2.png",
      "monsters/sprite.3.v2.png",
      "monsters/vorg_anim.png",
      "monsters/zafreeti.v2.png",
    ]);
    const other = MONSTER_SPRITES["IC8"];
    if (!other) throw new Error("no IC8");
    expect(spriteFor("IC8")).toBe(other);
  });

  it("the Pokey layout matches the animated PNG and keeps the ball where it was", () => {
    const sheet = spriteFor("C1");
    if (!sheet) throw new Error("no sprite for C1");
    const png = readFileSync(
      resolve(__dirname, "../../../../server/public/assets/monsters/pokey-anim@4x.png"),
    );
    expect(png.readUInt32BE(16)).toBe(sheet.width * 4);
    expect(png.readUInt32BE(20)).toBe(sheet.height * 4);
    expect(sheet.frameWidth * sheet.columns * 4).toBe(png.readUInt32BE(16));
    expect(sheet.frameHeight * sheet.rows * 4).toBe(png.readUInt32BE(20));
    // 6 px added left and right, 8 px added on top: the ball stays on the same ground point.
    expect(sheet.anchorX).toBe(POKEY.anchorX + 6);
    expect(sheet.anchorY).toBe(POKEY.anchorY + 8);
    expect(sheet.frameHeight - sheet.anchorY).toBe(POKEY.frameHeight - POKEY.anchorY);
    expect(sheet.frameWidth - sheet.anchorX).toBe(POKEY.frameWidth - POKEY.anchorX + 6);
    expect(sheet.animations.attack?.first).toBe(7);
    expect((sheet.animations.attack?.first ?? 0) + (sheet.animations.attack?.count ?? 0)).toBe(12);
    expect(sheet.strikeFrame).toBe(2);
  });

  it("the Bolt layout matches the animated PNG and keeps the worm where it was", () => {
    const old = MONSTER_SPRITES["C3"];
    if (!old) throw new Error("no C3");
    const sheet = spriteFor("C3");
    if (!sheet) throw new Error("no sprite for C3");
    const png = readFileSync(
      resolve(__dirname, "../../../../server/public/assets/monsters/bolt-anim@4x.png"),
    );
    expect(png.readUInt32BE(16)).toBe(sheet.width * 4);
    expect(png.readUInt32BE(20)).toBe(sheet.height * 4);
    expect(sheet.frameWidth * sheet.columns * 4).toBe(png.readUInt32BE(16));
    expect(sheet.frameHeight * sheet.rows * 4).toBe(png.readUInt32BE(20));
    // 6 px added left and right, 10 px added on top: the worm stays on the same ground point.
    expect(sheet.anchorX).toBe(old.anchorX + 6);
    expect(sheet.anchorY).toBe(old.anchorY + 10);
    expect(sheet.frameHeight - sheet.anchorY).toBe(old.frameHeight - old.anchorY);
    expect(sheet.frameWidth - sheet.anchorX).toBe(old.frameWidth - old.anchorX + 6);
    expect(sheet.animations.attack?.first).toBe(7);
    expect((sheet.animations.attack?.first ?? 0) + (sheet.animations.attack?.count ?? 0)).toBe(12);
    expect(sheet.strikeFrame).toBe(2);
  });

  it("the Fink layout matches the animated PNG and keeps the creature where it was", () => {
    const old = MONSTER_SPRITES["C4"];
    if (!old) throw new Error("no C4");
    const sheet = spriteFor("C4");
    if (!sheet) throw new Error("no sprite for C4");
    const png = readFileSync(
      resolve(__dirname, "../../../../server/public/assets/monsters/fink-anim@4x.png"),
    );
    expect(png.readUInt32BE(16)).toBe(sheet.width * 4);
    expect(png.readUInt32BE(20)).toBe(sheet.height * 4);
    expect(sheet.frameWidth * sheet.columns * 4).toBe(png.readUInt32BE(16));
    expect(sheet.frameHeight * sheet.rows * 4).toBe(png.readUInt32BE(20));
    // 6 px added left and right, 10 px added on top: the Fink stays on the same ground point.
    expect(sheet.anchorX).toBe(old.anchorX + 6);
    expect(sheet.anchorY).toBe(old.anchorY + 10);
    expect(sheet.frameHeight - sheet.anchorY).toBe(old.frameHeight - old.anchorY);
    expect(sheet.frameWidth - sheet.anchorX).toBe(old.frameWidth - old.anchorX + 6);
    expect(sheet.animations.attack?.first).toBe(7);
    expect((sheet.animations.attack?.first ?? 0) + (sheet.animations.attack?.count ?? 0)).toBe(12);
    expect(sheet.strikeFrame).toBe(2);
  });

  it("the Eye-ra layout matches the animated PNG and keeps the creature where it was", () => {
    const old = MONSTER_SPRITES["C5"];
    if (!old) throw new Error("no C5");
    const sheet = spriteFor("C5");
    if (!sheet) throw new Error("no sprite for C5");
    const png = readFileSync(
      resolve(__dirname, "../../../../server/public/assets/monsters/eyera-anim@4x.png"),
    );
    expect(png.readUInt32BE(16)).toBe(sheet.width * 4);
    expect(png.readUInt32BE(20)).toBe(sheet.height * 4);
    expect(sheet.frameWidth * sheet.columns * 4).toBe(png.readUInt32BE(16));
    expect(sheet.frameHeight * sheet.rows * 4).toBe(png.readUInt32BE(20));
    // 7 px added left and right, 9 px added on top: the Eye-ra stays on the same ground point.
    expect(sheet.anchorX).toBe(old.anchorX + 7);
    expect(sheet.anchorY).toBe(old.anchorY + 9);
    expect(sheet.frameHeight - sheet.anchorY).toBe(old.frameHeight - old.anchorY);
    expect(sheet.frameWidth - sheet.anchorX).toBe(old.frameWidth - old.anchorX + 7);
    expect(sheet.animations.attack?.first).toBe(7);
    expect((sheet.animations.attack?.first ?? 0) + (sheet.animations.attack?.count ?? 0)).toBe(12);
    expect(sheet.strikeFrame).toBe(2);
  });

  it("the Fang layout matches the animated PNG and keeps the creature where it was", () => {
    const old = MONSTER_SPRITES["C8"];
    if (!old) throw new Error("no C8");
    const sheet = spriteFor("C8");
    if (!sheet) throw new Error("no sprite for C8");
    const png = readFileSync(
      resolve(__dirname, "../../../../server/public/assets/monsters/fang-anim@4x.png"),
    );
    expect(png.readUInt32BE(16)).toBe(sheet.width * 4);
    expect(png.readUInt32BE(20)).toBe(sheet.height * 4);
    expect(sheet.frameWidth * sheet.columns * 4).toBe(png.readUInt32BE(16));
    expect(sheet.frameHeight * sheet.rows * 4).toBe(png.readUInt32BE(20));
    // 6 px added left and right, 11 px added on top: the Fang stays on the same ground point.
    expect(sheet.anchorX).toBe(old.anchorX + 6);
    expect(sheet.anchorY).toBe(old.anchorY + 11);
    expect(sheet.frameHeight - sheet.anchorY).toBe(old.frameHeight - old.anchorY);
    expect(sheet.frameWidth - sheet.anchorX).toBe(old.frameWidth - old.anchorX + 6);
    expect(sheet.animations.attack?.first).toBe(7);
    expect((sheet.animations.attack?.first ?? 0) + (sheet.animations.attack?.count ?? 0)).toBe(12);
    expect(sheet.strikeFrame).toBe(2);
  });

  it("the Ichi layout matches the animated PNG and keeps the creature where it was", () => {
    const old = MONSTER_SPRITES["C6"];
    if (!old) throw new Error("no C6");
    const sheet = spriteFor("C6");
    if (!sheet) throw new Error("no sprite for C6");
    const png = readFileSync(
      resolve(__dirname, "../../../../server/public/assets/monsters/ichi-anim@4x.png"),
    );
    expect(png.readUInt32BE(16)).toBe(sheet.width * 4);
    expect(png.readUInt32BE(20)).toBe(sheet.height * 4);
    expect(sheet.frameWidth * sheet.columns * 4).toBe(png.readUInt32BE(16));
    expect(sheet.frameHeight * sheet.rows * 4).toBe(png.readUInt32BE(20));
    // 10 px added left and right, 12 px added on top: the Ichi stays on the same ground point.
    expect(sheet.anchorX).toBe(old.anchorX + 10);
    expect(sheet.anchorY).toBe(old.anchorY + 12);
    expect(sheet.frameHeight - sheet.anchorY).toBe(old.frameHeight - old.anchorY);
    expect(sheet.frameWidth - sheet.anchorX).toBe(old.frameWidth - old.anchorX + 10);
    expect(sheet.animations.attack?.first).toBe(7);
    expect((sheet.animations.attack?.first ?? 0) + (sheet.animations.attack?.count ?? 0)).toBe(12);
    expect(sheet.strikeFrame).toBe(2);
  });

  it("the Crabatron layout matches the animated PNG and keeps the creature where it was", () => {
    const old = MONSTER_SPRITES["C10"];
    if (!old) throw new Error("no C10");
    const sheet = spriteFor("C10");
    if (!sheet) throw new Error("no sprite for C10");
    const png = readFileSync(
      resolve(__dirname, "../../../../server/public/assets/monsters/crabatron-anim@4x.png"),
    );
    expect(png.readUInt32BE(16)).toBe(sheet.width * 4);
    expect(png.readUInt32BE(20)).toBe(sheet.height * 4);
    expect(sheet.frameWidth * sheet.columns * 4).toBe(png.readUInt32BE(16));
    expect(sheet.frameHeight * sheet.rows * 4).toBe(png.readUInt32BE(20));
    // 10 px added left and right, 12 px added on top: the Crabatron stays on the same ground point.
    expect(sheet.anchorX).toBe(old.anchorX + 10);
    expect(sheet.anchorY).toBe(old.anchorY + 12);
    expect(sheet.frameHeight - sheet.anchorY).toBe(old.frameHeight - old.anchorY);
    expect(sheet.frameWidth - sheet.anchorX).toBe(old.frameWidth - old.anchorX + 10);
    expect(sheet.animations.attack?.first).toBe(7);
    expect((sheet.animations.attack?.first ?? 0) + (sheet.animations.attack?.count ?? 0)).toBe(12);
    expect(sheet.strikeFrame).toBe(2);
  });

  it("the D.A.V.E. layouts (normal and gold) match the animated PNGs and keep the tank where it was", () => {
    const old = MONSTER_SPRITES["C12"];
    if (!old) throw new Error("no C12");
    for (const [id, png] of [["C12", "dave-anim@4x.png"], ["C12Gold", "dave-gold-anim@4x.png"]] as const) {
      const sheet = spriteFor(id);
      if (!sheet) throw new Error(`no sprite for ${id}`);
      const data = readFileSync(resolve(__dirname, `../../../../server/public/assets/monsters/${png}`));
      expect(data.readUInt32BE(16)).toBe(sheet.width * 4);
      expect(data.readUInt32BE(20)).toBe(sheet.height * 4);
      expect(sheet.frameWidth * sheet.columns * 4).toBe(data.readUInt32BE(16));
      expect(sheet.frameHeight * sheet.rows * 4).toBe(data.readUInt32BE(20));
      // 12 px added left and right, 14 px on top: the tank stays on the same ground point.
      expect(sheet.anchorX).toBe(old.anchorX + 12);
      expect(sheet.anchorY).toBe(old.anchorY + 14);
      expect(sheet.frameHeight - sheet.anchorY).toBe(old.frameHeight - old.anchorY);
      expect(sheet.frameWidth - sheet.anchorX).toBe(old.frameWidth - old.anchorX + 12);
      expect(sheet.animations.attack?.first).toBe(7);
      expect((sheet.animations.attack?.first ?? 0) + (sheet.animations.attack?.count ?? 0)).toBe(12);
      expect(sheet.strikeFrame).toBe(2);
    }
  });

  it("the Project X layout matches the animated PNG and keeps the creature where it was", () => {
    const old = MONSTER_SPRITES["C11"];
    if (!old) throw new Error("no C11");
    const sheet = spriteFor("C11");
    if (!sheet) throw new Error("no sprite for C11");
    const data = readFileSync(resolve(__dirname, "../../../../server/public/assets/monsters/projectx-anim@4x.png"));
    expect(data.readUInt32BE(16)).toBe(sheet.width * 4);
    expect(data.readUInt32BE(20)).toBe(sheet.height * 4);
    expect(sheet.frameWidth * sheet.columns * 4).toBe(data.readUInt32BE(16));
    expect(sheet.frameHeight * sheet.rows * 4).toBe(data.readUInt32BE(20));
    // 10 px added left and right, 12 px on top: the creature stays on the same ground point.
    expect(sheet.anchorX).toBe(old.anchorX + 10);
    expect(sheet.anchorY).toBe(old.anchorY + 12);
    expect(sheet.frameHeight - sheet.anchorY).toBe(old.frameHeight - old.anchorY);
    expect(sheet.frameWidth - sheet.anchorX).toBe(old.frameWidth - old.anchorX + 10);
    expect(sheet.animations.attack?.first).toBe(7);
    expect((sheet.animations.attack?.first ?? 0) + (sheet.animations.attack?.count ?? 0)).toBe(12);
    expect(sheet.strikeFrame).toBe(2);
  });

  it("the Wormzer layout matches the animated PNG and keeps the worm where it was", () => {
    const old = MONSTER_SPRITES["C13"];
    if (!old) throw new Error("no C13");
    const sheet = spriteFor("C13");
    if (!sheet) throw new Error("no sprite for C13");
    const data = readFileSync(resolve(__dirname, "../../../../server/public/assets/monsters/wormzer-anim@4x.png"));
    expect(data.readUInt32BE(16)).toBe(sheet.width * 4);
    expect(data.readUInt32BE(20)).toBe(sheet.height * 4);
    expect(sheet.columns).toBe(32);
    expect(sheet.frameWidth * sheet.columns * 4).toBe(data.readUInt32BE(16));
    expect(sheet.frameHeight * sheet.rows * 4).toBe(data.readUInt32BE(20));
    // 8 px added left and right, 14 px on top: the worm stays on the same ground point.
    expect(sheet.anchorX).toBe(old.anchorX + 8);
    expect(sheet.anchorY).toBe(old.anchorY + 14);
    expect(sheet.frameWidth - sheet.anchorX).toBe(old.frameWidth - old.anchorX + 8);
    expect(sheet.animations.attack?.first).toBe(7);
    expect((sheet.animations.attack?.first ?? 0) + (sheet.animations.attack?.count ?? 0)).toBe(12);
    expect(sheet.strikeFrame).toBe(2);
  });

  it("the Brain layout matches the animated PNG and keeps the creature where it was", () => {
    const old = MONSTER_SPRITES["C9"];
    if (!old) throw new Error("no C9");
    const sheet = spriteFor("C9");
    if (!sheet) throw new Error("no sprite for C9");
    const data = readFileSync(resolve(__dirname, "../../../../server/public/assets/monsters/brain-anim@4x.png"));
    expect(data.readUInt32BE(16)).toBe(sheet.width * 4);
    expect(data.readUInt32BE(20)).toBe(sheet.height * 4);
    expect(sheet.columns).toBe(30);
    expect(sheet.frameWidth * sheet.columns * 4).toBe(data.readUInt32BE(16));
    expect(sheet.frameHeight * sheet.rows * 4).toBe(data.readUInt32BE(20));
    // 6 px added left and right, 12 px on top: the creature stays on the same point.
    expect(sheet.anchorX).toBe(old.anchorX + 6);
    expect(sheet.anchorY).toBe(old.anchorY + 12);
    expect(sheet.frameWidth - sheet.anchorX).toBe(old.frameWidth - old.anchorX + 6);
    expect(sheet.animations.walk).toEqual({ first: 1, count: 6, ticksPerFrame: 8 });
    expect(sheet.animations.invisible).toBeUndefined();
    expect(sheet.animations.attack?.first).toBe(7);
    expect((sheet.animations.attack?.first ?? 0) + (sheet.animations.attack?.count ?? 0)).toBe(12);
    expect(sheet.strikeFrame).toBe(2);
  });

  it("the Zafreeti layout matches the animated PNG and keeps the flyer where it was", () => {
    const old = MONSTER_SPRITES["C15"];
    if (!old) throw new Error("no C15");
    const sheet = spriteFor("C15");
    if (!sheet) throw new Error("no sprite for C15");
    const data = readFileSync(resolve(__dirname, "../../../../server/public/assets/monsters/zafreeti-anim@4x.png"));
    expect(data.readUInt32BE(16)).toBe(sheet.width * 4);
    expect(data.readUInt32BE(20)).toBe(sheet.height * 4);
    expect(sheet.columns).toBe(32);
    expect(sheet.frameWidth * sheet.columns * 4).toBe(data.readUInt32BE(16));
    expect(sheet.frameHeight * sheet.rows * 4).toBe(data.readUInt32BE(20));
    // 10 px added left and right, 12 px on top: the creature stays on the same point.
    expect(sheet.anchorX).toBe(old.anchorX + 10);
    expect(sheet.anchorY).toBe(old.anchorY + 12);
    expect(sheet.frameWidth - sheet.anchorX).toBe(old.frameWidth - old.anchorX + 10);
    expect(sheet.animations.attack?.first).toBe(7);
    expect((sheet.animations.attack?.first ?? 0) + (sheet.animations.attack?.count ?? 0)).toBe(12);
    expect(sheet.strikeFrame).toBe(2);
  });

  it("the Vorg layout matches the animated PNG, keeps the 3-row wing flap and adds attack rows", () => {
    const old = MONSTER_SPRITES["C16"];
    if (!old) throw new Error("no C16");
    const sheet = spriteFor("C16");
    if (!sheet) throw new Error("no sprite for C16");
    const data = readFileSync(resolve(__dirname, "../../../../server/public/assets/monsters/vorg-anim@4x.png"));
    expect(data.readUInt32BE(16)).toBe(sheet.width * 4);
    expect(data.readUInt32BE(20)).toBe(sheet.height * 4);
    expect(sheet.columns).toBe(32);
    // 6 px added left and right, 10 px on top: the flyer stays on the same point.
    expect(sheet.anchorX).toBe(old.anchorX + 6);
    expect(sheet.anchorY).toBe(old.anchorY + 10);
    expect(sheet.frameWidth - sheet.anchorX).toBe(old.frameWidth - old.anchorX + 6);
    // The flap is untouched: rows 0-2, a new row every 3 ticks, `tick % 9 / 3`.
    expect(sheet.animations.walk).toEqual(old.animations.walk);
    expect(sheet.animations.landed).toEqual(old.animations.landed);
    expect([0, 3, 6, 9, 12, 15].map((tick) => frameRow(sheet, "walk", tick))).toEqual([0, 1, 2, 0, 1, 2]);
    expect(sheet.animations.attack?.first).toBe(3);
    expect((sheet.animations.attack?.first ?? 0) + (sheet.animations.attack?.count ?? 0)).toBe(sheet.rows);
    expect(sheet.strikeFrame).toBe(2);
    // The strike lands on row 5, the swing ends on the recovery row and the flap goes on after it.
    expect(attackRow(sheet, 0, 0)).toBe(5);
    expect(attackRow(sheet, 4, 0)).toBe(6);
    expect(attackRow(sheet, 8, 0)).toBe(7);
    expect(attackRow(sheet, 12, 6)).toBe(frameRow(sheet, "idle", 6));
    expect(frameRow(sheet, "idle", 6)).toBe(2);
  });

  it("the Teratorn layout matches the animated PNG, keeps the 3-row wing flap and adds attack rows", () => {
    const old = MONSTER_SPRITES["C14"];
    if (!old) throw new Error("no C14");
    const sheet = spriteFor("C14");
    if (!sheet) throw new Error("no sprite for C14");
    const data = readFileSync(resolve(__dirname, "../../../../server/public/assets/monsters/teratorn-anim@4x.png"));
    expect(data.readUInt32BE(16)).toBe(sheet.width * 4);
    expect(data.readUInt32BE(20)).toBe(sheet.height * 4);
    expect(sheet.columns).toBe(32);
    // 6 px added left and right, 10 px on top: the flyer stays on the same point.
    expect(sheet.anchorX).toBe(old.anchorX + 6);
    expect(sheet.anchorY).toBe(old.anchorY + 10);
    expect(sheet.frameWidth - sheet.anchorX).toBe(old.frameWidth - old.anchorX + 6);
    // The flap is untouched: rows 0-2, a new row every 3 ticks, `tick % 9 / 3`.
    expect(sheet.animations.walk).toEqual(old.animations.walk);
    expect(sheet.animations.landed).toEqual(old.animations.landed);
    expect([0, 3, 6, 9, 12, 15].map((tick) => frameRow(sheet, "walk", tick))).toEqual([0, 1, 2, 0, 1, 2]);
    expect(sheet.animations.attack?.first).toBe(3);
    expect((sheet.animations.attack?.first ?? 0) + (sheet.animations.attack?.count ?? 0)).toBe(sheet.rows);
    expect(sheet.strikeFrame).toBe(2);
    // The strike lands on row 5, the swing ends on the recovery row and the flap goes on after it.
    expect(attackRow(sheet, 0, 0)).toBe(5);
    expect(attackRow(sheet, 4, 0)).toBe(6);
    expect(attackRow(sheet, 8, 0)).toBe(7);
    expect(attackRow(sheet, 12, 6)).toBe(frameRow(sheet, "idle", 6));
    expect(frameRow(sheet, "idle", 6)).toBe(2);
  });

  it("the Bandito layout matches the animated PNG and keeps the feet where they were", () => {
    const old = MONSTER_SPRITES["C7"];
    if (!old) throw new Error("no C7");
    const sheet = spriteFor("C7");
    if (!sheet) throw new Error("no sprite for C7");
    const png = readFileSync(
      resolve(__dirname, "../../../../server/public/assets/monsters/bandito-anim@4x.png"),
    );
    expect(png.readUInt32BE(16)).toBe(sheet.width * 4);
    expect(png.readUInt32BE(20)).toBe(sheet.height * 4);
    expect(sheet.frameWidth * sheet.columns * 4).toBe(png.readUInt32BE(16));
    expect(sheet.frameHeight * sheet.rows * 4).toBe(png.readUInt32BE(20));
    // 6 px added left and right, 12 px added on top: feet stay on the same ground point.
    expect(sheet.anchorX).toBe(old.anchorX + 6);
    expect(sheet.anchorY).toBe(old.anchorY + 12);
    expect(sheet.frameHeight - sheet.anchorY).toBe(old.frameHeight - old.anchorY);
    expect(sheet.frameWidth - sheet.anchorX).toBe(old.frameWidth - old.anchorX + 6);
    expect(sheet.animations.attack?.first).toBe(7);
    expect((sheet.animations.attack?.first ?? 0) + (sheet.animations.attack?.count ?? 0)).toBe(12);
    expect(sheet.strikeFrame).toBe(2);
  });

  it("the Octo-ooze layout matches the animated PNG and keeps the body where it was", () => {
    const old = MONSTER_SPRITES["C2"];
    if (!old) throw new Error("no C2");
    const sheet = spriteFor("C2");
    if (!sheet) throw new Error("no sprite for C2");
    const png = readFileSync(
      resolve(__dirname, "../../../../server/public/assets/monsters/octo-anim@4x.png"),
    );
    expect(png.readUInt32BE(16)).toBe(sheet.width * 4);
    expect(png.readUInt32BE(20)).toBe(sheet.height * 4);
    expect(sheet.frameWidth * sheet.columns * 4).toBe(png.readUInt32BE(16));
    expect(sheet.frameHeight * sheet.rows * 4).toBe(png.readUInt32BE(20));
    // 8 px added left and right, 8 px added on top: the body stays on the same ground point.
    expect(sheet.anchorX).toBe(old.anchorX + 8);
    expect(sheet.anchorY).toBe(old.anchorY + 8);
    expect(sheet.frameHeight - sheet.anchorY).toBe(old.frameHeight - old.anchorY);
    expect(sheet.frameWidth - sheet.anchorX).toBe(old.frameWidth - old.anchorX + 8);
    expect(sheet.animations.attack?.first).toBe(7);
    expect((sheet.animations.attack?.first ?? 0) + (sheet.animations.attack?.count ?? 0)).toBe(12);
    expect(sheet.strikeFrame).toBe(2);
  });

  it("the Slimeattikus layouts (big and mini) match the animated PNGs and keep the slime where it was", () => {
    for (const [key, png, dx, dy] of [
      ["C17", "slimeattikus-anim@4x.png", 8, 17],
      ["C18", "slimeattikusmini-anim@4x.png", 5, 11],
    ] as const) {
      const old = MONSTER_SPRITES[key];
      if (!old) throw new Error(`no ${key}`);
      const sheet = spriteFor(key);
      if (!sheet) throw new Error(`no sprite for ${key}`);
      const data = readFileSync(resolve(__dirname, `../../../../server/public/assets/monsters/${png}`));
      expect(data.readUInt32BE(16)).toBe(sheet.width * 4);
      expect(data.readUInt32BE(20)).toBe(sheet.height * 4);
      expect(sheet.columns).toBe(32);
      expect(sheet.frameWidth * sheet.columns * 4).toBe(data.readUInt32BE(16));
      expect(sheet.frameHeight * sheet.rows * 4).toBe(data.readUInt32BE(20));
      expect(sheet.anchorX).toBe(old.anchorX + dx);
      expect(sheet.anchorY).toBe(old.anchorY + dy);
      expect(sheet.animations.walk).toEqual({ first: 1, count: 6, ticksPerFrame: 8 });
      expect(sheet.animations.attack?.first).toBe(7);
      expect((sheet.animations.attack?.first ?? 0) + (sheet.animations.attack?.count ?? 0)).toBe(12);
      expect(sheet.strikeFrame).toBe(2);
    }
  });

  it("the Rezghul layout matches the animated PNG and keeps the demon where it was", () => {
    const old = MONSTER_SPRITES["C19"];
    if (!old) throw new Error("no C19");
    const sheet = spriteFor("C19");
    if (!sheet) throw new Error("no sprite for C19");
    const png = readFileSync(
      resolve(__dirname, "../../../../server/public/assets/monsters/rezghul-anim@4x.png"),
    );
    expect(png.readUInt32BE(16)).toBe(sheet.width * 4);
    expect(png.readUInt32BE(20)).toBe(sheet.height * 4);
    expect(sheet.columns).toBe(32);
    expect(sheet.rows).toBe(12);
    // 8 px added left and right, 13 px added on top: the demon stays on the same ground point.
    expect(sheet.anchorX).toBe(old.anchorX + 8);
    expect(sheet.anchorY).toBe(old.anchorY + 13);
    expect(sheet.frameHeight - sheet.anchorY).toBe(old.frameHeight - old.anchorY);
    expect(sheet.frameWidth - sheet.anchorX).toBe(old.frameWidth - old.anchorX + 8);
    expect(sheet.animations.idle).toEqual({ first: 0, count: 1, ticksPerFrame: 8 });
    expect(sheet.animations.walk).toEqual({ first: 1, count: 6, ticksPerFrame: 8 });
    expect(sheet.animations.attack?.first).toBe(7);
    expect((sheet.animations.attack?.first ?? 0) + (sheet.animations.attack?.count ?? 0)).toBe(12);
    expect(sheet.strikeFrame).toBe(2);
  });

  it("replaces only the fields it names and keeps the rest", () => {
    const sheet = applyLayout(POKEY, LAYOUTS);
    expect(sheet.rows).toBe(12);
    expect(sheet.frameHeight).toBe(40);
    expect(sheet.anchorY).toBe(31);
    expect(sheet.height).toBe(480);
    expect(sheet.frameWidth).toBe(POKEY.frameWidth);
    expect(sheet.anchorX).toBe(POKEY.anchorX);
    expect(sheet.columns).toBe(POKEY.columns);
    expect(sheet.width).toBe(POKEY.frameWidth * POKEY.columns);
    expect(sheet.key).toBe(POKEY.key);
    expect(sheet.file).toBe(POKEY.file);
    expect(sheet.directions).toBe(POKEY.directions);
    expect(sheet.strikeFrame).toBe(1);
  });

  it("frames cells at the new size and puts the ground point on the same spot", () => {
    const sheet = applyLayout(POKEY, LAYOUTS);
    expect(frameRect(sheet, 3, 8)).toEqual({
      x: 3 * POKEY.frameWidth,
      y: 8 * 40,
      width: POKEY.frameWidth,
      height: 40,
    });
    // A taller cell moves its top-left up by the extra height above the feet.
    expect(anchorOffset(sheet)).toEqual({ x: -POKEY.anchorX, y: -31 });
  });

  it("finds each heading and frame of a packed sheet where the packing put it (Korath 5, 20 cells to a row)", () => {
    const flash = MONSTER_SPRITES["G4_5"];
    if (!flash) throw new Error("no G4_5");
    const sheet = applyLayout(flash);
    expect(sheet.packedColumns).toBe(20);
    // 30 frames of 16 headings, 20 to a row: 24 rows of 200 x 162 cells.
    expect([sheet.rows, sheet.width, sheet.height]).toEqual([30, 4000, 3888]);
    expect(frameRect(sheet, 3, 0)).toEqual({ x: 600, y: 0, width: 200, height: 162 });
    // Heading 4 of frame 1 is cell 20: the first of the second row.
    expect(frameRect(sheet, 4, 1)).toEqual({ x: 0, y: 162, width: 200, height: 162 });
    // The last cell, heading 15 of frame 29, is cell 479: the end of row 23.
    expect(frameRect(sheet, 15, 29)).toEqual({ x: 3800, y: 23 * 162, width: 200, height: 162 });
    expect(anchorOffset(sheet)).toEqual(anchorOffset(flash));
  });

  it("does not change the shared table", () => {
    applyLayout(POKEY, LAYOUTS);
    expect(POKEY.rows).toBe(1);
    expect(POKEY.frameHeight).not.toBe(40);
  });
});

describe("row choice by state", () => {
  const sheet = applyLayout(POKEY, LAYOUTS);
  const at = (creep: CreepSnapshot, moving: boolean, age: number, swingAge?: number) =>
    layoutCreep(
      creep,
      sheet,
      { heading: 0, moving, age, ...(swingAge === undefined ? {} : { swingAge }) },
      { x: 0, y: 0 },
      { reducedMotion: false },
    );

  it("stands on row 0 when idle", () => {
    const idle = at(creepOf(), false, 123);
    expect(idle.animation).toBe("idle");
    expect(idle.row).toBe(0);
  });

  it("cycles rows 1-6 while walking", () => {
    const rows = [0, 8, 16, 24, 32, 40, 48].map((age) => at(creepOf(), true, age).row);
    expect(rows).toEqual([1, 2, 3, 4, 5, 6, 1]);
  });

  it("uses the attack rows while attacking, whether or not it is moving", () => {
    const hit = creepOf({ state: "attacking", targetBuilding: 7 });
    expect(at(hit, false, 0).animation).toBe("attack");
    expect(at(hit, true, 0).animation).toBe("attack");
    // Before the first hit lands the cycle loops on the creep's own clock.
    expect(at(hit, false, 0).row).toBe(7);
    expect(at(hit, false, 4).row).toBe(8);
    expect(at(hit, false, 20).row).toBe(7);
  });

  it("shows the strike frame on the hit and the follow-through after it", () => {
    const hit = creepOf({ state: "attacking", targetBuilding: 7 });
    expect([0, 3, 4, 8, 11].map((swing) => at(hit, false, 999, swing).row)).toEqual([8, 8, 9, 10, 10]);
    expect(at(hit, false, 999, 12).row).toBe(11);
  });

  it("goes back to standing once the swing has played out, until the next hit", () => {
    const hit = creepOf({ state: "attacking", targetBuilding: 7 });
    expect(at(hit, false, 999, 16).row).toBe(0);
    expect(at(hit, false, 999, 90).row).toBe(0);
  });

  it("restarts at the strike frame when the next hit comes early", () => {
    const hit = creepOf({ state: "attacking", targetBuilding: 7 });
    expect(at(hit, false, 999, 15).row).toBe(11);
    expect(at(hit, false, 999, 0).row).toBe(8);
  });
});

describe("attackRow", () => {
  it("loops on the clock when the sheet names no strike frame", () => {
    const { strikeFrame: _unused, ...noStrike } = TWELVE_ROWS;
    const loop = applyLayout(POKEY, { [POKEY.file]: noStrike });
    expect(attackRow(loop, 0, 0)).toBe(7);
    expect(attackRow(loop, 0, 4)).toBe(8);
    expect(attackRow(loop, 100, 20)).toBe(7);
  });

  it("is the table's own answer for a sheet with a single pose", () => {
    expect(attackRow(POKEY, 3, 50)).toBe(frameRow(POKEY, "attack", 50));
    expect(attackRow(POKEY, 3, 50)).toBe(0);
  });
});

describe("repaint url", () => {
  it("is unaffected by a layout", () => {
    expect(sheetUrl(POKEY)).toBe(sheetUrl(applyLayout(POKEY, LAYOUTS)));
  });
});
