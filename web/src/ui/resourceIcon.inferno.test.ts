// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  costAmounts,
  iconStyle,
  INFERNO_RESOURCE_NAMES,
  RESOURCE_NAMES,
  resourceIcon,
  resourceName,
  resourceRealm,
  restyleIcon,
  setResourceRealm,
  spokenText,
} from "./resourceIcon";
import { INFERNO_RESOURCE_NAMES as SIEGE_NAMES } from "./siege/infernoResources";

/** Bone, Coal, Sulfur and Magma on the Inferno yard (WP 1.19). */

afterEach(() => setResourceRealm("surface"));

describe("the Inferno's resources", () => {
  it("names the four slots by the screen's realm, Shiny the same in both", () => {
    expect(resourceRealm()).toBe("surface");
    expect(RESOURCE_NAMES.r1).toBe("Twigs");
    setResourceRealm("inferno");
    expect([RESOURCE_NAMES.r1, RESOURCE_NAMES.r2, RESOURCE_NAMES.r3, RESOURCE_NAMES.r4]).toEqual([
      "Bone",
      "Coal",
      "Sulfur",
      "Magma",
    ]);
    expect(RESOURCE_NAMES.shiny).toBe("Shiny");
    expect(resourceName("r1", "surface")).toBe("Twigs");
  });

  it("keeps one list of names for the yard and the Siege screen", () => {
    expect(SIEGE_NAMES.r3).toBe(INFERNO_RESOURCE_NAMES.r3);
  });

  it("draws the Inferno's painted piles in the Inferno and the surface's piles on the surface", () => {
    expect(iconStyle("r1").backgroundImage).toContain("/assets/popups/resourcetwigs.png");
    setResourceRealm("inferno");
    expect(iconStyle("r1").backgroundImage).toContain("/assets/popups/resourcebone.png");
    expect(iconStyle("r4").backgroundImage).toContain("/assets/popups/resourcemagma.png");
    expect(iconStyle("r1").aspectRatio).toBe(iconStyle("r1", "surface").aspectRatio);
    expect(iconStyle("shiny").backgroundImage).toContain("/assets/alliances/shiny-icon.png");
  });

  it("names a cost in Inferno words", () => {
    setResourceRealm("inferno");
    expect(spokenText(costAmounts({ r2: 750 })!)).toBe("Coal 750");
  });

  it("restyles an icon drawn before the realm changed", () => {
    const icon = resourceIcon("r4");
    expect(icon.getAttribute("aria-label")).toBe("Goo");
    setResourceRealm("inferno");
    restyleIcon(icon, "r4");
    expect(icon.getAttribute("aria-label")).toBe("Magma");
    expect(icon.title).toBe("Magma");
    expect(icon.dataset["realm"]).toBe("inferno");
  });

  it("keeps a decorative icon out of the accessibility tree and a no-tooltip icon untitled", () => {
    setResourceRealm("inferno");
    const decorative = resourceIcon("r1", { decorative: true });
    expect(decorative.getAttribute("aria-label")).toBeNull();
    const quiet = resourceIcon("r1", { tooltip: false });
    expect(quiet.getAttribute("aria-label")).toBe("Bone");
    expect(quiet.title).toBe("");
  });
});
