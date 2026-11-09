// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { Mr2WelcomeStatus } from "@/api/events";
import { mr2WelcomeCard, WELCOME_HELP, WELCOME_TITLE, welcomeDaysText } from "./mr2WelcomeCard";

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
