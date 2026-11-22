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

/** Beta 8.1's graphics log lines that later clients no longer send (patch 8.2, 22 Nov 2026). */
describe("isBrowserNoise: beta 8.1's graphics log", () => {
  const DEVICE = " | gpu ANGLE (NVIDIA GeForce RTX 3070) | max texture 16384 | memory 8 GB | quality high (default) | dpr 1 | screen 1920x1080 | Windows, Chrome 120";

  test("a picture cut through a canvas, a context restored and a context lost sent at once are dropped", () => {
    expect(isBrowserNoise(`Graphics: picture over the texture limit, cut through a canvas: monsters/krallen_1.png (@2x) (4096x8192 over 4096)${DEVICE}`)).toBe(true);
    expect(isBrowserNoise(`Graphics: WebGL context restored: game canvas (after 14 s on the page)${DEVICE}`)).toBe(true);
    expect(isBrowserNoise(`Graphics: WebGL context lost: game canvas (after 12 s on the page)${DEVICE}`)).toBe(true);
    expect(isBrowserNoise(`Graphics: WebGL context lost: game canvas${DEVICE}`)).toBe(true);
  });

  test("a loss not restored in time (beta 9's client) and a lost WebGPU device are kept", () => {
    expect(
      isBrowserNoise(`Graphics: WebGL context lost: game canvas (after 12 s on the page, not restored in 10 s, tab visible)${DEVICE}`)
    ).toBe(false);
    expect(isBrowserNoise(`Graphics: WebGL context lost: game canvas (WebGPU device lost: unknown )${DEVICE}`)).toBe(false);
  });

  test("a device detail that happens to say 'not restored in' does not save a short loss", () => {
    expect(isBrowserNoise(`Graphics: WebGL context lost: game canvas (after 3 s on the page) | gpu not restored in 10 s`)).toBe(true);
  });

  test("pictures that could not be cut or did not load are kept", () => {
    expect(isBrowserNoise(`Graphics: picture over the texture limit, could not be cut: monsters/krallen_1.png (@2x)${DEVICE}`)).toBe(false);
    expect(isBrowserNoise(`Graphics: picture did not load: monsters/krallen_1.png (@2x) (Error: (url))${DEVICE}`)).toBe(false);
  });
});
