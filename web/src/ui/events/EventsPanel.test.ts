// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { EventView } from "@/api/events";
import { EVENT_EXTRAS, EventsPanel, nextText, type EventsPanelView } from "./EventsPanel";

const DAYS: EventView["calendar"] = {
  days: [
    [{ kind: "resources", amounts: { r1: 10_000, r2: 10_000 } }],
    [{ kind: "shiny", amount: 10 }],
    [{ kind: "speedup", item: "SP2", count: 1 }],
  ],
  claimed: 1,
  canClaim: true,
  nextAt: null,
};

const event = (over: Partial<EventView> = {}): EventView => ({
  id: "halloween-2026",
  title: "Halloween",
  text: "Spooky.",
  kind: "halloween",
  banner: null,
  status: "active",
  startsAt: 0,
  endsAt: 10 * 86_400,
  calendar: DAYS,
  ladder: null,
  claimUntil: null,
  locked: null,
  krallen: null,
  ...over,
});

const list = (events: EventView[], over: Partial<Extract<EventsPanelView, { kind: "list" }>> = {}): EventsPanelView => ({
  kind: "list",
  events,
  now: 3_600,
  claiming: null,
  refusal: null,
  ...over,
});

const mounted = () => {
  const options = { onClaimCalendar: vi.fn(), onClaimTier: vi.fn(), onRetry: vi.fn(), onClose: vi.fn() };
  const panel = new EventsPanel(options).mount(document.body);
  return { panel, options };
};

describe("EventsPanel", () => {
  it("shows the event, its countdown and every calendar day in its state", () => {
    const { panel } = mounted();
    panel.render(list([event()]));
    const root = panel.element;
    expect(root.querySelector(".events-card__title")?.textContent).toBe("Halloween");
    expect(root.querySelector(".events-card__countdown")?.textContent).toBe("Ends in 9d 23h");
    const states = [...root.querySelectorAll(".events-day")].map((day) => day.className.replace("events-day events-day--", ""));
    expect(states).toEqual(["claimed", "today", "locked"]);
    expect(root.querySelector(".events-calendar__count")?.textContent).toBe("1 / 3 claimed");
    panel.close();
  });

  it("claims today's day from the button, which names the reward", () => {
    const { panel, options } = mounted();
    panel.render(list([event()]));
    const button = panel.element.querySelector<HTMLButtonElement>(".events-claim")!;
    expect(button.textContent).toBe("Claim day 210 Shiny");
    button.click();
    expect(options.onClaimCalendar).toHaveBeenCalledWith(expect.objectContaining({ id: "halloween-2026" }));
    panel.close();
  });

  it("waits while a claim runs and shows a refusal under the calendar", () => {
    const { panel } = mounted();
    panel.render(
      list([event()], {
        claiming: "calendar:halloween-2026",
        refusal: { key: "calendar:halloween-2026", message: "Come back tomorrow!" },
      }),
    );
    expect(panel.element.querySelector<HTMLButtonElement>(".events-claim")!.disabled).toBe(true);
    expect(panel.element.querySelector(".events-refusal")?.textContent).toBe("Come back tomorrow!");
    panel.close();
  });

  it("counts down to the next day once today's is claimed, and ticks", () => {
    const { panel } = mounted();
    panel.render(list([event({ calendar: { ...DAYS, canClaim: false, nextAt: 7_200 } })]));
    expect(panel.element.querySelector(".events-claim")).toBeNull();
    const note = panel.element.querySelector(".events-calendar__note")!;
    expect(note.textContent).toBe("Next treat in 1h 0m");
    panel.tick(7_140);
    expect(note.textContent).toBe("Next treat in 1m 0s");
    expect(panel.element.querySelector(".events-card__countdown")?.textContent).toBe(
      "Ends in 9d 22h",
    );
    panel.close();
  });

  it("draws a ladder when the event has one, with Claim on reached tiers", () => {
    const { panel, options } = mounted();
    const ladder = {
      label: "Pumpkins found",
      counter: 6,
      tiers: [
        { need: 5, rewards: [{ kind: "shiny" as const, amount: 5 }], claimed: false },
        { need: 10, rewards: [{ kind: "shiny" as const, amount: 10 }], claimed: false },
      ],
    };
    panel.render(list([event({ ladder })]));
    const tiers = panel.element.querySelectorAll(".events-tier");
    expect(tiers).toHaveLength(2);
    expect(tiers[0]!.classList.contains("events-tier--ready")).toBe(true);
    tiers[0]!.querySelector<HTMLButtonElement>(".events-tier__claim")!.click();
    expect(options.onClaimTier).toHaveBeenCalledWith(expect.objectContaining({ id: "halloween-2026" }), 0);
    expect(tiers[1]!.querySelector(".events-tier__claim")).toBeNull();
    panel.close();
  });

  it("has a slot an event's own feature can fill", () => {
    EVENT_EXTRAS.set("halloween", () => {
      const box = document.createElement("p");
      box.textContent = "Hunt!";
      return box;
    });
    const { panel } = mounted();
    panel.render(list([event()]));
    expect(panel.element.querySelector('.events-card__extra[data-event="halloween-2026"]')?.textContent).toBe("Hunt!");
    EVENT_EXTRAS.clear();
    panel.close();
  });

  it("lists what is coming up with a countdown to its start", () => {
    const { panel } = mounted();
    panel.render(list([event({ id: "winter", title: "Winter", status: "upcoming", startsAt: 3_600 + 2 * 86_400 })]));
    expect(panel.element.querySelector(".events-status")?.textContent).toBe("No event is on right now.");
    expect(panel.element.querySelector(".events-upcoming__title")?.textContent).toBe("Winter");
    expect(panel.element.querySelector(".events-upcoming .events-card__countdown")?.textContent).toBe("Starts in 2d 0h");
    panel.close();
  });

  it("offers a retry when the list could not be read", () => {
    const { panel, options } = mounted();
    panel.render({ kind: "error", message: "Could not load." });
    panel.element.querySelector<HTMLButtonElement>(".events-status__retry")!.click();
    expect(options.onRetry).toHaveBeenCalled();
    panel.close();
  });

  it("says when the next treat is ready", () => {
    expect(nextText(0)).toBe("Next treat is ready: reopen Events");
  });
});

describe("EventsPanel: the Krallen Hunt", () => {
  const hunt = (counter: number, over: Partial<EventView> = {}): EventView =>
    event({
      id: "krallen-2026-11",
      title: "Krallen Hunt",
      kind: "krallen",
      calendar: null,
      ladder: { label: "Loot taken", counter, tiers: [{ need: 100_000_000, rewards: [{ kind: "krallen" }], claimed: false }] },
      claimUntil: 10 * 86_400 + 7 * 86_400,
      krallen: { level: 0, maxLevel: 5 },
      ...over,
    });

  it("draws a bar toward the goal, the prize with her portrait, and no claim before the goal", () => {
    const { panel } = mounted();
    panel.render(list([hunt(25_000_000)]));
    const root = panel.element;
    const bar = root.querySelector<HTMLElement>(".events-krallen__bar")!;
    expect(bar.getAttribute("aria-valuenow")).toBe("25000000");
    expect(root.querySelector<HTMLElement>(".events-krallen__fill")!.style.width).toBe("25%");
    expect(root.querySelector(".events-krallen .events-calendar__count")?.textContent).toBe("25M / 100M");
    expect(root.querySelector(".events-krallen__prize-text")?.textContent).toBe("Win Krallen, a champion of your own");
    expect(root.querySelector<HTMLImageElement>(".events-krallen__portrait")!.src).toContain("portraits/G5.webp");
    expect(root.querySelector(".events-krallen__claim")).toBeNull();
    expect(root.querySelector(".events-ladder")).toBeNull();
    panel.close();
  });

  it("claims at the goal, naming the next level", () => {
    const { panel, options } = mounted();
    panel.render(list([hunt(120_000_000, { krallen: { level: 2, maxLevel: 5 } })]));
    const button = panel.element.querySelector<HTMLButtonElement>(".events-krallen__claim")!;
    expect(button.textContent).toBe("Raise Krallen to level 3Goal reached!");
    expect(panel.element.querySelector<HTMLElement>(".events-krallen__fill")!.style.width).toBe("100%");
    button.click();
    expect(options.onClaimTier).toHaveBeenCalledWith(expect.objectContaining({ id: "krallen-2026-11" }), 0);
    panel.close();
  });

  it("at level 5: the polite note and no claim", () => {
    const { panel } = mounted();
    panel.render(list([hunt(120_000_000, { krallen: { level: 5, maxLevel: 5 } })]));
    expect(panel.element.querySelector(".events-krallen__prize-text")?.textContent).toContain("already level 5");
    expect(panel.element.querySelector(".events-krallen__claim")).toBeNull();
    panel.close();
  });

  it("locked below Town Hall 6: the reason, no bar", () => {
    const { panel } = mounted();
    panel.render(list([hunt(0, { locked: "Reach Town Hall 6 to take part." })]));
    expect(panel.element.querySelector(".events-krallen__locked")?.textContent).toBe("Reach Town Hall 6 to take part.");
    expect(panel.element.querySelector(".events-krallen__bar")).toBeNull();
    panel.close();
  });

  it("ended: listed with the ones on now, counting down to the claim deadline", () => {
    const { panel } = mounted();
    panel.render(list([hunt(100_000_000, { status: "ended" })], { now: 11 * 86_400 }));
    const card = panel.element.querySelector(".events-card--ended")!;
    expect(card.querySelector(".events-card__countdown")?.textContent).toMatch(/^Ended: claim by .+ \(6d 0h left\)$/);
    expect(card.querySelector(".events-krallen__claim")).not.toBeNull();
    panel.tick(12 * 86_400);
    expect(card.querySelector(".events-card__countdown")?.textContent).toMatch(/\(5d 0h left\)$/);
    panel.close();
  });

  it("claimed: a tick and when the next hunt starts", () => {
    const { panel } = mounted();
    const claimed = hunt(100_000_000);
    claimed.ladder!.tiers[0]!.claimed = true;
    panel.render(list([claimed]));
    expect(panel.element.querySelector(".events-krallen__done")?.textContent).toBe("Prize claimed. The next hunt starts on the 15th.");
    panel.close();
  });
});
