// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as TurnstileModule from "./turnstile";

/**
 * Loading Cloudflare's Turnstile script (issue #213): once, on demand, and
 * again after a failed load. No network: the script tag's load and error
 * events are fired by hand.
 */

const setApi = (api: unknown): void => {
  (globalThis as { turnstile?: unknown }).turnstile = api;
};

const fakeApi = () => ({ render: vi.fn(), reset: vi.fn(), remove: vi.fn() });

let turnstile: typeof TurnstileModule;

beforeEach(async () => {
  vi.resetModules();
  document.head.replaceChildren();
  setApi(undefined);
  turnstile = await import("./turnstile");
});

const script = (): HTMLScriptElement | null => document.head.querySelector("script");

describe("loadTurnstile", () => {
  it("adds Cloudflare's script once, for explicit rendering, and resolves when it loads", async () => {
    const first = turnstile.loadTurnstile();
    const second = turnstile.loadTurnstile();
    expect(document.head.querySelectorAll("script")).toHaveLength(1);
    expect(script()?.src).toBe(turnstile.TURNSTILE_SCRIPT_URL);
    expect(turnstile.TURNSTILE_SCRIPT_URL).toContain("render=explicit");

    const api = fakeApi();
    setApi(api);
    script()?.dispatchEvent(new Event("load"));

    await expect(first).resolves.toBe(api);
    await expect(second).resolves.toBe(api);
  });

  it("uses a script that is already there without adding another", async () => {
    const api = fakeApi();
    setApi(api);
    await expect(turnstile.loadTurnstile()).resolves.toBe(api);
    expect(script()).toBeNull();
  });

  it("rejects a failed load and tries again next time", async () => {
    const failed = turnstile.loadTurnstile();
    script()?.dispatchEvent(new Event("error"));
    await expect(failed).rejects.toThrow();
    expect(script()).toBeNull();

    void turnstile.loadTurnstile().catch(() => {});
    expect(script()).not.toBeNull();
  });
});

describe("BotCheck", () => {
  it("says so when the check cannot load", async () => {
    const check = new turnstile.BotCheck("1x00000000000000000000AA");
    const mounted = check.mount();
    script()?.dispatchEvent(new Event("error"));
    await mounted;
    expect(check.element.textContent).toBe(turnstile.BOT_CHECK_UNLOADED);
    expect(check.token).toBeNull();
  });

  it("keeps the widget's token until it expires, and drops it on reset", async () => {
    type Options = { callback: (token: string) => void; "expired-callback": () => void };
    let options: Options | undefined;
    const api = fakeApi();
    api.render.mockImplementation((_element: HTMLElement, given: Options) => {
      options = given;
      return "w";
    });
    setApi(api);
    const check = new turnstile.BotCheck("1x00000000000000000000AA");
    await check.mount();

    options?.callback("token-1");
    expect(check.token).toBe("token-1");
    options?.["expired-callback"]();
    expect(check.token).toBeNull();

    options?.callback("token-2");
    check.reset();
    expect(check.token).toBeNull();
    expect(api.reset).toHaveBeenCalledWith("w");

    check.destroy();
    expect(api.remove).toHaveBeenCalledWith("w");
  });

  it("draws nothing if the form closed while the script was loading", async () => {
    const check = new turnstile.BotCheck("1x00000000000000000000AA");
    const mounted = check.mount();
    check.destroy();
    const api = fakeApi();
    setApi(api);
    script()?.dispatchEvent(new Event("load"));
    await mounted;
    expect(api.render).not.toHaveBeenCalled();
  });
});
