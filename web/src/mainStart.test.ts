// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The page's start (`main.ts`) when the browser has graphics switched off:
 * the plain-HTML message, not a broken screen, and the error still sent once.
 */

const { start, reportCaughtError } = vi.hoisted(() => ({
  start: vi.fn<() => Promise<void>>(),
  reportCaughtError: vi.fn(),
}));

vi.mock("@/app/App", () => ({
  App: class {
    start = start;
    destroy = vi.fn();
  },
}));
vi.mock("@/game/bugReport/errorReporter", () => ({
  installErrorReporter: vi.fn(),
  reportCaughtError,
}));
vi.mock("@/game/bugReport/errorLog", () => ({ installErrorLog: vi.fn() }));
vi.mock("@/app/updateCheck", () => ({
  UpdateCheck: class {
    start = vi.fn();
  },
  fetchLivePage: vi.fn(),
  runningBundleName: () => null,
}));

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.resetModules();
  start.mockReset();
  reportCaughtError.mockReset();
  document.body.innerHTML = '<div id="game-root"></div>';
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("starting the page", () => {
  it("shows the graphics-off message and reports the error once when WebGL is off", async () => {
    // The same module copy `main.ts` will load (the registry is reset per test).
    const { GraphicsOffError } = await import("@/app/graphicsOff");
    const error = new GraphicsOffError("Graphics off: WebGL is disabled due to your security policy (No available renderer)");
    start.mockRejectedValue(error);
    await import("./main");
    await settle();
    const notice = document.querySelector("#game-root .graphics-off");
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toContain("Your browser has graphics turned off");
    expect(notice!.querySelector("button")!.textContent).toBe("Retry");
    expect(reportCaughtError).toHaveBeenCalledTimes(1);
    expect(reportCaughtError).toHaveBeenCalledWith(error);
  });

  it("keeps the old words for any other failure", async () => {
    start.mockRejectedValue(new TypeError("x is undefined"));
    await import("./main");
    await settle();
    expect(document.querySelector(".graphics-off")).toBeNull();
    expect(document.querySelector("#game-root")!.textContent).toBe(
      "The game could not start. Check the console for details.",
    );
    expect(reportCaughtError).not.toHaveBeenCalled();
  });
});
