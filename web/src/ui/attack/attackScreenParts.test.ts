import { describe, expect, it } from "vitest";
import { attackScreenParts } from "./attackScreenParts";

describe("attackScreenParts (beta 7, grill item 35)", () => {
  it("cleans up a live attack: no HUD, menu, status line or minimap", () => {
    expect(attackScreenParts({ practice: false, watching: false, raiding: false })).toEqual({
      live: true,
      hud: false,
      menu: false,
      statusLine: false,
      minimap: false,
    });
  });

  it("keeps a replay's and a defence view's screen as it was", () => {
    expect(attackScreenParts({ practice: false, watching: true, raiding: false })).toEqual({
      live: false,
      hud: true,
      menu: true,
      statusLine: true,
      minimap: true,
    });
  });

  it("keeps a Baiter test's screen as it was", () => {
    expect(attackScreenParts({ practice: true, watching: false, raiding: false }).hud).toBe(true);
    expect(attackScreenParts({ practice: true, watching: false, raiding: false }).minimap).toBe(true);
  });

  it("leaves a raid as it was: no HUD or menu, but its status line and minimap", () => {
    expect(attackScreenParts({ practice: false, watching: false, raiding: true })).toEqual({
      live: false,
      hud: false,
      menu: false,
      statusLine: true,
      minimap: true,
    });
  });
});
