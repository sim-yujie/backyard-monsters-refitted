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

  it("ships no layouts yet, so every real sheet is exactly the Flash table", () => {
    expect(Object.keys(REPAINT_LAYOUTS)).toEqual([]);
    expect(spriteFor("C1")).toBe(POKEY);
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
