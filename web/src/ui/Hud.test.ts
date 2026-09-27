// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hud } from "./Hud";
import { spokenText } from "./resourceIcon";

/** The HUD's readouts: the resource's icon instead of its word (#93). */

describe("the HUD", () => {
  let hud: Hud;

  beforeEach(() => {
    hud = new Hud({ scenes: [{ id: "yard", label: "Yard" }], onSceneSelect: () => {} }).mount(document.body);
  });

  afterEach(() => hud.destroy());

  it("shows each resource as its icon and a short amount, the word kept for hover and screen readers", () => {
    hud.setResources({ r1: 11_163_050_000, r2: 2_500, r3: 0, r4: 999 }, 42);
    expect(hud.element.textContent).not.toMatch(/twigs|pebbles|putty|goo|shiny/i);
    const readouts = [...hud.element.querySelectorAll<HTMLElement>(".hud__resource")];
    expect(readouts.map((one) => one.textContent)).toEqual(["11.16B", "2.5K", "0", "999", "42"]);
    expect(readouts.map(spokenText)).toEqual([
      "Twigs 11.16B",
      "Pebbles 2.5K",
      "Putty 0",
      "Goo 999",
      "Shiny 42",
    ]);
    expect(readouts[0]?.querySelector(".res-icon")?.getAttribute("title")).toBe("Twigs");
  });
});
