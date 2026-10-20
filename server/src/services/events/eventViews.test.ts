import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { eventsAnswer, WhatsNewSeenSchema } from "../../controllers/events/eventsState.js";
import type { User } from "../../database/models/user.model.js";
import { KRALLEN_HUNT_GOAL, krallenHunt, type EventDefinition } from "../../game-data/events/events.js";
import { eventView } from "./eventViews.js";
import { memoryProgressStore, NO_PROGRESS } from "./progressStore.js";

const DAY = 86_400;
const START = Date.UTC(2030, 0, 1) / 1000;
const EVENT: EventDefinition = {
  id: "e",
  title: "E",
  text: "t",
  kind: "test",
  startsAt: new Date(START * 1000).toISOString(),
  endsAt: new Date((START + 3 * DAY) * 1000).toISOString(),
  calendar: [
    { rewards: [{ kind: "shiny", amount: 1 }] },
    { rewards: [{ kind: "shiny", amount: 2 }] },
  ],
};
const window = { startsAt: START, endsAt: START + 3 * DAY };

describe("eventView", () => {
  test("an upcoming event shows its calendar but nothing to claim", () => {
    const view = eventView({ event: EVENT, window, status: "upcoming" }, NO_PROGRESS, START - DAY);
    expect(view).toMatchObject({ id: "e", status: "upcoming", startsAt: START, banner: null, ladder: null });
    expect(view.calendar).toEqual({ days: [[{ kind: "shiny", amount: 1 }], [{ kind: "shiny", amount: 2 }]], claimed: 0, canClaim: false, nextAt: null });
  });

  test("active: claimable until today's is claimed, then the next UTC midnight; nothing after the last day", () => {
    const active = { event: EVENT, window, status: "active" as const };
    expect(eventView(active, NO_PROGRESS, START + 60).calendar).toMatchObject({ canClaim: true, nextAt: null });
    const today = { ...NO_PROGRESS, calendarDays: 1, calendarLast: "2030-01-01" };
    expect(eventView(active, today, START + 60).calendar).toMatchObject({ claimed: 1, canClaim: false, nextAt: START + DAY });
    expect(eventView(active, today, START + DAY).calendar).toMatchObject({ canClaim: true, nextAt: null });
    const done = { ...NO_PROGRESS, calendarDays: 2, calendarLast: "2030-01-02" };
    expect(eventView(active, done, START + 2 * DAY).calendar).toMatchObject({ claimed: 2, canClaim: false, nextAt: null });
  });
});

describe("the Krallen Hunt's view", () => {
  const hunt = krallenHunt(2030, 1);
  const huntWindow = { startsAt: Date.parse(hunt.startsAt) / 1000, endsAt: Date.parse(hunt.endsAt) / 1000 };
  const scheduled = { event: hunt, window: huntWindow, status: "active" as const };
  const player = (townHall: number, tutorialDone = true, krallenLevel = 0) => ({ townHall, tutorialDone, krallenLevel });

  test("locked below Town Hall 6 or before the guided start is done, with the reason in words", () => {
    expect(eventView(scheduled, NO_PROGRESS, huntWindow.startsAt, player(5)).locked).toBe("Reach Town Hall 6 to take part.");
    expect(eventView(scheduled, NO_PROGRESS, huntWindow.startsAt, player(6, false)).locked).toBe("Finish the guided start to take part.");
    expect(eventView(scheduled, NO_PROGRESS, huntWindow.startsAt, player(9)).locked).toBeNull();
  });

  test("carries the Krallen level and the claim deadline 7 days after the end", () => {
    const view = eventView(scheduled, { ...NO_PROGRESS, counter: 12 }, huntWindow.startsAt, player(6, true, 3));
    expect(view.krallen).toEqual({ level: 3, maxLevel: 5 });
    expect(view.claimUntil).toBe(huntWindow.endsAt + 7 * DAY);
    expect(view.ladder).toMatchObject({ counter: 12, tiers: [{ need: KRALLEN_HUNT_GOAL, claimed: false }] });
    expect(eventView({ event: EVENT, window, status: "active" }, NO_PROGRESS, START).krallen).toBeNull();
    expect(eventView({ event: EVENT, window, status: "active" }, NO_PROGRESS, START).claimUntil).toBeNull();
  });
});

describe("GET /bm/events after a hunt ends", () => {
  const forced = process.env.EVENTS_FORCE_ON;
  beforeEach(() => delete process.env.EVENTS_FORCE_ON);
  afterEach(() => {
    if (forced === undefined) delete process.env.EVENTS_FORCE_ON;
    else process.env.EVENTS_FORCE_ON = forced;
  });
  const em = { execute: async () => [] } as never;
  const user = { userid: 4, save: { buildingdata: { "0": { id: 0, t: 14, l: 6 } }, tutorialstage: 205, champion: [] } } as unknown as User;
  const DEC_3 = Date.UTC(2026, 11, 3) / 1000;
  const DEC_9 = Date.UTC(2026, 11, 9) / 1000;
  const ids = async (store: ReturnType<typeof memoryProgressStore>, now: number) =>
    (await eventsAnswer(em, store, user, now)).events.map((view) => `${view.id}:${view.status}`);

  test("shown as ended only with the goal reached and not claimed, and only within the 7 days", async () => {
    const store = memoryProgressStore();
    expect(await ids(store, DEC_3)).not.toContain("krallen-2026-11:ended");
    await store.addToCounter(em, 4, "krallen-2026-11", KRALLEN_HUNT_GOAL);
    expect(await ids(store, DEC_3)).toContain("krallen-2026-11:ended");
    expect(await ids(store, DEC_9)).not.toContain("krallen-2026-11:ended");
    await store.claimTier(em, 4, "krallen-2026-11", 0, KRALLEN_HUNT_GOAL);
    expect(await ids(store, DEC_3)).not.toContain("krallen-2026-11:ended");
  });

  test("not shown to a player whose Krallen is at the top already: the goal pays nothing more", async () => {
    const store = memoryProgressStore();
    await store.addToCounter(em, 4, "krallen-2026-11", KRALLEN_HUNT_GOAL);
    const topped = { ...user, save: { ...user.save, champion: [{ t: 5, l: 5 }] } } as unknown as User;
    const views = (await eventsAnswer(em, store, topped, DEC_3)).events.map((view) => view.id);
    expect(views).not.toContain("krallen-2026-11");
  });
});

describe("POST /bm/whatsnew/seen body", () => {
  test("takes a release name, nothing else", () => {
    expect(WhatsNewSeenSchema.parse({ version: "2.0.0-beta.4" })).toEqual({ version: "2.0.0-beta.4" });
    expect(WhatsNewSeenSchema.safeParse({ version: "<script>" }).success).toBe(false);
    expect(WhatsNewSeenSchema.safeParse({ version: "x".repeat(33) }).success).toBe(false);
    expect(WhatsNewSeenSchema.safeParse({}).success).toBe(false);
  });
});
