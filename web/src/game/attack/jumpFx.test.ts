import { describe, expect, it } from "vitest";
import { HOP_TICKS, HOP_UP_TICKS } from "@/game/combat/rules";
import type { CreepSnapshot } from "@/game/combat/rules/engine";
import { layoutCreep } from "./AttackBattleLayer";
import { JUMP_LIFT_PX, jumpLift } from "./jumpFx";
import { MONSTER_SPRITES } from "./monsterSpriteData";

describe("Malphus's hop over a wall (`CreepBase.as:1505-1526`)", () => {
  it("is 0.4 s up and 0.4 s down", () => {
    expect(HOP_UP_TICKS).toBe(32);
    expect(HOP_TICKS).toBe(64);
  });

  it("rises 60 px on Sine.easeOut, then bounces back to the ground", () => {
    expect(JUMP_LIFT_PX).toBe(60);
    expect(jumpLift(0)).toBe(0);
    expect(jumpLift(HOP_UP_TICKS / 2)).toBeCloseTo(60 * Math.SQRT1_2, 6);
    expect(jumpLift(HOP_UP_TICKS)).toBe(60);
    expect(jumpLift(HOP_TICKS - 1)).toBeLessThan(1);
    expect(jumpLift(HOP_TICKS)).toBe(0);
    expect(jumpLift(-1)).toBe(0);
    for (let hop = 1; hop < HOP_UP_TICKS; hop += 1) {
      expect(jumpLift(hop)).toBeGreaterThan(jumpLift(hop - 1));
    }
  });

  const malphus = (hop?: number): CreepSnapshot => ({
    id: 1,
    monsterId: "IC3",
    level: 1,
    champion: false,
    friendly: false,
    ix: 100,
    iy: 100,
    hp: 100,
    maxHp: 100,
    flying: false,
    state: "walking",
    targetBuilding: 1,
    targetCreep: -1,
    ...(hop === undefined ? {} : { hop }),
  });
  const layout = (creep: CreepSnapshot, reducedMotion = false) =>
    layoutCreep(
      creep,
      MONSTER_SPRITES["IC3"]!,
      { heading: 0, moving: false, age: 0 },
      { x: 0, y: 0 },
      { reducedMotion },
    );

  it("lifts the body off its ground point and sorts it by that height, over the wall", () => {
    const standing = layout(malphus());
    const top = layout(malphus(HOP_UP_TICKS));
    expect(top.y).toBe(standing.y - 60);
    expect(top.groundY).toBe(standing.groundY);
    expect(top.zIndex).toBeGreaterThan(standing.zIndex);
  });

  it("stays on the ground under reduced motion", () => {
    expect(layout(malphus(HOP_UP_TICKS), true).y).toBe(layout(malphus(), true).y);
  });
});
