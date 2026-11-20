// @vitest-environment jsdom
import { ResizePlugin } from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

/** Bug #51: on an iPhone the yard sometimes filled only the top-left of the screen. */
describe("App canvas size", () => {
  afterEach(() => vi.restoreAllMocks());

  it("follows the game area, so a zoomed window cannot shrink the yard", async () => {
    // The game area on a 440x956 iPhone: its layout size, which zoom never changes.
    const host = document.createElement("div");
    Object.defineProperty(host, "clientWidth", { configurable: true, value: 440 });
    Object.defineProperty(host, "clientHeight", { configurable: true, value: 956 });

    // The options App hands Pixi (init stopped there: jsdom has no WebGL).
    const app = new App(host);
    const init = vi
      .spyOn(app.pixi, "init")
      .mockRejectedValue(new Error("no renderer in jsdom"));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    await app.start().catch(() => undefined);
    const options = init.mock.calls[0]![0]!;
    expect(options.resizeTo).toBe(host);

    // Pixi's own resize step with those options, while the page is pinch-zoomed
    // 1.556x as in the player's report: iOS gives the zoomed size as
    // innerWidth/innerHeight and fires a resize.
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(283);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(614);
    const sizes: Array<[number, number]> = [];
    const pixi = {
      renderer: { resize: (width: number, height: number) => sizes.push([width, height]) },
      render: () => undefined,
    } as unknown as { resize: () => void };
    ResizePlugin.init.call(pixi as never, { resizeTo: options.resizeTo! });
    window.dispatchEvent(new Event("resize"));
    pixi.resize();
    ResizePlugin.destroy.call(pixi as never);

    // Full size every time, never the zoomed 283x614.
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) expect(size).toEqual([440, 956]);
  });
});
