// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { GraphicsOffError, graphicsStartError, webglBlockedReason } from "./graphicsOff";
import { GRAPHICS_OFF_STEPS, showGraphicsOffNotice } from "@/ui/GraphicsOffNotice";

/** Graphics (WebGL) switched off in the player's browser (owner, 7 Nov 2026). */

const canvasWith = (getContext: (kind: string) => unknown) =>
  () => ({ getContext: vi.fn(getContext) }) as unknown as HTMLCanvasElement;

describe("webglBlockedReason", () => {
  it("keeps the browser's own words when asking for WebGL throws", () => {
    const make = canvasWith(() => {
      throw new Error("WebGL is disabled due to your security policy");
    });
    expect(webglBlockedReason(make)).toBe("WebGL is disabled due to your security policy");
  });

  it("says so when the browser gives no context", () => {
    expect(webglBlockedReason(canvasWith(() => null))).toBe("no WebGL context");
  });

  it("is null where WebGL works, and lets the test context go", () => {
    const loseContext = vi.fn();
    const gl = { getExtension: () => ({ loseContext }) };
    expect(webglBlockedReason(canvasWith((kind) => (kind === "webgl" ? gl : null)))).toBeNull();
    expect(loseContext).toHaveBeenCalledTimes(1);
  });
});

describe("graphicsStartError", () => {
  it("turns a failed start into GraphicsOffError when WebGL is off", () => {
    const error = graphicsStartError(
      new Error("No available renderer for the current environment"),
      () => "WebGL is disabled due to your security policy",
    );
    expect(error).toBeInstanceOf(GraphicsOffError);
    expect(String(error)).toBe(
      "GraphicsOffError: Graphics off: WebGL is disabled due to your security policy " +
        "(No available renderer for the current environment)",
    );
  });

  it("leaves any other failure as it was", () => {
    const original = new TypeError("x is undefined");
    expect(graphicsStartError(original, () => null)).toBe(original);
  });
});

describe("the graphics-off message", () => {
  it("says what is wrong, how to fix it, and Retry loads again", () => {
    const host = document.createElement("div");
    const retry = vi.fn();
    showGraphicsOffNotice(host, retry);
    const notice = host.querySelector(".graphics-off")!;
    expect(notice.querySelector(".panel__title")!.textContent).toBe("Graphics are off");
    expect(notice.querySelector(".graphics-off__text")!.textContent).toBe(
      "Your browser has graphics turned off, so the game can’t draw.",
    );
    expect([...notice.querySelectorAll("li")].map((item) => item.textContent)).toEqual([...GRAPHICS_OFF_STEPS]);
    expect(notice.querySelector("[role=alertdialog]")).not.toBeNull();
    // Shown once, however often it is asked for.
    showGraphicsOffNotice(host, retry);
    expect(host.querySelectorAll(".graphics-off")).toHaveLength(1);
    (host.querySelector(".graphics-off__retry") as HTMLButtonElement).click();
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
