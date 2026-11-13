// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuestsView } from "@/api/quests";
import { isLoginPopupOpen, LoginPopup, type LoginPopupView } from "./LoginPopup";

/**
 * The daily login pop-up and the keyboard (owner, 13 Nov 2026): it opens
 * without the keyboard on Claim, so an Enter or Space meant for something
 * else never claims a day unseen; Tab still reaches Claim and Escape closes.
 */

const NOW = Date.UTC(2026, 10, 13, 18, 0) / 1000;

const view = (claimedToday = false): LoginPopupView => ({
  quests: {
    now: NOW,
    nextDayAt: NOW + 6 * 3600,
    nextWeekAt: NOW + 3 * 86_400,
    claimable: 1,
    login: { day: 3, claimedToday, onCard: 2, shiny: [2, 2, 3, 3, 5, 5, 10] },
    daily: { quests: [], bonus: { shiny: 5, ready: false, claimed: false }, swapsLeft: 1 },
    weekly: { quests: [], bonus: { shiny: 10, ready: false, claimed: false } },
  } as QuestsView,
  now: NOW,
  busy: null,
  refusal: null,
});

const opened: LoginPopup[] = [];
const hosts: HTMLElement[] = [];

const open = (shown = view()) => {
  const host = document.createElement("div");
  // Something on the page behind the pop-up that held the keyboard (a chat box).
  const behind = document.createElement("input");
  document.body.append(behind, host);
  hosts.push(host, behind);
  behind.focus();
  const handlers = { onClaim: vi.fn(), onMore: vi.fn(), onClose: vi.fn() };
  const popup = new LoginPopup({ container: host, ...handlers }, shown);
  opened.push(popup);
  const claim = () => popup.element.querySelector<HTMLButtonElement>(".quests-login__claim");
  return { popup, claim, behind, ...handlers };
};

const key = (target: Element, name: string, shiftKey = false): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { key: name, shiftKey, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

afterEach(() => {
  for (const popup of opened.splice(0)) popup.close();
  for (const host of hosts.splice(0)) host.remove();
});

describe("the daily login pop-up and the keyboard", () => {
  it("opens with the keyboard on the window, not on Claim or any other button", () => {
    const { popup, claim } = open();
    expect(isLoginPopupOpen()).toBe(true);
    expect(claim()).not.toBeNull();
    expect(document.activeElement).toBe(popup.element);
    expect(document.activeElement).not.toBe(claim());
    expect(document.activeElement?.tagName).not.toBe("BUTTON");
  });

  it("takes the keyboard off what held it behind, so typing there stops", () => {
    const { behind } = open();
    expect(document.activeElement).not.toBe(behind);
  });

  it("a stray Enter or Space right after it opens claims nothing", () => {
    const { popup, onClaim } = open();
    for (const name of ["Enter", " "]) {
      key(document.activeElement ?? popup.element, name);
      document.activeElement?.dispatchEvent(new KeyboardEvent("keyup", { key: name, bubbles: true }));
    }
    expect(onClaim).not.toHaveBeenCalled();
  });

  it("Claim can still take the keyboard and claim (Tab reaches it, Enter presses it)", () => {
    const { claim, onClaim } = open();
    const button = claim()!;
    expect(button.disabled).toBe(false);
    expect(button.tabIndex).toBeGreaterThanOrEqual(0);
    button.focus();
    expect(document.activeElement).toBe(button);
    button.click(); // what Enter or Space does on a focused button
    expect(onClaim).toHaveBeenCalledOnce();
  });

  it("Shift+Tab from the window stays inside the pop-up", () => {
    const { popup } = open();
    // jsdom lays nothing out: give the pop-up's buttons a size so they count as visible.
    for (const button of popup.element.querySelectorAll("button")) Object.defineProperty(button, "offsetWidth", { value: 40 });
    const event = key(popup.element, "Tab", true);
    expect(event.defaultPrevented).toBe(true);
    expect(popup.element.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(popup.element);
  });

  it("Escape closes it without claiming", () => {
    const { popup, onClaim, onClose } = open();
    key(popup.element, "Escape");
    expect(isLoginPopupOpen()).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
    expect(onClaim).not.toHaveBeenCalled();
  });

  it("a day already claimed offers no Claim to press", () => {
    const { claim, popup } = open(view(true));
    expect(claim()).toBeNull();
    expect(document.activeElement).toBe(popup.element);
  });
});
