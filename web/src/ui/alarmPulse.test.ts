// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { EFFECTS_QUALITY_KEY } from "@/game/attack/juice";
import { alarmPulse } from "./alarmPulse";
import { Popup } from "./Popup";

/** The alarm glow on a raid warning's border while it is up (owner's request, 25 Oct). */

const openPopup = (): { host: HTMLElement; popup: Popup } => {
  const host = document.createElement("div");
  document.body.append(host);
  const popup = new Popup({ title: "WILD MONSTER ALERT", dismissable: false }).mount(host);
  return { host, popup };
};

/** jsdom has no matchMedia: the device's answer to "less motion?" is stubbed. */
const deviceAsksForLessMotion = (reduce: boolean): void => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduce && query.includes("prefers-reduced-motion") }));
};

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.body.replaceChildren();
});

describe("alarmPulse", () => {
  it("lays the glow over the popup's window on its scrim, hidden from screen readers", () => {
    deviceAsksForLessMotion(false);
    window.localStorage.setItem(EFFECTS_QUALITY_KEY, "full");
    const { popup } = openPopup();
    const glow = alarmPulse(popup);
    expect(glow.parentElement).toBe(popup.backdrop);
    expect(popup.backdrop.classList.contains("popup-backdrop--alarm")).toBe(true);
    expect(glow.className).toBe("alarm-pulse");
    expect(glow.getAttribute("aria-hidden")).toBe("true");
  });

  it("goes when the popup closes", () => {
    const { host, popup } = openPopup();
    alarmPulse(popup, { quality: "full", still: false });
    expect(host.querySelector(".alarm-pulse")).not.toBeNull();
    popup.close();
    expect(host.querySelector(".alarm-pulse")).toBeNull();
  });

  it("stays lit without pulsing when the device asks for less motion", () => {
    deviceAsksForLessMotion(true);
    const { popup } = openPopup();
    expect(alarmPulse(popup, { quality: "full" }).classList.contains("alarm-pulse--still")).toBe(true);
  });

  it("is toned down on Effects: Low", () => {
    deviceAsksForLessMotion(false);
    window.localStorage.setItem(EFFECTS_QUALITY_KEY, "low");
    const { popup } = openPopup();
    const glow = alarmPulse(popup);
    expect(glow.classList.contains("alarm-pulse--low")).toBe(true);
    expect(glow.classList.contains("alarm-pulse--still")).toBe(false);
  });
});
