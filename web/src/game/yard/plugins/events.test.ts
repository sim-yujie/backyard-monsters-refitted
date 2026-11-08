// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventsActions, EventsApi, EventView } from "@/api/events";
import { notePumpkins } from "@/game/events/pumpkinHunt";
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

const setup = async (events: EventView[]) => {
  const notices = new Notices();
  const dock = document.body.appendChild(document.createElement("div"));
  const content = document.body.appendChild(document.createElement("div"));
  const mounts = {
    store: { save: { onboarding: { guide: { state: "done" } } } },
    dock: { element: dock },
    overlay: { content },
    notices,
  } as unknown as YardMounts;
  const api = {
    list: vi.fn(() => Promise.resolve({ now: 3_600, events, whatsNewSeen: null })),
  } as unknown as EventsApi;
  const actions: EventsActions = { claimCalendar: vi.fn(), claimTier: vi.fn() };
  const door = new EventsDoor(mounts, api, actions);
  doors.push(door);
  await door.load();
  return { door, notices, content };
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
