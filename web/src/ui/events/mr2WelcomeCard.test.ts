// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { Mr2WelcomeStatus } from "@/api/events";
import { mr2WelcomeCard, paintWelcomeTimeline, WELCOME_HELP, WELCOME_TITLE, welcomeDay, welcomeDaysText } from "./mr2WelcomeCard";

const DAY = 86_400;

const status = (over: Partial<Mr2WelcomeStatus> = {}): Mr2WelcomeStatus => ({
  startsAt: 0,
  endsAt: 10 * DAY,
  daysLeft: 10,
  takeover: true,
  kit: true,
  ...over,
});

const stateOf = (card: HTMLElement, key: string) => card.querySelector<HTMLElement>(`[data-reward="${key}"] .events-welcome__state`);

describe("welcomeDaysText", () => {
  it("counts whole days left, rounded up, never below one", () => {
    expect(welcomeDaysText(10 * DAY, 0)).toBe("10 days left");
    expect(welcomeDaysText(10 * DAY, 2 * DAY + 1)).toBe("8 days left");
    expect(welcomeDaysText(10 * DAY, 9 * DAY + 5)).toBe("1 day left");
    expect(welcomeDaysText(10 * DAY, 10 * DAY + 60)).toBe("1 day left");
  });
});

describe("welcomeDay", () => {
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

  it("puts each used reward's picture over the day it was used, if the server knows it", () => {
    const card = mr2WelcomeCard(
      status({ takeover: false, kit: false, takeoverUsedAt: DAY + 5, kitUsedAt: 3 * DAY + 5 }),
      5 * DAY,
      vi.fn(),
    );
    const all = marks(card);
    expect(all[1]?.querySelector('[data-used-reward="takeover"]')).not.toBeNull();
    expect(all[1]?.title).toBe("Day 2: Wild camp takeover used");
    expect(all[3]?.querySelector('[data-used-reward="kit"]')).not.toBeNull();
    expect(card.querySelectorAll("[data-used-reward]")).toHaveLength(2);
  });

  it("both on one day: both pictures on that mark; a reward used with no day known: none", () => {
    const same = mr2WelcomeCard(status({ takeover: false, kit: false, takeoverUsedAt: 10, kitUsedAt: 20 }), DAY, vi.fn());
    expect(marks(same)[0]?.querySelectorAll("[data-used-reward]")).toHaveLength(2);
    const unknown = mr2WelcomeCard(status({ takeover: false, kit: false }), DAY, vi.fn());
    expect(unknown.querySelectorAll("[data-used-reward]")).toHaveLength(0);
    // A time sent with a reward still ready is not drawn.
    const ready = mr2WelcomeCard(status({ takeoverUsedAt: 10 }), DAY, vi.fn());
    expect(ready.querySelectorAll("[data-used-reward]")).toHaveLength(0);
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
  it("shows the title and the days left, with the end kept for the tick", () => {
    const card = mr2WelcomeCard(status(), 3 * DAY, vi.fn());
    expect(card.dataset["event"]).toBe("mr2-welcome");
    expect(card.querySelector(".events-card__title")?.textContent).toBe(WELCOME_TITLE);
    const days = card.querySelector<HTMLElement>("[data-welcome-ends]");
    expect(days?.textContent).toBe("7 days left");
    expect(days?.dataset["welcomeEnds"]).toBe(String(10 * DAY));
    expect(card.querySelector(".events-welcome__days .game-icon--time")).not.toBeNull();
  });

  it("marks both rewards Ready with a gift while they are unused", () => {
    const card = mr2WelcomeCard(status(), 0, vi.fn());
    for (const key of ["takeover", "kit"]) {
      const state = stateOf(card, key);
      expect(state?.textContent).toBe("Ready");
      expect(state?.classList.contains("events-welcome__state--ready")).toBe(true);
      expect(state?.querySelector("svg.events-welcome__state-mark")).not.toBeNull();
      expect(card.querySelector(`[data-reward="${key}"]`)?.classList.contains("events-welcome__reward--used")).toBe(false);
    }
    expect(card.querySelector('[data-reward="takeover"] .events-welcome__figure')?.textContent).toBe("10% price");
    expect(card.querySelector('[data-reward="kit"] .events-welcome__figure')?.textContent).toBe("Free");
  });

  it("marks a used reward Used and leaves the other Ready", () => {
    const card = mr2WelcomeCard(status({ takeover: false }), 0, vi.fn());
    expect(stateOf(card, "takeover")?.textContent).toBe("Used");
    expect(stateOf(card, "takeover")?.classList.contains("events-welcome__state--used")).toBe(true);
    expect(card.querySelector('[data-reward="takeover"]')?.classList.contains("events-welcome__reward--used")).toBe(true);
    expect(stateOf(card, "kit")?.textContent).toBe("Ready");
    // One reward is left, so the way to Map Room 2 stays.
    expect(card.querySelector(".events-welcome__go")).not.toBeNull();
  });

  it("stays with both rewards used, each Used, with no Go to Map Room 2 left", () => {
    const card = mr2WelcomeCard(status({ takeover: false, kit: false }), 4 * DAY, vi.fn());
    expect(stateOf(card, "takeover")?.textContent).toBe("Used");
    expect(stateOf(card, "kit")?.textContent).toBe("Used");
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
