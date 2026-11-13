// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { EventView } from "@/api/events";
import type { WeekendRun } from "@/game/weekend";
import {
  claimedLine,
  EVENT_EXTRAS,
  EventsPanel,
  goalsBar,
  nextText,
  rewardBadge,
  type EventsPanelView,
} from "./EventsPanel";

/** The page's own CSS, read as text: jsdom lays nothing out. */
const eventsCss = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "events.css"), "utf8");

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

  it("draws the banner picture only when there is one, and drops it if the file fails", () => {
    const { panel } = mounted();
    panel.render(list([event(), event({ id: "with-picture", banner: "/events/halloween-2026-banner.png" })]));
    const cards = [...panel.element.querySelectorAll<HTMLElement>(".events-card")];
    expect(cards[0]?.querySelector(".events-card__banner")).toBeNull();
    const band = cards[1]?.querySelector(".events-card__banner");
    expect(band?.querySelector("img")?.getAttribute("src")).toBe("/events/halloween-2026-banner.png");
    band?.querySelector("img")?.dispatchEvent(new Event("error"));
    expect(cards[1]?.querySelector(".events-card__banner")).toBeNull();
    panel.close();
  });

  it("claims today's day from the button, which names the reward", () => {
    const { panel, options } = mounted();
    panel.render(list([event()]));
    const button = panel.element.querySelector<HTMLButtonElement>(".events-claim")!;
    // The reward as its picture and figure, not words, so a phone's button keeps to two lines; the words are its name.
    expect(button.querySelector(".events-claim__label")!.textContent).toBe("Claim day 2");
    expect(button.querySelector(".events-claim__what .events-reward .res-icon")).not.toBeNull();
    expect(button.querySelector(".events-claim__what .events-reward__figure")!.textContent).toBe("10");
    expect(button.getAttribute("aria-label")).toBe("Claim day 2: 10 Shiny");
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

describe("rewardBadge: event coins (beta 7)", () => {
  it("the coin and the amount; claimed, a green +N", () => {
    const offer = rewardBadge({ kind: "eventCoins", amount: 15 });
    expect(offer.querySelector("[data-icon='eventcoin'], img")).not.toBeNull();
    // Drawn like the other painted reward icons (speed-up, Overdrive), so a Thanksgiving day tile lines up.
    expect(offer.querySelector("img.events-reward__icon")).not.toBeNull();
    expect(offer.querySelector(".events-reward__figure")!.textContent).toBe("15");
    const gained = rewardBadge({ kind: "eventCoins", amount: 15 }, true);
    expect(gained.querySelector(".events-reward__figure")!.textContent).toBe("+15");
    expect(gained.classList.contains("events-reward--gain")).toBe(true);
  });
});

describe("claimedLine: a claim's notice", () => {
  it("shows the rewards as badges, the full words on hover and for a screen reader", () => {
    const line = claimedLine("Day 1 claimed", DAYS!.days[0]!);
    expect(line.getAttribute("aria-label")).toBe("Day 1 claimed, gained 10,000 Twigs, 10,000 Pebbles");
    expect(line.title).toBe(line.getAttribute("aria-label"));
    expect(line.querySelector(".events-claimed__title")!.textContent).toBe("Day 1 claimed");
    expect(line.querySelectorAll(".events-reward .res-icon")).toHaveLength(2);
    // Claimed is a gain: "+10K" in green (owner, 28 Oct).
    expect(line.querySelector(".events-reward__figure")!.textContent).toBe("+10K");
    expect(line.querySelector(".events-reward--gain")).not.toBeNull();
  });

  it("leaves the calendar's rewards on offer plain, with no sign", () => {
    const { panel } = mounted();
    panel.render(list([event()]));
    const figures = [...panel.element.querySelectorAll(".events-reward__figure")].map((figure) => figure.textContent);
    expect(figures.length).toBeGreaterThan(0);
    expect(figures.every((figure) => !figure?.startsWith("+"))).toBe(true);
    expect(panel.element.querySelector(".events-reward--gain")).toBeNull();
    panel.close();
  });
});

describe("A day's reward tile (Thanksgiving tester faults, 8 Nov)", () => {
  it("puts Day 5's four piles in a 2 x 2 block, and two piles in a tighter pair", () => {
    const four = rewardBadge({ kind: "resources", amounts: { r1: 20_000, r2: 20_000, r3: 20_000, r4: 20_000 } });
    const block = four.querySelector(".events-reward__pictures");
    expect(block?.classList.contains("events-reward__pictures--block")).toBe(true);
    expect(block?.querySelectorAll(".res-icon")).toHaveLength(4);
    const two = rewardBadge({ kind: "resources", amounts: { r1: 30_000, r2: 30_000 } });
    expect(two.querySelector(".events-reward__pictures--pair")).not.toBeNull();
    expect(two.querySelector(".events-reward__pictures--block")).toBeNull();
  });

  it("keeps a small gap between two piles, never overlapping (Days 1 and 8, 9 Nov)", () => {
    const rule = /\.events-reward__pictures--pair > \.res-icon \+ \.res-icon \{([^}]*)\}/.exec(eventsCss)?.[1] ?? "";
    const gap = /margin-left:\s*(-?\d+)px/.exec(rule)?.[1];
    expect(Number(gap)).toBeGreaterThan(0);
  });

  it("draws speed-ups and Production Overdrive as painted icons, not line icons", () => {
    const speedup = rewardBadge({ kind: "speedup", item: "SP2", count: 2 });
    expect(speedup.querySelector("img.game-icon")?.getAttribute("data-icon")).toBe("speedup");
    expect(speedup.querySelector("svg")).toBeNull();
    const overdrive = rewardBadge({ kind: "shopItem", item: "POD" });
    expect(overdrive.querySelector("img.game-icon")?.getAttribute("data-icon")).toBe("overdrive");
    expect(overdrive.querySelector(".events-reward__figure")?.textContent).toBe("12h");
    const tools = rewardBadge({ kind: "shopItem", item: "BST" });
    expect(tools.querySelector("img.game-icon")?.getAttribute("data-icon")).toBe("tools");
  });

  it("names a decoration under its picture: Day 7's Acorn", () => {
    const acorn = rewardBadge({ kind: "decoration", type: 55, count: 1 });
    expect(acorn.querySelector(".events-reward__figure")?.textContent).toBe("Acorn");
    const two = rewardBadge({ kind: "decoration", type: 55, count: 2 });
    expect(two.querySelector(".events-reward__figure")?.textContent).toBe("Acorn x2");
  });
});

describe("Layout faults (picture tester, 9 Nov)", () => {
  const rule = (selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(eventsCss.replace(/\r\n/g, "\n"))?.[1] ?? "";
  };

  it("pins each day's Glimmers to the tile's foot, so a row's badges line up", () => {
    expect(rule(".events-day__rewards")).toMatch(/flex: 1;/);
    expect(rule(".events-day__rewards > .events-reward--eventCoins")).toMatch(/margin-top: auto;/);
  });

  it("puts a tier's Glimmers in a fixed-width column before a fixed-width end slot", () => {
    const { panel } = mounted();
    const ladder = {
      label: "Turkeys caught",
      counter: 30,
      tiers: [
        { need: 10, rewards: [{ kind: "eventCoins" as const, amount: 20 }], claimed: true },
        { need: 25, rewards: [{ kind: "resources" as const, amounts: { r1: 25_000, r2: 25_000, r3: 25_000, r4: 25_000 } }, { kind: "eventCoins" as const, amount: 35 }], claimed: false },
        { need: 50, rewards: [{ kind: "decoration" as const, type: 55, count: 1 }, { kind: "eventCoins" as const, amount: 55 }], claimed: false },
      ],
    };
    panel.render(list([event({ ladder })]));
    const rows = [...panel.element.querySelectorAll(".events-tier")];
    for (const row of rows) {
      expect(row.querySelector(".events-tier__rewards .events-reward--eventCoins")).toBeNull();
      expect(row.querySelector(".events-tier__coins > .events-reward--eventCoins")).not.toBeNull();
      expect(row.lastElementChild!.classList.contains("events-tier__end")).toBe(true);
    }
    expect(rows[1]!.querySelector(".events-tier__end .events-tier__claim")).not.toBeNull();
    expect(rows[2]!.querySelector(".events-tier__end .events-tier__mark")).not.toBeNull();
    expect(rule(".events-tier__coins")).toMatch(/flex: none;[\s\S]*width: \d+px;/);
    expect(rule(".events-tier__end")).toMatch(/flex: none;[\s\S]*width: \d+px;/);
    panel.close();
  });

  it("keeps every ladder row's lock, tick and Claim inside a 320 px phone", () => {
    // A long name wraps inside the rewards rather than pushing the end slot out.
    expect(rule(".events-tier__rewards")).toMatch(/min-width: 0;/);
    expect(rule(".events-tier__rewards > .events-reward")).toMatch(/min-width: 0;/);
    expect(rule(".events-tier__rewards .events-reward__figure")).toMatch(/white-space: normal;/);
    // The skinned Claim plate's ends and words fit the desktop slot: 2 x cap + 4 + "Claim" (39 px at 13 px).
    const plate = rule(":root[data-skin] .panel .events-tier__end > .events-tier__claim");
    const cap = Number(/--skin-button-cap: (\d+)px;/.exec(plate)?.[1]);
    const slot = Number(/width: (\d+)px;/.exec(rule(".events-tier__end"))?.[1]);
    expect(plate).toMatch(/font-size: var\(--text-sm\);/);
    expect(2 * cap + 4 + 39).toBeLessThanOrEqual(slot);
    // The phone block: what the fixed columns leave for the rewards in a 320 px row (about 246 px inside).
    const css = eventsCss.replace(/\r\n/g, "\n");
    const phone = css.slice(css.indexOf("A phone, down to 320 px"));
    const px = (selector: string, prop: string): number => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const body = new RegExp(`\\n  ${escaped} \\{([^}]*)\\}`).exec(phone)?.[1] ?? "";
      return Number(new RegExp(`${prop}: (\\d+)px;`).exec(body)?.[1]);
    };
    const phoneSlot = px(".events-tier__end", "width");
    const left = 246 - 3 * 8 - px(".events-tier__need", "min-width") - px(".events-tier__coins", "width") - phoneSlot;
    expect(left).toBeGreaterThanOrEqual(71); // "Scarecrow" at 12 px
    // "Claim" at 12 px is 36 px.
    expect(2 * cap + 4 + 36).toBeLessThanOrEqual(phoneSlot);
  });

  it("sets every figure in a row of badges on the same line (the claim notice's +10K and +15)", () => {
    expect(rule(".events-claimed")).toMatch(/align-items: stretch;/);
    expect(rule(".events-claimed__title")).toMatch(/align-self: center;/);
    expect(rule(".events-reward")).toMatch(/justify-content: flex-end;/);
    expect(rule(".events-reward__pictures")).toMatch(/flex: 1 0 auto;/);
    expect(rule(".events-tier")).toMatch(/align-items: stretch;/);
  });

  it("lays the Claim button's rewards in one row of pictures and figures", () => {
    expect(rule(".events-claim__what")).toMatch(/display: flex;/);
    expect(rule(".events-claim__what .events-reward")).toMatch(/flex-direction: row;/);
  });

  it("gives Classic's cream a dark orange for countdowns, not the light one", () => {
    expect(rule(".events-card__countdown")).toMatch(/color: var\(--events-hot-text\);/);
    const classic = /--events-hot-text: #([0-9a-f]{6});/.exec(rule(':root[data-skin="flash"] .events-panel'))?.[1];
    expect(classic).toBeDefined();
    // Relative luminance well under the cream's, at least 4.5:1 against #f3e3c3.
    const lin = (c: number): number => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
    const lum = (hex: string): number => {
      const [r, g, b] = [0, 2, 4].map((i) => lin(parseInt(hex.slice(i, i + 2), 16)));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    expect((lum("f3e3c3") + 0.05) / (lum(classic!) + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("EventsPanel: the New to Map Room 2 card", () => {
  // Day 1: the kit used today, the takeover ready.
  const welcome = {
    startsAt: 0,
    endsAt: 10 * 86_400,
    daysLeft: 10,
    sets: 7,
    takeover: true,
    kit: false,
    takeoverLeft: 7,
    kitLeft: 6,
    takeoverToday: false,
    kitToday: true,
    nextDayAt: 86_400,
    takeoverUses: [],
    kitUses: [60],
  };

  it("puts the card first, before the events, while the days run", () => {
    const { panel } = mounted();
    panel.render(list([event()], { mr2Welcome: welcome }));
    const cards = [...panel.element.querySelectorAll<HTMLElement>(".events-card")];
    expect(cards[0]?.dataset["event"]).toBe("mr2-welcome");
    expect(cards[1]?.querySelector(".events-card__title")?.textContent).toBe("Halloween");
    expect(cards[0]?.querySelector("[data-welcome-ends]")?.textContent).toBe("10 days left");
    expect(cards[0]?.querySelector('[data-reward="takeover"] .events-welcome__state')?.textContent).toBe("Ready today");
    expect(cards[0]?.querySelector('[data-reward="kit"] .events-welcome__state')?.textContent).toBe("Used today, back tomorrow");
    expect(cards[0]?.querySelector(".events-welcome__help-button")?.textContent).toBe("?");
    panel.close();
  });

  it("draws no card when the server sends none, or null", () => {
    const { panel } = mounted();
    panel.render(list([event()]));
    expect(panel.element.querySelector(".events-card--mr2-welcome")).toBeNull();
    panel.render(list([event()], { mr2Welcome: null }));
    expect(panel.element.querySelector(".events-card--mr2-welcome")).toBeNull();
    panel.close();
  });

  it("keeps the card with all 7 of both used", () => {
    const { panel } = mounted();
    panel.render(list([event()], { mr2Welcome: { ...welcome, takeover: false, kit: false, takeoverLeft: 0, kitLeft: 0 } }));
    const card = panel.element.querySelector(".events-card--mr2-welcome");
    expect(card).not.toBeNull();
    expect(card?.querySelectorAll(".events-welcome__state--done")).toHaveLength(2);
    expect(card?.querySelectorAll(".events-welcome__mark")).toHaveLength(10);
    panel.close();
  });

  it("on a computer: the Frontier Pass on top, events in the main column, Coming up at the side", () => {
    const { panel } = mounted();
    const soon = event({ id: "soon", title: "Soon", status: "upcoming", startsAt: 2 * 86_400 });
    panel.render(list([event(), soon], { mr2Welcome: welcome }));
    const page = panel.element.querySelector(".events-page");
    expect([...(page?.children ?? [])].map((child) => child.className.split(" ")[0])).toEqual([
      "events-card",
      "events-page__main",
      "events-upcoming",
    ]);
    expect(page?.classList.contains("events-page--side")).toBe(true);
    expect(page?.querySelector(".events-page__main .events-card__title")?.textContent).toBe("Halloween");
    // Nothing on now: no side column, Coming up under the card.
    panel.render(list([soon], { mr2Welcome: welcome }));
    expect(panel.element.querySelector(".events-page")?.classList.contains("events-page--side")).toBe(false);
    expect(panel.element.querySelector(".events-page__main")).toBeNull();
    const css = eventsCss.replace(/\r\n/g, "\n");
    const desktop = css.slice(css.indexOf("@media (width > 620px) and (height > 500px)"));
    expect(desktop).toMatch(/\.events-panel \{\s*width: min\(1000px/);
    const wide = css.slice(css.indexOf("@media (width >= 1100px) and (height > 500px)"));
    expect(wide).toMatch(/\.events-page > \.events-card--mr2-welcome \{\s*grid-column: 1 \/ -1;/);
    panel.close();
  });

  it("shows only the card, with no 'No event' line, when no event is on", () => {
    const { panel } = mounted();
    panel.render(list([], { mr2Welcome: welcome }));
    expect(panel.element.querySelector(".events-card--mr2-welcome")).not.toBeNull();
    expect(panel.element.querySelector(".events-status")).toBeNull();
    panel.close();
  });

  it("counts the days down on the tick", () => {
    const { panel } = mounted();
    panel.render(list([], { mr2Welcome: welcome }));
    panel.tick(8 * 86_400 + 30);
    expect(panel.element.querySelector("[data-welcome-ends]")?.textContent).toBe("2 days left");
    // The kit used on day 1 is back after the daily reset.
    expect(panel.element.querySelector('[data-reward="kit"] .events-welcome__state')?.textContent).toBe("Ready today");
    expect(panel.element.querySelector('[data-day="9"]')?.classList.contains("events-welcome__mark--today")).toBe(true);
    expect(panel.element.querySelector('[data-day="1"]')?.classList.contains("events-welcome__mark--gone")).toBe(true);
    panel.close();
  });

  it("goes to Map Room 2 from the card's button", () => {
    const onGoToMapRoom2 = vi.fn();
    const panel = new EventsPanel({ onClaimCalendar: vi.fn(), onClaimTier: vi.fn(), onRetry: vi.fn(), onClose: vi.fn(), onGoToMapRoom2 }).mount(document.body);
    panel.render(list([], { mr2Welcome: welcome }));
    const go = panel.element.querySelector<HTMLButtonElement>(".events-welcome__go");
    expect(go?.textContent).toBe("Go to Map Room 2");
    go?.click();
    expect(onGoToMapRoom2).toHaveBeenCalledOnce();
    panel.close();
  });

  it("hides the closed note and drops the days under the title on a phone", () => {
    const css = eventsCss.replace(/\r\n/g, "\n");
    expect(css).toMatch(/\.events-welcome__help\[hidden\] \{\s*display: none;/);
    const phone = css.slice(css.lastIndexOf("@media (width <= 620px)"));
    expect(phone).toMatch(/\.events-welcome__days \{\s*grid-row: 2;/);
    expect(css).toMatch(/:root\[data-skin="flash"\] \.events-card--mr2-welcome \{/);
  });
});

describe("rewardBadge: Korath's powers (Monster Madness)", () => {
  it("shows Flash's power portrait and its short name", () => {
    const badge = rewardBadge({ kind: "korath", power: 2 });
    expect(badge.classList).toContain("events-reward--korath");
    expect(badge.querySelector<HTMLImageElement>(".events-reward__image--korath")!.getAttribute("src")).toBe(
      "/events/korath-power-2.png",
    );
    expect(badge.querySelector(".events-reward__figure")?.textContent).toBe("Fire");
    expect(rewardBadge({ kind: "korath", power: 3 }).querySelector(".events-reward__figure")?.textContent).toBe("Fists");
  });

  it("is never signed as a gain", () => {
    const gained = rewardBadge({ kind: "korath", power: 1 }, true);
    expect(gained.classList).not.toContain("events-reward--gain");
    expect(gained.querySelector(".events-reward__figure")?.textContent).toBe("Burn");
  });
});

describe("EventsPanel: Monster Madness goals", () => {
  const madness = (counter: number): EventView =>
    event({
      id: "monster-madness-1",
      title: "Monster Madness",
      kind: "monster-madness",
      calendar: null,
      ladder: {
        label: "Takeover points",
        counter,
        tiers: [
          { need: 42_000_000, rewards: [{ kind: "korath", power: 1 }], claimed: false },
          { need: 94_500_000, rewards: [{ kind: "korath", power: 2 }], claimed: false },
          { need: 160_125_000, rewards: [{ kind: "korath", power: 3 }], claimed: false },
        ],
      },
    });

  it("draws one bar to the top goal, with a tick at each goal", () => {
    const bar = goalsBar(madness(50_000_000).ladder!);
    expect(bar.querySelector<HTMLElement>(".events-goals__fill")!.style.width).toBe("31.2%");
    const ticks = [...bar.querySelectorAll<HTMLElement>(".events-goals__tick")];
    expect(ticks.map((tick) => tick.style.left)).toEqual(["26.2%", "59%", "100%"]);
    expect(ticks.map((tick) => tick.classList.contains("events-goals__tick--done"))).toEqual([true, false, false]);
    expect([...bar.querySelectorAll(".events-goals__mark")].map((mark) => mark.textContent)).toEqual([
      "42M",
      "94.5M",
      "160.1M",
    ]);
    expect(bar.querySelector(".events-goals__bar")!.getAttribute("aria-valuenow")).toBe("50000000");
  });

  it("is on the Monster Madness card only", () => {
    const { panel } = mounted();
    panel.render(list([madness(50_000_000)]));
    expect(panel.element.querySelector(".events-ladder--goals .events-goals__bar")).not.toBeNull();
    expect(panel.element.querySelectorAll(".events-tier__claim")).toHaveLength(1);
  });
});

describe("EventsPanel: the weekend event (owner, 13 Nov: in Events, not a banner on the yard)", () => {
  const builders: WeekendRun = {
    id: "builders",
    title: "Builder's Weekend",
    line: "Upgrades cost 30% less",
    percent: 30,
    key: "2026-11-14",
    startsAt: 0,
    endsAt: 2 * 86_400,
    announceAt: -86_400,
    forced: false,
  };
  const later: WeekendRun = { ...builders, key: "2026-11-21", startsAt: 7 * 86_400, endsAt: 9 * 86_400 };

  it("while it runs: a card first in the main column, icon, name, −30%, its line and the time left", () => {
    const { panel } = mounted();
    panel.render(list([event()], { weekend: { on: builders, next: null } }));
    const main = panel.element.querySelector(".events-page__main")!;
    const card = main.firstElementChild as HTMLElement;
    expect(card.classList.contains("events-card--weekend")).toBe(true);
    expect(card.dataset["event"]).toBe("weekend");
    expect(card.querySelector<HTMLImageElement>(".events-weekend__icon")?.dataset["icon"]).toBe("levelup");
    expect(card.querySelector(".events-weekend__title")?.textContent).toBe("Builder's Weekend");
    expect(card.querySelector(".events-weekend__amount")?.textContent).toBe("−30%");
    expect(card.querySelector(".events-weekend__line")?.textContent).toBe("Upgrades cost 30% less");
    expect(card.querySelector(".events-card__countdown")?.textContent).toBe("Ends in 1d 23h");
    // The Halloween card still follows it; nothing else went.
    expect(main.querySelectorAll(".events-card")).toHaveLength(2);
    expect(panel.element.querySelector(".events-upcoming")).toBeNull();
    panel.close();
  });

  it("ticks its time left with the page's other countdowns", () => {
    const { panel } = mounted();
    panel.render(list([], { weekend: { on: builders, next: null } }));
    panel.tick(builders.endsAt - 90 * 60);
    expect(panel.element.querySelector(".events-weekend .events-card__countdown")?.textContent).toBe("Ends in 1h 30m");
    panel.close();
  });

  it("opens the weekend pop-up when pressed", () => {
    const options = { onClaimCalendar: vi.fn(), onClaimTier: vi.fn(), onRetry: vi.fn(), onClose: vi.fn(), onOpenWeekend: vi.fn() };
    const panel = new EventsPanel(options).mount(document.body);
    panel.render(list([], { weekend: { on: builders, next: null } }));
    panel.element.querySelector<HTMLButtonElement>("button.events-weekend")!.click();
    expect(options.onOpenWeekend).toHaveBeenCalledWith(builders);
    panel.close();
  });

  it("no 'No event' line while only the weekend runs", () => {
    const { panel } = mounted();
    panel.render(list([], { weekend: { on: builders, next: null } }));
    expect(panel.element.querySelector(".events-status")).toBeNull();
    expect(panel.element.querySelectorAll(".events-card--weekend")).toHaveLength(1);
    panel.close();
  });

  it("none running: the next one under Coming up, in its place by start, counting down to it", () => {
    const { panel } = mounted();
    const soon = event({ id: "soon", title: "Soon", status: "upcoming", startsAt: 2 * 86_400 });
    const late = event({ id: "late", title: "Late", status: "upcoming", startsAt: 20 * 86_400 });
    panel.render(list([soon, late], { weekend: { on: null, next: later } }));
    expect(panel.element.querySelector(".events-card--weekend")).toBeNull();
    const items = [...panel.element.querySelectorAll<HTMLElement>(".events-upcoming__item")];
    expect(items.map((item) => item.dataset["event"])).toEqual(["soon", "weekend", "late"]);
    const weekend = items[1]!;
    expect(weekend.querySelector(".events-weekend__title")?.textContent).toBe("Builder's Weekend");
    expect(weekend.querySelector(".events-weekend__amount")?.textContent).toBe("−30%");
    expect(weekend.querySelector(".events-upcoming__text")?.textContent).toBe("Upgrades cost 30% less");
    expect(weekend.querySelector(".events-card__countdown")?.textContent).toBe("Starts in 6d 23h");
    expect(panel.element.querySelector(".events-status")?.textContent).toBe("No event is on right now.");
    panel.close();
  });

  it("none running and none known: nothing extra", () => {
    const { panel } = mounted();
    panel.render(list([], { weekend: { on: null, next: null } }));
    expect(panel.element.querySelector("[data-event='weekend']")).toBeNull();
    expect(panel.element.querySelector(".events-upcoming")).toBeNull();
    expect(panel.element.querySelector(".events-status")?.textContent).toBe("No event is on right now.");
    panel.close();
  });
});
