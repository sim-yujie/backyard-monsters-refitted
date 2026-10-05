// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnlockInbox, type UnlockCard } from "@/game/achievements/unlockInbox";
import { CARD_MS, EARNED_MANY_TEXT, EARNED_TEXT, GAP_MS, UnlockPopup } from "./UnlockPopup";

/** The unlock card: what it says, its 6 s, the queue behind it, View and the hold (#204, WP6). */

const live = (id: number, shiny = 10) => ({ id, name: `Ach ${id}`, shiny });
const backfilled = (id: number) => ({ id, name: `Ach ${id}`, shiny: 5, backfill: true as const });

let inbox: UnlockInbox;
let shown: UnlockCard[];
let opener: (() => void) | null;
let popup: UnlockPopup;

const card = () => popup.element.querySelector<HTMLElement>(".ach-card");
const text = (selector: string) => popup.element.querySelector(selector)?.textContent ?? null;
const click = (selector: string) => popup.element.querySelector<HTMLButtonElement>(selector)!.click();

beforeEach(() => {
  vi.useFakeTimers();
  inbox = new UnlockInbox();
  shown = [];
  opener = null;
  popup = new UnlockPopup({ inbox, onShown: (one) => shown.push(one), opener: () => opener });
  document.body.append(popup.element);
});

afterEach(() => {
  popup.destroy();
  vi.useRealTimers();
});

describe("UnlockPopup", () => {
  it("shows a card as soon as an unlock arrives, with its name and Shiny", () => {
    inbox.add([live(2, 10)]);
    expect(text(".ach-card__kicker")).toBe(EARNED_TEXT);
    expect(text(".ach-card__name")).toBe("Ach 2");
    expect(text(".ach-card__shiny")).toContain("+10");
    expect(popup.element.querySelector(".ach-card__shiny")!.getAttribute("aria-label")).toBe("+10 Shiny");
    expect(shown).toHaveLength(1);
    expect(popup.element.getAttribute("role")).toBe("status");
  });

  it("leaves the Shiny line off a card that paid none", () => {
    inbox.add([live(2, 0)]);
    expect(popup.element.querySelector(".ach-card__shiny")).toBeNull();
  });

  it("goes after six seconds and the next waiting card follows", () => {
    inbox.add([live(1), live(2)]);
    expect(text(".ach-card__name")).toBe("Ach 1");
    vi.advanceTimersByTime(CARD_MS - 1);
    expect(card()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(card()).toBeNull();
    vi.advanceTimersByTime(GAP_MS);
    expect(text(".ach-card__name")).toBe("Ach 2");
    expect(shown.map((one) => one.unlocks[0]!.id)).toEqual([1, 2]);
    vi.advanceTimersByTime(CARD_MS + GAP_MS);
    expect(card()).toBeNull();
  });

  it("shows the backfill's unlocks as one summary card", () => {
    inbox.add([backfilled(1), backfilled(2), backfilled(3)]);
    expect(text(".ach-card__kicker")).toBe(EARNED_MANY_TEXT);
    expect(text(".ach-card__name")).toBe("3 achievements for what you had already done");
    expect(text(".ach-card__names")).toBe("Ach 1, Ach 2 and Ach 3");
    expect(text(".ach-card__shiny")).toContain("+15");
    expect(shown).toHaveLength(1);
  });

  it("the close button takes the card down at once", () => {
    inbox.add([live(1), live(2)]);
    click(".ach-card__close");
    expect(card()).toBeNull();
    vi.advanceTimersByTime(GAP_MS);
    expect(text(".ach-card__name")).toBe("Ach 2");
  });

  it("hides View until the achievements screen can open", () => {
    inbox.add([live(1)]);
    expect(popup.element.querySelector(".ach-card__view")).toBeNull();
  });

  it("View opens the screen and takes the card down", () => {
    const open = vi.fn();
    opener = open;
    inbox.add([live(1)]);
    click(".ach-card__view");
    expect(open).toHaveBeenCalledTimes(1);
    expect(card()).toBeNull();
  });

  it("stays up while the pointer is on it, then gets a fresh six seconds", () => {
    inbox.add([live(1)]);
    card()!.dispatchEvent(new Event("pointerenter"));
    vi.advanceTimersByTime(CARD_MS * 3);
    expect(card()).not.toBeNull();
    card()!.dispatchEvent(new Event("pointerleave"));
    vi.advanceTimersByTime(CARD_MS - 1);
    expect(card()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(card()).toBeNull();
  });

  it("keeps cards back while held, and shows them when let go", () => {
    popup.hold(true);
    inbox.add([live(1)]);
    vi.advanceTimersByTime(CARD_MS * 2);
    expect(card()).toBeNull();
    expect(shown).toHaveLength(0);
    popup.hold(false);
    expect(text(".ach-card__name")).toBe("Ach 1");
    expect(shown).toHaveLength(1);
  });

  it("lets a card already up finish when a hold starts", () => {
    inbox.add([live(1), live(2)]);
    popup.hold(true);
    expect(card()).not.toBeNull();
    vi.advanceTimersByTime(CARD_MS + GAP_MS * 2);
    expect(card()).toBeNull();
    expect(shown).toHaveLength(1);
  });

  it("shows nothing more once destroyed", () => {
    popup.destroy();
    inbox.add([live(1)]);
    expect(shown).toHaveLength(0);
  });
});
