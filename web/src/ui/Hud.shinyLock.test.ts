// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { setAuthToken } from "@/api/http";
import { noteShinyLock, resetShinyLockForTests } from "@/game/shinyLock";
import { Hud } from "./Hud";

// The constructor reads the lock for a new sign-in; never over the network here.
vi.mock("@/api/account", () => ({
  fetchAccount: vi.fn(() => new Promise(() => undefined)),
}));

/**
 * Live crash (bug report 46, iPhone Safari, beta 7): "undefined is not an
 * object (evaluating 'this.workersName.hidden=…')" from applyFit <- fit <-
 * applyShinyLock. A Shiny-locked player's next sign-in made a HUD whose
 * constructor read the lock again, which turned it off at once and refitted
 * the bar before the Workers control existed. Only the phone corner fits
 * without measuring, so only phones crashed.
 */
describe("a HUD made while the Shiny Lock changes", () => {
  afterEach(() => {
    setAuthToken(null);
    resetShinyLockForTests();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it.each([
    ["the phone corner", "corner", true],
    ["the desktop corner", "corner", false],
    ["the bar", "bar", true],
  ] as const)("does not throw on %s when a new sign-in resets the lock in the constructor", (_, layout, phone) => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: phone && query === "(width <= 620px)" }));
    // A locked player, read for the old sign-in.
    setAuthToken("old-token");
    noteShinyLock(true);
    // Signed in again: the HUD's constructor reads the lock for the new token.
    setAuthToken("new-token");

    let hud: Hud | undefined;
    expect(() => {
      hud = new Hud({ scenes: [], layout, onSceneSelect: () => {} });
    }).not.toThrow();
    hud!.mount(document.body);
    // The Workers word follows the fit: the phone corner never shows it.
    expect(hud!.element.querySelector<HTMLElement>(".hud__workers-name")?.hidden).toBe(layout === "corner");
    hud!.destroy();
  });

  it("does not throw when the lock changes for a HUD already on the page", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(width <= 620px)" }));
    const hud = new Hud({ scenes: [], layout: "corner", onSceneSelect: () => {} }).mount(document.body);
    expect(() => noteShinyLock(true)).not.toThrow();
    expect(() => noteShinyLock(false)).not.toThrow();
    hud.destroy();
  });
});
