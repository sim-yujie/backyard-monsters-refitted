// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventsActions, EventsApi, EventView, Mr2WelcomeStatus } from "@/api/events";
import { notePumpkins } from "@/game/events/pumpkinHunt";
import { resetWeekend, setWeekend, setWeekendCheckin, type WeekendCheckin, type WeekendRun } from "@/game/weekend";
import { Notices } from "@/ui/maproom/Notices";
import type { YardMounts } from "../yardPlugins";
import { EventsDoor } from "./events";

// The "What's new" pop-up is another test's business; keep it quiet here.
vi.mock("@/game/events/whatsNew", () => ({
  latestRelease: () => null,
  localSeen: () => null,
  markSeen: () => Promise.resolve(),
  whatsNewDecision: () => "none",
}));

/**
 * Bug report #10 (4 Nov 2026): a player picked pumpkins and never found the
 * Shiny the ladder pays, because its Claim waits on the Events page under
 * the 14 calendar days, below the fold on a phone. A pumpkin that reaches a
 * tier now says so with a Claim button, and the page opens at the Claim.
 */

const hunt = (counter: number, claimed: readonly boolean[] = [false, false]): EventView => ({
  id: "halloween-2026",
  title: "Halloween",
  text: "Spooky.",
  kind: "halloween",
  banner: null,
  status: "active",
  startsAt: 0,
  endsAt: 10 * 86_400,
  calendar: null,
  ladder: {
    label: "Pumpkins found",
    counter,
    tiers: [
      { need: 10, rewards: [{ kind: "shiny", amount: 10 }], claimed: claimed[0] ?? false },
      { need: 25, rewards: [{ kind: "resources", amounts: { r1: 25_000 } }], claimed: claimed[1] ?? false },
    ],
  },
  claimUntil: null,
  locked: null,
  krallen: null,
});

let doors: EventsDoor[];

const setup = async (
  events: EventView[],
  mr2Welcome: Mr2WelcomeStatus | null = null,
  checkIn: () => Promise<string | null> = vi.fn(() => Promise.resolve(null)),
) => {
  const notices = new Notices();
  const dock = document.body.appendChild(document.createElement("div"));
  const content = document.body.appendChild(document.createElement("div"));
  const modal = document.body.appendChild(document.createElement("div"));
  const mounts = {
    store: { save: { onboarding: { guide: { state: "done" } } } },
    dock: { element: dock },
    overlay: { content, modal },
    notices,
    scene: { openMap: vi.fn() },
  } as unknown as YardMounts;
  const api = {
    list: vi.fn(() => Promise.resolve({ now: 3_600, events, whatsNewSeen: null, mr2Welcome })),
  } as unknown as EventsApi;
  const actions: EventsActions = { claimCalendar: vi.fn(), claimTier: vi.fn() };
  const door = new EventsDoor(mounts, api, actions, checkIn);
  doors.push(door);
  await door.load();
  return { door, notices, content, mounts };
};

const readyNotice = (notices: Notices) => notices.element.querySelector(".events-ready");
const claimButton = (notices: Notices) =>
  [...notices.element.querySelectorAll("button")].find((button) => button.textContent === "Claim");

beforeEach(() => {
  doors = [];
  document.body.replaceChildren();
});

afterEach(() => {
  for (const door of doors) door.destroy();
  resetWeekend();
  // jsdom has no scrollIntoView; the tests that spy on it add their own.
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

describe("Events: a pumpkin that reaches a ladder tier", () => {
  it("shows the tier's rewards with a Claim button, only when a tier newly opens", async () => {
    const { notices } = await setup([hunt(8)]);
    notePumpkins(9);
    expect(readyNotice(notices)).toBeNull();

    notePumpkins(10);
    const line = readyNotice(notices);
    expect(line?.getAttribute("aria-label")).toBe("10 pumpkins: 10 Shiny to claim in Events");
    expect(line?.querySelector(".events-reward--shiny")).not.toBeNull();
    expect(claimButton(notices)).toBeDefined();

    notices.clear("events-ready");
    notePumpkins(11);
    expect(readyNotice(notices)).toBeNull();
  });

  it("says nothing for a tier already claimed", async () => {
    const { notices } = await setup([hunt(9, [true, false])]);
    notePumpkins(10);
    expect(readyNotice(notices)).toBeNull();
  });

  it("its Claim opens the Events page and scrolls to the Claim there", async () => {
    const scrolled: Element[] = [];
    const scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this);
    });
    Element.prototype.scrollIntoView = scrollIntoView;
    const { notices, content } = await setup([hunt(9)]);
    notePumpkins(10);
    claimButton(notices)?.click();

    const claim = content.querySelector<HTMLButtonElement>("button[data-claim]");
    expect(claim?.textContent).toBe("Claim");
    expect(scrolled).toContain(claim);
    expect(readyNotice(notices)).toBeNull();
  });
});

describe("Events: opening the page", () => {
  it("scrolls to the first Claim when a reward waits", async () => {
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this);
    });
    const { door, content } = await setup([hunt(12)]);
    door.toggle();
    expect(scrolled).toEqual([content.querySelector("button[data-claim]")]);
  });

  it("opens at the top on a computer, with the Frontier Pass in view", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const matchMedia = vi.fn((query: string) => ({ matches: query.includes("width > 620px") }) as MediaQueryList);
    vi.stubGlobal("matchMedia", matchMedia);
    try {
      const { door } = await setup([hunt(12)]);
      door.toggle();
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("leaves the scroll alone when nothing waits", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { door } = await setup([hunt(3)]);
    door.toggle();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

/**
 * Tester, 9 Nov: on a phone the open sheet's top reached the Events button,
 * whose label showed beside the sheet's title and ran under its close button.
 * The button is marked open while its page is, and a phone's CSS hides it then.
 */
describe("Events: the button while its page is open", () => {
  /** The page's own CSS, read as text: jsdom lays nothing out. */
  const eventsCss = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../ui/events/events.css"), "utf8");

  it("is marked open, and shut again when the page's own close is used", async () => {
    const { door, content } = await setup([hunt(3)]);
    door.toggle();
    expect(door.button.getAttribute("aria-expanded")).toBe("true");
    content.querySelector<HTMLButtonElement>('button[aria-label^="Close"]')?.click();
    expect(content.querySelector(".events-panel")).toBeNull();
    expect(door.button.getAttribute("aria-expanded")).toBe("false");
  });

  it("is hidden then on a phone, upright or on its side, and only there", () => {
    const hide = /@media ([^{]+)\{\s*\.events-door\[aria-expanded="true"\] \{\s*visibility: hidden;/.exec(eventsCss);
    expect(hide?.[1]?.trim()).toBe("(width <= 620px), (height <= 500px)");
  });
});

/** New to Map Room 2 (owner, 9 Nov 2026): the card alone keeps the Events button on the yard. */
describe("Events: the New to Map Room 2 card", () => {
  const welcome: Mr2WelcomeStatus = {
    startsAt: 0,
    endsAt: 10 * 86_400,
    daysLeft: 10,
    sets: 7,
    takeover: true,
    kit: true,
    takeoverLeft: 7,
    kitLeft: 7,
    takeoverToday: false,
    kitToday: false,
    nextDayAt: 86_400,
    takeoverUses: [],
    kitUses: [],
  };

  it("shows the Events button for the card when no event is on, and hides it with neither", async () => {
    const { door } = await setup([], welcome);
    expect(door.button.hidden).toBe(false);
    const { door: none } = await setup([]);
    expect(none.button.hidden).toBe(true);
  });

  it("its Go to Map Room 2 closes the page and opens the map", async () => {
    const { door, content, mounts } = await setup([], welcome);
    door.toggle();
    content.querySelector<HTMLButtonElement>(".events-welcome__go")?.click();
    expect(content.querySelector(".events-panel")).toBeNull();
    expect(mounts.scene.openMap).toHaveBeenCalledOnce();
  });
});

describe("Events: the weekend event (owner, 13 Nov: in Events, not a banner on the yard)", () => {
  // The door's clock reads 3,600 (the list's `now`).
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
  const later: WeekendRun = { ...builders, key: "2026-11-21", startsAt: 7 * 86_400, endsAt: 9 * 86_400, announceAt: 6 * 86_400 };

  it("shows the button while it runs, even with no other event, and its card on the page", async () => {
    setWeekend({ active: builders, next: later }, 3_600);
    const { door, content } = await setup([]);
    expect(door.button.hidden).toBe(false);
    door.toggle();
    expect(content.querySelector(".events-card--weekend .events-weekend__title")?.textContent).toBe("Builder's Weekend");
    // The next one waits for this one to end.
    expect(content.querySelector(".events-upcoming")).toBeNull();
    expect(content.querySelector(".events-status")).toBeNull();
  });

  it("its card opens the weekend pop-up, once at a time", async () => {
    setWeekend({ active: builders, next: null }, 3_600);
    const { door, mounts } = await setup([]);
    door.toggle();
    const card = document.querySelector<HTMLButtonElement>("button.events-weekend")!;
    card.click();
    card.click();
    const popups = mounts.overlay.modal.querySelectorAll(".weekend-popup");
    expect(popups).toHaveLength(1);
    expect(popups[0]!.querySelector(".weekend-popup__title")?.textContent).toBe("Builder's Weekend");
  });

  it("none running: no button for a weekend not yet announced, and the next one under Coming up", async () => {
    setWeekend({ active: null, next: later }, 3_600);
    const quiet = await setup([]);
    expect(quiet.door.button.hidden).toBe(true);
    const other: EventView = { ...hunt(0), id: "later-event", status: "upcoming", startsAt: 20 * 86_400 };
    const { door, content } = await setup([other]);
    expect(door.button.hidden).toBe(false);
    door.toggle();
    expect(content.querySelector(".events-card--weekend")).toBeNull();
    const items = [...content.querySelectorAll<HTMLElement>(".events-upcoming__item")].map((item) => item.dataset["event"]);
    expect(items).toEqual(["weekend", other.id]);
  });

  it("draws the card when the weekend starts while the page is open", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    try {
      vi.setSystemTime(0);
      setWeekend({ active: null, next: { ...later, startsAt: 3_605 } }, 3_600);
      const { door, content } = await setup([]);
      door.toggle();
      expect(content.querySelector(".events-card--weekend")).toBeNull();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(content.querySelector(".events-card--weekend")).not.toBeNull();
      expect(door.button.hidden).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  describe("its daily check-in (owner, 13 Nov 2026: 50 Glimmers a day)", () => {
    const waiting: WeekendCheckin = {
      key: builders.key,
      amount: 50,
      day: 1,
      days: 2,
      claimedToday: false,
      marks: [
        { day: 1, claimed: false },
        { day: 2, claimed: false },
      ],
      nextAt: 86_400,
    };
    const done: WeekendCheckin = { ...waiting, claimedToday: true, marks: [{ day: 1, claimed: true }, waiting.marks[1]!] };

    it("a waiting check-in lights the Events badge; checking in on the card clears it", async () => {
      setWeekend({ active: builders, next: null }, 3_600);
      setWeekendCheckin(waiting);
      const checkIn = vi.fn(async () => {
        setWeekendCheckin(done);
        return null;
      });
      const { door, content } = await setup([], null, checkIn);
      const badge = door.button.querySelector<HTMLElement>(".events-badge")!;
      expect(badge.hidden).toBe(false);
      expect(badge.textContent).toBe("1");
      door.toggle();
      const button = content.querySelector<HTMLButtonElement>(".events-card--weekend .weekend-checkin__button")!;
      expect(button.textContent).toBe("Check in50");
      button.click();
      await vi.waitFor(() => expect(content.querySelector(".events-card--weekend .weekend-checkin__done")).not.toBeNull());
      expect(checkIn).toHaveBeenCalledOnce();
      expect(badge.hidden).toBe(true);
      expect(content.querySelector(".events-card--weekend .weekend-checkin__button")).toBeNull();
    });

    it("a check-in for another weekend, or none heard, lights nothing", async () => {
      setWeekend({ active: builders, next: null }, 3_600);
      setWeekendCheckin({ ...waiting, key: "2026-11-07" });
      const { door, content } = await setup([]);
      expect(door.button.querySelector<HTMLElement>(".events-badge")!.hidden).toBe(true);
      door.toggle();
      expect(content.querySelector<HTMLElement>(".events-card--weekend .weekend-checkin")?.dataset["checkin"]).toBe("unknown");
    });

    it("a failed check-in says why on the card", async () => {
      setWeekend({ active: builders, next: null }, 3_600);
      setWeekendCheckin(waiting);
      const { door, content } = await setup([], null, () => Promise.resolve("Could not reach the server."));
      door.toggle();
      content.querySelector<HTMLButtonElement>(".weekend-checkin__button")!.click();
      await vi.waitFor(() =>
        expect(content.querySelector(".weekend-checkin__error")?.textContent).toBe("Could not reach the server."),
      );
    });
  });
});
