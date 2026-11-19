// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { quality, setDeviceDefaultQuality } from "@/game/quality";
import { setQuietLogin } from "@/game/quietLogin";
import { SAFE_MODE_KEY, bootSafeMode, safeModeNotice, safeModeSteppedTo } from "@/game/safeMode";
import { SAFE_MODE_TEXT } from "@/ui/quality/SafeModeDialog";
import type { YardMounts } from "../yardPlugins";

/**
 * Patch 7.11: safe mode's notice. Once, on the page load where the game
 * stepped its Quality down, when nothing else has the screen; and never
 * together with the "Slow internet?" suggestion.
 */

const spies = vi.hoisted(() => ({
  suggestLowOnce: vi.fn(() => () => undefined),
  busy: vi.fn(() => false),
}));
vi.mock("@/game/slowInternet", () => ({ suggestLowOnce: spies.suggestLowOnce }));
vi.mock("./announcements", () => ({ screenBusy: spies.busy }));

const { SAFE_NOTICE_FIRST_MS, SAFE_NOTICE_RETRY_MS, safeModePlugin } = await import("./safeMode");
const { slowInternetPlugin } = await import("./slowInternet");

/** What a tester writes by hand to force the notice: two loads that never finished. */
const TWO_DEAD_LOADS = '{"cap":null,"loads":{"a":"high","b":"high"}}';

const mountsOf = (): YardMounts =>
  ({ overlay: { modal: document.body.appendChild(document.createElement("div")) } }) as unknown as YardMounts;

const popup = (): HTMLElement | null => document.querySelector<HTMLElement>(".safe-mode");

describe("safe mode's notice on the yard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    setDeviceDefaultQuality("high");
    spies.suggestLowOnce.mockClear();
    spies.busy.mockReset().mockReturnValue(false);
  });
  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
    setDeviceDefaultQuality(null);
    setQuietLogin(false);
    document.body.replaceChildren();
    bootSafeMode();
  });

  it("shows once after two loads that died, names the new level in a few words, and OK closes it", () => {
    window.localStorage.setItem(SAFE_MODE_KEY, TWO_DEAD_LOADS);
    expect(bootSafeMode()).toBe("medium");
    expect(quality()).toBe("medium");
    const stop = safeModePlugin(mountsOf());
    expect(popup()).toBeNull();
    vi.advanceTimersByTime(SAFE_NOTICE_FIRST_MS);
    const shown = popup();
    expect(shown).not.toBeNull();
    const words = shown!.querySelector("p")!.textContent!;
    expect(words).toBe("The game did not load twice, so Quality is now Medium. Change it in Settings.");
    expect(words.split(/\s+/).length).toBeLessThanOrEqual(20);
    expect(document.body.textContent).toContain(SAFE_MODE_TEXT.title);
    const buttons = [...shown!.querySelectorAll("button")];
    expect(buttons.map((button) => button.textContent)).toEqual([SAFE_MODE_TEXT.ok]);
    expect(buttons[0]!.className).toContain("btn--primary");
    buttons[0]!.click();
    expect(popup()?.isConnected ?? false).toBe(false);
    if (typeof stop === "function") stop();

    // Shown: the yard opening again on this page load (back from the map) says nothing more.
    expect(safeModeNotice()).toBeNull();
    document.body.replaceChildren();
    safeModePlugin(mountsOf());
    vi.advanceTimersByTime(60_000);
    expect(popup()).toBeNull();
  });

  it("names Low when it stepped down to Low", () => {
    window.localStorage.setItem(SAFE_MODE_KEY, '{"cap":"medium","loads":{"a":"medium","b":"medium"}}');
    expect(bootSafeMode()).toBe("low");
    safeModePlugin(mountsOf());
    vi.advanceTimersByTime(SAFE_NOTICE_FIRST_MS);
    expect(popup()!.querySelector("p")!.textContent).toContain("Quality is now Low.");
  });

  it("waits while something else has the screen, and stops looking when the yard closes", () => {
    window.localStorage.setItem(SAFE_MODE_KEY, TWO_DEAD_LOADS);
    bootSafeMode();
    spies.busy.mockReturnValue(true);
    safeModePlugin(mountsOf());
    vi.advanceTimersByTime(SAFE_NOTICE_FIRST_MS + 3 * SAFE_NOTICE_RETRY_MS);
    expect(popup()).toBeNull();
    expect(safeModeNotice()).toBe("medium");
    spies.busy.mockReturnValue(false);
    vi.advanceTimersByTime(SAFE_NOTICE_RETRY_MS);
    expect(popup()).not.toBeNull();

    // A yard that closes before the notice could show keeps it for the next yard.
    document.body.replaceChildren();
    window.localStorage.setItem(SAFE_MODE_KEY, TWO_DEAD_LOADS);
    bootSafeMode();
    const early = safeModePlugin(mountsOf());
    if (typeof early === "function") early();
    vi.advanceTimersByTime(60_000);
    expect(popup()).toBeNull();
    expect(safeModeNotice()).toBe("medium");
  });

  it("does nothing on a load that did not step down", () => {
    window.localStorage.setItem(SAFE_MODE_KEY, '{"cap":"medium","loads":{"a":"medium"}}');
    expect(bootSafeMode()).toBeNull();
    expect(safeModePlugin(mountsOf())).toBeUndefined();
    vi.advanceTimersByTime(60_000);
    expect(popup()).toBeNull();
  });

  it("the Slow internet? suggestion never shows on the load where safe mode stepped down, before or after its notice", () => {
    window.localStorage.setItem(SAFE_MODE_KEY, TWO_DEAD_LOADS);
    bootSafeMode();
    slowInternetPlugin(mountsOf());
    expect(spies.suggestLowOnce).not.toHaveBeenCalled();
    safeModePlugin(mountsOf());
    vi.advanceTimersByTime(SAFE_NOTICE_FIRST_MS);
    expect(popup()).not.toBeNull();
    expect(safeModeSteppedTo()).toBe("medium");
    slowInternetPlugin(mountsOf());
    expect(spies.suggestLowOnce).not.toHaveBeenCalled();
    // The next page load, still capped but with nothing to announce, may suggest Low again.
    bootSafeMode();
    slowInternetPlugin(mountsOf());
    expect(spies.suggestLowOnce).toHaveBeenCalledTimes(1);
  });

  it("shows on a test server's quiet login too (a tester set it up by hand)", () => {
    setQuietLogin(true);
    window.localStorage.setItem(SAFE_MODE_KEY, TWO_DEAD_LOADS);
    bootSafeMode();
    safeModePlugin(mountsOf());
    vi.advanceTimersByTime(SAFE_NOTICE_FIRST_MS);
    expect(popup()).not.toBeNull();
  });
});
