// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { setDeviceDefaultQuality } from "@/game/quality";
import { setQuietLogin } from "@/game/quietLogin";
import { STABLE_MS, readSafeMode, unfinishedLoads } from "@/game/safeMode";
import { noteYardLoading } from "@/game/safeModeYard";
import { setTouchDevice } from "@/game/touchDevice";

/** Patch 7.11: safe mode's mark in the browser, made when a yard starts loading and tied to the page's own events. */

const setVisibility = (state: "visible" | "hidden"): void => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
};

describe("the yard's safe-mode mark in the browser", () => {
  afterEach(() => {
    vi.useRealTimers();
    setQuietLogin(false);
    setTouchDevice(null);
    setDeviceDefaultQuality(null);
    window.localStorage.clear();
  });

  it("nothing is marked before a yard loads, nor on a test server's quiet login; then one mark, at the monsters' level", () => {
    vi.useFakeTimers();
    window.localStorage.clear();
    // The login page: hiding and leaving it leaves no trace.
    setVisibility("hidden");
    setVisibility("visible");
    window.dispatchEvent(new Event("pagehide"));
    expect(unfinishedLoads()).toBe(0);

    setQuietLogin(true);
    noteYardLoading();
    expect(unfinishedLoads()).toBe(0);
    setQuietLogin(false);

    // A phone whose player chose High draws Medium's monsters: that is the level marked.
    window.localStorage.setItem("bymr.quality", "high");
    setTouchDevice(true);
    noteYardLoading();
    expect(Object.values(readSafeMode().loads)).toEqual(["medium"]);
    // A second yard on the same page load adds nothing.
    noteYardLoading();
    expect(unfinishedLoads()).toBe(1);

    // Hidden and left (both events): taken back once. Shown again (both events): marked once.
    setVisibility("hidden");
    window.dispatchEvent(new Event("pagehide"));
    expect(unfinishedLoads()).toBe(0);
    window.dispatchEvent(new Event("pageshow"));
    expect(unfinishedLoads()).toBe(0);
    setVisibility("visible");
    window.dispatchEvent(new Event("pageshow"));
    expect(unfinishedLoads()).toBe(1);

    // 30 s on screen with the yard's sheets in: the load ran fine.
    vi.advanceTimersByTime(STABLE_MS - 1000);
    expect(unfinishedLoads()).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(unfinishedLoads()).toBe(0);
    setVisibility("hidden");
    setVisibility("visible");
    expect(unfinishedLoads()).toBe(0);
  });
});
