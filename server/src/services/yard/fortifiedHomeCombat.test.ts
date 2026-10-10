import { describe, expect, test } from "bun:test";
import { buildEngineYard } from "../../game-rules/combat/yard.js";
import { fortifiedDamage } from "../../game-rules/combat/stats.js";

/**
 * A fortified home-yard building takes less damage in an attack, with no yard
 * test in the rules: F1 to F4 cut it by 20, 30, 40 and 50 percent
 * (`BFOUNDATION.modifyHealth`, `client/scripts/BFOUNDATION.as:508-511`).
 */
describe("fortified home-yard towers in combat", () => {
  test("the yard reads each tower's fort", () => {
    const yard = buildEngineYard({
      kind: "main",
      buildingdata: {
        "1": { id: 1, t: 20, l: 3, X: 100, Y: 100, fort: 1 },
        "2": { id: 2, t: 21, l: 3, X: 200, Y: 100, fort: 4 },
        "3": { id: 3, t: 20, l: 3, X: 300, Y: 100 },
      },
    });

    expect([...yard.buildings].map((one) => one.fortification)).toEqual([1, 4, 0]);
  });

  test("F1, F2, F3 and F4 take 20, 30, 40 and 50 percent less damage", () => {
    expect([0, 1, 2, 3, 4].map((fort) => fortifiedDamage(100, fort, 0))).toEqual([
      100, 80, 70, 60, 50,
    ]);
  });
});
