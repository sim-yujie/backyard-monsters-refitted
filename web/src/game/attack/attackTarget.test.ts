import { describe, expect, it } from "vitest";
import {
  consumeAttackTarget,
  consumeViewTarget,
  setAttackTarget,
  setViewTarget,
  type AttackTarget,
} from "./attackTarget";

const target: AttackTarget = {
  baseid: "21970243208",
  kind: "wild",
  cell: { col: 243, row: 208 },
  name: "Abunakki",
  roster: { monsters: { C1: 3 }, levels: {}, champions: [], flingerLevel: 4, catapultLevel: 0 },
};

describe("attackTarget", () => {
  it("hands a target over exactly once", () => {
    setAttackTarget(target);
    expect(consumeAttackTarget()).toBe(target);
    expect(consumeAttackTarget()).toBeNull();
  });

  it("keeps the view target separate from the attack target", () => {
    setViewTarget({ ...target, attack: target, refusal: null });
    expect(consumeAttackTarget()).toBeNull();
    expect(consumeViewTarget()?.attack).toBe(target);
    expect(consumeViewTarget()).toBeNull();
  });

  it("is overwritten by a later choice", () => {
    setAttackTarget(target);
    setAttackTarget({ ...target, baseid: "1000", kind: "main" });
    expect(consumeAttackTarget()?.baseid).toBe("1000");
  });
});
