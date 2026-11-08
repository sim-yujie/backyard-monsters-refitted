import { describe, expect, test } from "bun:test";

import { isBrowserNoise } from "./errorNoise.js";

/** Errors from browser add-ons are not kept (owner, 6 Nov 2026); the player's graphics/sound settings are (7 Nov). */
describe("isBrowserNoise", () => {
  test("Facebook's in-app browser scripts", () => {
    expect(isBrowserNoise("SyntaxError: Unexpected end of input", "iabjs://browser_declutter:37:40")).toBe(true);
  });

  test("crypto-wallet add-ons", () => {
    expect(
      isBrowserNoise("TypeError: undefined is not an object (evaluating 'window.ethereum.selectedAddress = undefined')", "/:1:16")
    ).toBe(true);
  });

  test("graphics or sound switched off in the browser are kept (owner, 7 Nov 2026)", () => {
    expect(isBrowserNoise("Unhandled rejection: Error: WebGL is disabled due to your security policy")).toBe(false);
    expect(isBrowserNoise("Error: Web Audio API is disabled due to your security policy")).toBe(false);
    expect(
      isBrowserNoise("GraphicsOffError: Graphics off: WebGL is disabled due to your security policy (No available renderer)")
    ).toBe(false);
  });

  test("the game's own errors are kept", () => {
    expect(isBrowserNoise("ReferenceError: TouchEvent is not defined", "/static/browserAll-ogmlN4ui.js:14:27535")).toBe(false);
    expect(
      isBrowserNoise("Unhandled rejection: Error: The supplied Container must be a child of the caller", "", "at _Et.loadTiles")
    ).toBe(false);
  });
});
