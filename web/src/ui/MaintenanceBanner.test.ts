// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { MaintenanceBanner, NARROW_FOLD_MS } from "./MaintenanceBanner";

/** The in-game maintenance countdown card (owner, 22 Nov 2026). */

const view = (remainingMs: number, exempt = false) => ({
  message: "Moving to a faster server",
  backAt: null,
  remainingMs,
  exempt,
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MaintenanceBanner", () => {
  it("shows the hammer and wrench, the time left, Maintenance and the message, once", () => {
    const host = document.createElement("div");
    const banner = new MaintenanceBanner(host, () => false);
    banner.show(view(299_000));
    banner.show(view(298_000));
    expect(host.querySelectorAll(".maint-banner")).toHaveLength(1);
    expect(host.querySelector<HTMLImageElement>(".maint-banner__icon")?.dataset["icon"]).toBe("tools");
    expect(host.querySelector(".maint-banner__card .maint-banner__clock")?.textContent).toBe("4:58");
    expect(host.querySelector(".maint-banner__title")?.textContent).toBe("Maintenance");
    expect(host.querySelector(".maint-banner__message")?.textContent).toBe("Moving to a faster server");
    expect(host.querySelector<HTMLElement>(".maint-banner__back")?.hidden).toBe(true);
  });

  it("folds to a pill and opens again; the last minute opens it, red, with no fold", () => {
    const host = document.createElement("div");
    const banner = new MaintenanceBanner(host, () => false);
    banner.show(view(120_000));
    host.querySelector<HTMLButtonElement>(".maint-banner__fold")!.click();
    expect(banner.isFolded).toBe(true);
    host.querySelector<HTMLButtonElement>(".maint-banner__pill")!.click();
    expect(banner.isFolded).toBe(false);
    host.querySelector<HTMLButtonElement>(".maint-banner__fold")!.click();
    banner.show(view(59_000));
    expect(banner.isFolded).toBe(false);
    expect(host.querySelector(".maint-banner")?.classList.contains("maint-banner--final")).toBe(true);
    expect(host.querySelector<HTMLElement>(".maint-banner__fold")?.hidden).toBe(true);
    expect(host.querySelector(".maint-banner__title")?.textContent).toBe("Maintenance: signing out");
  });

  it("folds itself on a narrow screen after a few seconds, unless the player chose", () => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    const banner = new MaintenanceBanner(host, () => true);
    banner.show(view(300_000));
    expect(banner.isFolded).toBe(false);
    vi.advanceTimersByTime(NARROW_FOLD_MS);
    expect(banner.isFolded).toBe(true);
  });

  it("past zero the owner's card says it is on and only he can play", () => {
    const host = document.createElement("div");
    const banner = new MaintenanceBanner(host, () => false);
    banner.show(view(0, true));
    expect(host.querySelector(".maint-banner__title")?.textContent).toBe("Maintenance on");
    expect(host.querySelector(".maint-banner__message")?.textContent).toBe("Players are out. Only you can play.");
  });

  it("hides and starts over", () => {
    const host = document.createElement("div");
    const banner = new MaintenanceBanner(host, () => false);
    banner.show(view(300_000));
    banner.hide();
    expect(banner.shown).toBe(false);
  });
});
