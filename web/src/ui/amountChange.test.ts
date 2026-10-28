// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { writeAmount } from "./amountChange";
import { resourceAmount, spokenText } from "./resourceIcon";

/** "+300" won and "−300" taken (owner, 28 Oct). */

describe("writeAmount", () => {
  it("keeps nothing at all plain: no sign, no colour, no word", () => {
    for (const amount of [0, "0", "0.0"]) {
      const none = resourceAmount("r1", amount, { change: "gain" });
      expect(none.dataset["change"]).toBeUndefined();
      expect(none.classList).not.toContain("res-amount--gain");
      expect(none.querySelector(".res-amount__value")?.textContent).toBe(String(amount));
      expect(spokenText(none)).toBe(`Twigs ${amount}`);
    }
  });

  it("rewrites a ticking readout in place, from nothing to a gain", () => {
    const loot = resourceAmount("r2", 0, { change: "gain" });
    const value = loot.querySelector(".res-amount__value");
    writeAmount(loot, "res-amount", 1500, { change: "gain" });
    expect(loot.querySelector(".res-amount__value")).toBe(value);
    expect(value?.textContent).toBe("+1,500");
    expect(loot.classList).toContain("res-amount--gain");
    expect(spokenText(loot)).toBe("Pebbles 1,500 gained");
    writeAmount(loot, "res-amount", 2000, { change: "gain" });
    expect(loot.querySelectorAll(".res-amount__said")).toHaveLength(1);
    expect(spokenText(loot)).toBe("Pebbles 2,000 gained");
  });

  it("drops the sign and the spoken word when an amount turns plain again", () => {
    const loot = resourceAmount("r4", 300, { change: "loss" });
    writeAmount(loot, "res-amount", 300);
    expect(loot.classList).not.toContain("res-amount--loss");
    expect(loot.querySelector(".res-amount__said")).toBeNull();
    expect(loot.querySelector(".res-amount__value")?.hasAttribute("aria-hidden")).toBe(false);
    expect(loot.querySelector(".res-amount__value")?.hasAttribute("title")).toBe(false);
    expect(spokenText(loot)).toBe("Goo 300");
  });
});
