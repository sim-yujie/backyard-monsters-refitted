// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventsActions, EventsApi } from "@/api/events";
import { quietLogin, setQuietLogin, setQuietLoginFrom } from "@/game/quietLogin";
import type { YardMounts } from "../yardPlugins";

/**
 * A test server's quiet login (`game/quietLogin.ts`, server `QUIET_LOGIN`):
 * with it on, the pop-ups that open by themselves on login stay shut and
 * nothing is marked seen; with it off, each opens as before. The yard
 * plugins whose own tests do not cover it are checked here, against
 * stand-ins for what each would open.
 */

const spies = vi.hoisted(() => ({
  whatsNewMarkSeen: vi.fn(() => Promise.resolve()),
  openWhatsNew: vi.fn(),
  suggestLowOnce: vi.fn(() => () => undefined),
  queueStart: vi.fn(() => Promise.resolve()),
  fetchModerationNotice: vi.fn(() => Promise.resolve(null)),
  openWeekendPopup: vi.fn(),
}));

vi.mock("@/game/events/whatsNew", () => ({
  latestRelease: () => ({ version: "6.15" }),
  localSeen: () => null,
  markSeen: spies.whatsNewMarkSeen,
  whatsNewDecision: () => "show",
}));
vi.mock("@/ui/events/WhatsNewDialog", () => ({
  modalLayer: () => document.body,
  openWhatsNew: spies.openWhatsNew,
  isWhatsNewOpen: () => false,
}));
vi.mock("@/game/slowInternet", () => ({ suggestLowOnce: spies.suggestLowOnce }));
vi.mock("@/game/announcements/announcementQueue", () => ({
  AnnouncementQueue: class {
    start = spies.queueStart;
    stop = vi.fn();
  },
  guideRunning: () => false,
}));
vi.mock("@/ui/announcements/announcementGift", () => ({ onGiftClaimed: () => () => undefined }));
vi.mock("@/api/moderation", () => ({
  fetchModerationNotice: spies.fetchModerationNotice,
  seeModerationNotice: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/game/chat/chatSession", () => ({ worldChat: { onTeam: () => () => undefined } }));
vi.mock("@/api/weekend", () => ({ refreshWeekend: vi.fn(() => Promise.resolve()) }));
vi.mock("@/game/weekend", () => {
  const run = { key: "w1", startsAt: 0, endsAt: 10_000 };
  return {
    announcedWeekend: () => null,
    currentWeekend: () => ({ active: run, next: null }),
    onWeekendChange: () => () => undefined,
    runningWeekend: () => run,
    weekendNow: () => 100,
  };
});
vi.mock("@/ui/events/weekendUi", () => ({
  openWeekendPopup: spies.openWeekendPopup,
  WeekendBanner: class {
    element = document.createElement("div");
    update = vi.fn();
  },
}));

const { EventsDoor } = await import("./events");
const { slowInternetPlugin } = await import("./slowInternet");
const { announcementsPlugin } = await import("./announcements");
const { teamNoticePlugin } = await import("./teamNotice");
const { weekendPlugin } = await import("./weekend");
const { Notices } = await import("@/ui/maproom/Notices");

const mountsOf = (): YardMounts => {
  const notices = new Notices();
  const dock = document.body.appendChild(document.createElement("div"));
  const content = document.body.appendChild(document.createElement("div"));
  const modal = document.body.appendChild(document.createElement("div"));
  return {
    store: { kind: "main", save: { onboarding: { guide: { state: "done" } } }, subscribe: () => () => undefined },
    dock: { element: dock },
    overlay: { content, modal },
    notices,
    scene: { openMap: vi.fn(), plannerOpen: () => false },
  } as unknown as YardMounts;
};

/** Runs every plugin and the Events door's first read on one stand-in yard. */
const openYard = async (): Promise<Array<() => void>> => {
  const mounts = mountsOf();
  const api = {
    list: vi.fn(() => Promise.resolve({ now: 3_600, events: [], whatsNewSeen: null, mr2Welcome: null })),
  } as unknown as EventsApi;
  const actions: EventsActions = { claimCalendar: vi.fn(), claimTier: vi.fn() };
  const door = new EventsDoor(mounts, api, actions);
  await door.load();
  const stops = [slowInternetPlugin, announcementsPlugin, teamNoticePlugin, weekendPlugin].map((plugin) => plugin(mounts));
  await Promise.resolve();
  return [() => door.destroy(), ...stops.filter((stop): stop is () => void => typeof stop === "function")];
};

let stops: Array<() => void> = [];

beforeEach(() => {
  for (const spy of Object.values(spies)) spy.mockClear();
  window.localStorage.clear();
});

afterEach(() => {
  for (const stop of stops) stop();
  stops = [];
  setQuietLogin(false);
  document.body.replaceChildren();
});

describe("the quiet-login flag", () => {
  it("is on only when the own yard's load carries quietlogin: 1", () => {
    setQuietLoginFrom({ quietlogin: 1 });
    expect(quietLogin()).toBe(true);
    setQuietLoginFrom({});
    expect(quietLogin()).toBe(false);
    setQuietLoginFrom({ quietlogin: "1" });
    expect(quietLogin()).toBe(false);
    setQuietLoginFrom(null);
    expect(quietLogin()).toBe(false);
  });
});

describe("the yard's own pop-ups on login", () => {
  it("off (every player): What's new, Slow internet?, announcements, team notices and the weekend pop-up as before", async () => {
    stops = await openYard();
    expect(spies.openWhatsNew).toHaveBeenCalledTimes(1);
    expect(spies.whatsNewMarkSeen).toHaveBeenCalledWith("6.15");
    expect(spies.suggestLowOnce).toHaveBeenCalledTimes(1);
    expect(spies.queueStart).toHaveBeenCalledTimes(1);
    expect(spies.fetchModerationNotice).toHaveBeenCalledTimes(1);
    expect(spies.openWeekendPopup).toHaveBeenCalledTimes(1);
  });

  it("on (a test server's QUIET_LOGIN): none opens, and none is marked seen", async () => {
    setQuietLoginFrom({ quietlogin: 1 });
    stops = await openYard();
    expect(spies.openWhatsNew).not.toHaveBeenCalled();
    expect(spies.whatsNewMarkSeen).not.toHaveBeenCalled();
    expect(spies.suggestLowOnce).not.toHaveBeenCalled();
    expect(spies.queueStart).not.toHaveBeenCalled();
    expect(spies.fetchModerationNotice).not.toHaveBeenCalled();
    expect(spies.openWeekendPopup).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("bymr.weekend.seen")).toBeNull();
  });
});
