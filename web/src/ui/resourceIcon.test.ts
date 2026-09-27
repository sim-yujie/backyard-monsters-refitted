// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  costAmounts,
  iconStyle,
  resourceAmount,
  resourceIcon,
  resourceKeyOf,
  spokenText,
} from "./resourceIcon";

/** The one helper every amount on screen is drawn with (#93). */

describe("resource icons", () => {
  it("crops each pile out of its popup art and shows the shiny coins whole", () => {
    const twigs = iconStyle("r1");
    expect(twigs.backgroundImage).toBe('url("/assets/popups/resourcetwigs.png")');
    // 182 x 95 image, 79 x 68 crop at (102, 26).
    expect(twigs.backgroundSize).toBe("230.38% 139.706%");
    expect(twigs.backgroundPosition).toBe("99.029% 96.296%");
    expect(twigs.aspectRatio).toBe("79 / 68");

    const shiny = iconStyle("shiny");
    expect(shiny.backgroundImage).toBe('url("/assets/alliances/shiny-icon.png")');
    expect(shiny.backgroundSize).toBe("100% 100%");
    expect(shiny.backgroundPosition).toBe("0% 0%");

    for (const key of ["r2", "r3", "r4"] as const) {
      expect(iconStyle(key).backgroundImage).toMatch(/^url\("\/assets\/popups\/resource[a-z]+\.png"\)$/);
    }
  });

  it("keeps the word as the icon's accessible name and tooltip", () => {
    const icon = resourceIcon("r2");
    expect(icon.getAttribute("role")).toBe("img");
    expect(icon.getAttribute("aria-label")).toBe("Pebbles");
    expect(icon.title).toBe("Pebbles");
    expect(icon.textContent).toBe("");

    const quiet = resourceIcon("r2", { tooltip: false });
    expect(quiet.getAttribute("aria-label")).toBe("Pebbles");
    expect(quiet.title).toBe("");

    const decorative = resourceIcon("r2", { decorative: true });
    expect(decorative.getAttribute("aria-hidden")).toBe("true");
    expect(decorative.getAttribute("role")).toBeNull();
    expect(decorative.title).toBe("");
  });

  it("pairs an icon with an amount, and reads out as the name then the amount", () => {
    const amount = resourceAmount("r4", "12.5K", { className: "extra" });
    expect(amount.className).toBe("res-amount extra");
    expect(amount.dataset["resource"]).toBe("r4");
    expect(amount.textContent).toBe("12.5K");
    expect(spokenText(amount)).toBe("Goo 12.5K");
  });

  it("spells a cost without the resources it does not need, or not at all", () => {
    const cost = costAmounts({ r1: 10_000, r2: 0, r3: 2_500, r4: 0 })!;
    expect(spokenText(cost)).toBe("Twigs 10.0K Putty 2.5K");
    expect(cost.querySelectorAll(".res-icon")).toHaveLength(2);
    expect(costAmounts({ r1: 0, r2: 0, r3: 0, r4: 0 })).toBeNull();
    expect(costAmounts({})).toBeNull();
    expect(spokenText(costAmounts({ r1: 1_234 }, (n) => n.toLocaleString("en-US"))!)).toBe("Twigs 1,234");
  });

  it("maps a bomb's resource number onto its key", () => {
    expect([1, 2, 3].map(resourceKeyOf)).toEqual(["r1", "r2", "r3"]);
  });

  it("reads text around icons, and skips anything hidden from a screen reader", () => {
    const line = document.createElement("p");
    const hidden = document.createElement("span");
    hidden.setAttribute("aria-hidden", "true");
    hidden.textContent = "nope";
    line.append("Short ", resourceIcon("r1"), "5.0M", hidden, ".");
    expect(spokenText(line)).toBe("Short Twigs 5.0M.");
  });
});
