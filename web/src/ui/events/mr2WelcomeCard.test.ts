// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { Mr2WelcomeStatus } from "@/api/events";
import {
  mr2WelcomeCard,
  paintWelcomeReward,
  paintWelcomeTimeline,
  WELCOME_DAYS,
  WELCOME_HELP,
  WELCOME_SETS,
  WELCOME_STATE_TEXT,
  WELCOME_TITLE,
  welcomeDay,
  welcomeDaysText,
  welcomeLeftText,
} from "./mr2WelcomeCard";

const DAY = 86_400;

const status = (over: Partial<Mr2WelcomeStatus> = {}): Mr2WelcomeStatus => ({
  startsAt: 0,
  endsAt: 10 * DAY,
  daysLeft: 10,
  sets: 7,
  takeover: true,
  kit: true,
  takeoverLeft: 7,
  kitLeft: 7,
  takeoverToday: false,
  kitToday: false,
  nextDayAt: DAY,
  takeoverUses: [],
  kitUses: [],
  ...over,
});

const rowOf = (card: HTMLElement, key: string) => card.querySelector<HTMLElement>(`[data-reward="${key}"]`);
const stateOf = (card: HTMLElement, key: string) => card.querySelector<HTMLElement>(`[data-reward="${key}"] .events-welcome__state`);
const leftOf = (card: HTMLElement, key: string) => card.querySelector(`[data-reward="${key}"] .events-welcome__left`)?.textContent;

describe("the pass's numbers", () => {
  it("10 days, 7 sets (owner, 11 Nov), the same as the server", () => {
    expect(WELCOME_DAYS).toBe(10);
    expect(WELCOME_SETS).toBe(7);
  });

  it("counts whole days left, rounded up, never below one", () => {
    expect(welcomeDaysText(10 * DAY, 0)).toBe("10 days left");
    expect(welcomeDaysText(10 * DAY, 2 * DAY + 1)).toBe("8 days left");
    expect(welcomeDaysText(10 * DAY, 9 * DAY + 5)).toBe("1 day left");
    expect(welcomeDaysText(10 * DAY, 10 * DAY + 60)).toBe("1 day left");
  });

  it("says how many are left of 7", () => {
    expect(welcomeLeftText(5, 7)).toBe("5/7 left");
    expect(welcomeLeftText(0, 7)).toBe("0/7 left");
  });

  it("counts the day of the 10 from the player's own start, kept inside 1 to 10", () => {
    const start = 1_000_000;
    expect(welcomeDay(start, start)).toBe(1);
    expect(welcomeDay(start, start + DAY - 1)).toBe(1);
    expect(welcomeDay(start, start + 3 * DAY + 5)).toBe(4);
    expect(welcomeDay(start, start + 10 * DAY - 1)).toBe(10);
    expect(welcomeDay(start, start + 12 * DAY)).toBe(10);
    expect(welcomeDay(start, start - 5)).toBe(1);
  });
});

const marks = (card: HTMLElement) => [...card.querySelectorAll<HTMLElement>(".events-welcome__timeline [data-day]")];
const stateOfMark = (mark: HTMLElement) =>
  ["gone", "today", "left"].find((name) => mark.classList.contains(`events-welcome__mark--${name}`));

describe("the day timeline", () => {
  it("draws 10 marks: the days gone, today lit, the days left", () => {
    // A player who joined Map Room 2 after launch: their own start, day 4 of 10.
    const start = 5_000_000;
    const card = mr2WelcomeCard(status({ startsAt: start, endsAt: start + 10 * DAY, daysLeft: 7 }), start + 3 * DAY + 60, vi.fn());
    const all = marks(card);
    expect(all.map((mark) => mark.textContent)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    expect(all.map(stateOfMark)).toEqual(["gone", "gone", "gone", "today", "left", "left", "left", "left", "left", "left"]);
    expect(all[3]?.getAttribute("aria-current")).toBe("date");
    expect(card.querySelector(".events-welcome__timeline")?.getAttribute("aria-label")).toBe("Day 4 of 10");
  });

  it("puts each reward's picture over every day it was used", () => {
    const card = mr2WelcomeCard(
      status({ takeoverLeft: 5, kitLeft: 6, takeoverUses: [DAY + 5, 3 * DAY + 5], kitUses: [3 * DAY + 50] }),
      5 * DAY,
      vi.fn(),
    );
    const all = marks(card);
    expect(all[1]?.querySelector('[data-used-reward="takeover"]')).not.toBeNull();
    expect(all[1]?.title).toBe("Day 2: Wild camp takeover used");
    expect(all[3]?.querySelectorAll("[data-used-reward]")).toHaveLength(2);
    expect(all[3]?.title).toBe("Day 4: Wild camp takeover used, Regular Starter Kit used");
    expect(all[0]?.title).toBe("Day 1");
    expect(card.querySelectorAll("[data-used-reward]")).toHaveLength(3);
  });

  it("one picture per reward a day, even with two uses on one pass day (two UTC days)", () => {
    const card = mr2WelcomeCard(status({ takeoverLeft: 5, takeoverUses: [10, DAY - 10] }), DAY, vi.fn());
    expect(marks(card)[0]?.querySelectorAll("[data-used-reward]")).toHaveLength(1);
  });

  it("moves today on as the days pass", () => {
    const card = mr2WelcomeCard(status(), 0, vi.fn());
    const timeline = card.querySelector<HTMLElement>(".events-welcome__timeline")!;
    paintWelcomeTimeline(timeline, 9 * DAY + 1);
    expect(marks(card).map(stateOfMark).slice(8)).toEqual(["gone", "today"]);
    expect(marks(card)[0]?.hasAttribute("aria-current")).toBe(false);
  });
});

describe("mr2WelcomeCard", () => {
  it("shows the title and the days left of 10, with the end kept for the tick", () => {
    const card = mr2WelcomeCard(status(), 3 * DAY, vi.fn());
    expect(card.dataset["event"]).toBe("mr2-welcome");
    expect(card.querySelector(".events-card__title")?.textContent).toBe(WELCOME_TITLE);
    const days = card.querySelector<HTMLElement>("[data-welcome-ends]");
    expect(days?.textContent).toBe("7 days left");
    expect(days?.dataset["welcomeEnds"]).toBe(String(10 * DAY));
    expect(card.querySelector(".events-welcome__days .game-icon--time")).not.toBeNull();
  });

  it("a fresh pass: both 7/7 left and Ready today with a gift", () => {
    const card = mr2WelcomeCard(status(), 0, vi.fn());
    for (const key of ["takeover", "kit"]) {
      const state = stateOf(card, key);
      expect(state?.textContent).toBe("Ready today");
      expect(state?.classList.contains("events-welcome__state--ready")).toBe(true);
      expect(state?.querySelector("svg.events-welcome__state-mark")).not.toBeNull();
      expect(leftOf(card, key)).toBe("7/7 left");
      expect(rowOf(card, key)?.classList.contains("events-welcome__reward--ready")).toBe(true);
    }
    expect(card.querySelector('[data-reward="takeover"] .events-welcome__figure')?.textContent).toBe("10% price");
    expect(card.querySelector('[data-reward="kit"] .events-welcome__figure')?.textContent).toBe("Free");
  });

  it("used today: x/7 left and Used today, back tomorrow; the other reward still Ready today", () => {
    const card = mr2WelcomeCard(
      status({ takeover: false, takeoverLeft: 5, takeoverToday: true, takeoverUses: [10, DAY + 10], kitLeft: 6, kitUses: [20], nextDayAt: 2 * DAY }),
      DAY + 60,
      vi.fn(),
    );
    expect(stateOf(card, "takeover")?.textContent).toBe("Used today, back tomorrow");
    expect(stateOf(card, "takeover")?.classList.contains("events-welcome__state--today")).toBe(true);
    expect(leftOf(card, "takeover")).toBe("5/7 left");
    expect(rowOf(card, "takeover")?.dataset["backAt"]).toBe(String(2 * DAY));
    expect(stateOf(card, "kit")?.textContent).toBe("Ready today");
    expect(leftOf(card, "kit")).toBe("6/7 left");
    // The kit is ready today, so the way to Map Room 2 stays.
    expect(card.querySelector(".events-welcome__go")).not.toBeNull();
  });

  it("a reward used today is Ready today again at the daily reset (the panel's tick)", () => {
    const card = mr2WelcomeCard(status({ takeover: false, takeoverLeft: 6, takeoverToday: true, nextDayAt: DAY }), DAY - 60, vi.fn());
    const row = rowOf(card, "takeover")!;
    paintWelcomeReward(row, DAY - 1);
    expect(stateOf(card, "takeover")?.textContent).toBe(WELCOME_STATE_TEXT.today);
    paintWelcomeReward(row, DAY);
    expect(stateOf(card, "takeover")?.textContent).toBe(WELCOME_STATE_TEXT.ready);
    expect(row.dataset["backAt"]).toBeUndefined();
  });

  it("all 7 used: 0/7 left and All used, the card stays; no Go to Map Room 2 with nothing ready", () => {
    const card = mr2WelcomeCard(
      status({ takeover: false, kit: false, takeoverLeft: 0, kitLeft: 0, kitToday: true }),
      4 * DAY,
      vi.fn(),
    );
    for (const key of ["takeover", "kit"]) {
      expect(stateOf(card, key)?.textContent).toBe("All used");
      expect(stateOf(card, key)?.classList.contains("events-welcome__state--done")).toBe(true);
      expect(rowOf(card, key)?.classList.contains("events-welcome__reward--done")).toBe(true);
      expect(leftOf(card, key)).toBe("0/7 left");
    }
    // All used wins over used today, and does not come back at the reset.
    expect(rowOf(card, "kit")?.dataset["backAt"]).toBeUndefined();
    expect(card.querySelector("[data-welcome-ends]")?.textContent).toBe("6 days left");
    expect(card.querySelector(".events-welcome__go")).toBeNull();
  });

  it("opens and closes the short note from the ?", () => {
    const card = mr2WelcomeCard(status(), 0, vi.fn());
    const help = card.querySelector<HTMLButtonElement>(".events-welcome__help-button");
    const note = card.querySelector<HTMLElement>(".events-welcome__help");
    expect(help?.textContent).toBe("?");
    expect(help?.getAttribute("aria-controls")).toBe(note?.id);
    expect(note?.hidden).toBe(true);
    expect(help?.getAttribute("aria-expanded")).toBe("false");

    help?.click();
    expect(note?.hidden).toBe(false);
    expect(help?.getAttribute("aria-expanded")).toBe("true");
    const text = note?.textContent ?? "";
    for (const line of Object.values(WELCOME_HELP)) expect(text).toContain(line);
    expect(text).toContain("10%");
    // The numbers come from WELCOME_SETS and WELCOME_DAYS, never typed.
    expect(WELCOME_HELP.lead).toBe("Frontier Pass: 7 sets over your first 10 days in Map Room 2.");
    expect(WELCOME_HELP.days).toBe("1 set a day, on any 7 of the 10 days. New day at 00:00 UTC.");

    help?.click();
    expect(note?.hidden).toBe(true);
    expect(help?.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps the note short: one lead line and three lines", () => {
    const card = mr2WelcomeCard(status(), 0, vi.fn());
    expect(card.querySelectorAll(".events-welcome__help-line")).toHaveLength(3);
    for (const line of Object.values(WELCOME_HELP)) expect(line.length).toBeLessThanOrEqual(80);
  });

  it("goes to Map Room 2 from its button", () => {
    const onGo = vi.fn();
    const card = mr2WelcomeCard(status(), 0, onGo);
    const go = card.querySelector<HTMLButtonElement>(".events-welcome__go");
    expect(go?.textContent).toBe("Go to Map Room 2");
    go?.click();
    expect(onGo).toHaveBeenCalledOnce();
  });
});
