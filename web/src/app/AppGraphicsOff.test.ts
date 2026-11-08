// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { GraphicsOffError } from "./graphicsOff";

/** The renderer's start, where the browser has graphics switched off. */
describe("App.start without WebGL", () => {
  it("asks for WebGL or WebGPU only, and stops with GraphicsOffError", async () => {
    const host = document.createElement("div");
    const app = new App(host);
    const init = vi
      .spyOn(app.pixi, "init")
      .mockRejectedValue(new Error("No available renderer for the current environment"));
    // jsdom has no WebGL: its canvases give no context, as a browser with graphics off does.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const started = app.start();
    await expect(started).rejects.toBeInstanceOf(GraphicsOffError);
    await expect(started).rejects.toThrow(
      "Graphics off: no WebGL context (No available renderer for the current environment)",
    );
    expect(init.mock.calls[0]![0]).toMatchObject({ preference: ["webgl", "webgpu"] });
    // Nothing half-made is left on the page.
    expect(host.childElementCount).toBe(0);
  });
});
