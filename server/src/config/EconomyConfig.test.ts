import { describe, expect, test } from "bun:test";
import {
  DEFAULT_ECONOMY_VALIDATION_MODE,
  isEconomyValidationMode,
  parseEconomyValidationMode,
} from "./EconomyConfig.js";
import { DEFAULT_COMBAT_VALIDATION_MODE } from "./CombatConfig.js";

/**
 * The economy audit refuses by default (issue #43): it only ever sees the owner
 * saves `OWNER_SAVE_MODE=allow` lets through, and the combat audit keeps its
 * own `log` default until it has had the same review.
 */
describe("ECONOMY_SAVE_VALIDATION", () => {
  test("an absent or unknown value means reject", () => {
    expect(DEFAULT_ECONOMY_VALIDATION_MODE).toBe("reject");
    expect(parseEconomyValidationMode(undefined)).toBe("reject");
    expect(parseEconomyValidationMode("REJECT")).toBe("reject");
    expect(parseEconomyValidationMode("nonsense")).toBe("reject");
  });

  test("a named mode is taken as it is", () => {
    expect(parseEconomyValidationMode("off")).toBe("off");
    expect(parseEconomyValidationMode("log")).toBe("log");
    expect(parseEconomyValidationMode("reject")).toBe("reject");
    expect(isEconomyValidationMode("log")).toBe(true);
    expect(isEconomyValidationMode("allow")).toBe(false);
  });

  test("the combat audit keeps its own default of log", () => {
    expect(DEFAULT_COMBAT_VALIDATION_MODE).toBe("log");
    expect(parseEconomyValidationMode(undefined, DEFAULT_COMBAT_VALIDATION_MODE)).toBe("log");
    expect(parseEconomyValidationMode("nonsense", DEFAULT_COMBAT_VALIDATION_MODE)).toBe("log");
    expect(parseEconomyValidationMode("reject", DEFAULT_COMBAT_VALIDATION_MODE)).toBe("reject");
  });
});
