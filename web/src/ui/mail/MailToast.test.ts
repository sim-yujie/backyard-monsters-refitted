// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LatestMail } from "@/api/mail";
import { MailToast, TOAST_MS, gmBadge, modBadge, toastText } from "./MailToast";

/** The live mail pop-up (owner, beta 7): who, the first words, the Mod or GM badge, open and dismiss. */

const mail = (extra: Partial<LatestMail> = {}): LatestMail => ({
  id: "m1",
  threadid: 42,
  from: 30,
  name: "Alpha",
  subject: "About your yard",
  preview: "Hello there",
  time: 100,
  mod: false,
  gm: false,
  notice: false,
  ...extra,
});

describe("toastText", () => {
  it("gives the sender and the first words, the subject when there are none, a number for no name", () => {
    expect(toastText(mail())).toEqual({ who: "Alpha", text: "Hello there" });
    expect(toastText(mail({ preview: "" })).text).toBe("About your yard");
    expect(toastText(mail({ name: "" })).who).toBe("Player 30");
  });
});

describe("MailToast", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts hidden and shows who and what", () => {
    const toast = new MailToast();
    expect(toast.isShown).toBe(false);
    toast.show(mail(), vi.fn());
    expect(toast.isShown).toBe(true);
    expect(toast.element.querySelector(".mail-toast__who")?.textContent).toBe("Alpha");
    expect(toast.element.querySelector(".mail-toast__text")?.textContent).toBe("Hello there");
    expect(toast.element.querySelector(".mail-mod")).toBeNull();
    expect(toast.element.classList.contains("mail-toast--mod")).toBe(false);
    expect(toast.element.querySelector(".mail-gm")).toBeNull();
    expect(toast.element.classList.contains("mail-toast--gm")).toBe(false);
  });

  it("puts the Mod badge before a moderator's name and says so to a screen reader", () => {
    const toast = new MailToast();
    toast.show(mail({ mod: true }), vi.fn());
    expect(toast.element.querySelector(".mail-toast__who")?.textContent).toBe("ModAlpha");
    expect(toast.element.classList.contains("mail-toast--mod")).toBe(true);
    expect(toast.element.querySelector(".mail-toast__open")?.getAttribute("aria-label")).toBe(
      "New mail from moderator Alpha: Hello there. Open it",
    );
    expect(toast.element.querySelector(".mail-gm")).toBeNull();
  });

  it("puts the GM badge, not the Mod one, before an admin's name and names the game team (owner, 8 Nov)", () => {
    const toast = new MailToast();
    toast.show(mail({ gm: true }), vi.fn());
    expect(toast.element.querySelector(".mail-toast__who")?.textContent).toBe("GMAlpha");
    expect(toast.element.querySelector(".mail-mod")).toBeNull();
    expect(toast.element.classList.contains("mail-toast--gm")).toBe(true);
    expect(toast.element.classList.contains("mail-toast--mod")).toBe(false);
    expect(toast.element.querySelector(".mail-toast__open")?.getAttribute("aria-label")).toBe(
      "New mail from the game team, Alpha: Hello there. Open it",
    );
  });

  it("opens the message on a press and goes away", () => {
    const toast = new MailToast();
    const onOpen = vi.fn();
    toast.show(mail(), onOpen);
    toast.element.querySelector<HTMLButtonElement>(".mail-toast__open")!.click();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(toast.isShown).toBe(false);
  });

  it("goes away on × without opening, and by itself after a while", () => {
    const toast = new MailToast();
    const onOpen = vi.fn();
    toast.show(mail(), onOpen);
    toast.element.querySelector<HTMLButtonElement>(".mail-toast__close")!.click();
    expect(toast.isShown).toBe(false);
    expect(onOpen).not.toHaveBeenCalled();

    toast.show(mail(), onOpen);
    vi.advanceTimersByTime(TOAST_MS - 1);
    expect(toast.isShown).toBe(true);
    vi.advanceTimersByTime(1);
    expect(toast.isShown).toBe(false);
  });

  it("a newer message replaces the shown one and restarts the clock", () => {
    const toast = new MailToast();
    const first = vi.fn();
    const second = vi.fn();
    toast.show(mail(), first);
    vi.advanceTimersByTime(TOAST_MS - 100);
    toast.show(mail({ id: "m2", name: "Bravo" }), second);
    vi.advanceTimersByTime(200);
    expect(toast.isShown).toBe(true);
    expect(toast.element.querySelector(".mail-toast__who")?.textContent).toBe("Bravo");
    toast.element.querySelector<HTMLButtonElement>(".mail-toast__open")!.click();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("modBadge", () => {
  it("is a short Mod chip with a title", () => {
    const badge = modBadge();
    expect(badge.className).toBe("mail-mod");
    expect(badge.textContent).toBe("Mod");
    expect(badge.title).toBe("Moderator");
  });
});

describe("gmBadge", () => {
  it("is a short GM chip named for the game team, as chat's", () => {
    const badge = gmBadge();
    expect(badge.className).toBe("mail-gm");
    expect(badge.textContent).toBe("GM");
    expect(badge.title).toBe("The game team");
  });
});
