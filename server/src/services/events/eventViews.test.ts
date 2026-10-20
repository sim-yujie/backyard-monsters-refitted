import { describe, expect, test } from "bun:test";

import { WhatsNewSeenSchema } from "../../controllers/events/eventsState.js";
import type { EventDefinition } from "../../game-data/events/events.js";
import { eventView } from "./eventViews.js";
import { NO_PROGRESS } from "./progressStore.js";

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

describe("POST /bm/whatsnew/seen body", () => {
  test("takes a release name, nothing else", () => {
    expect(WhatsNewSeenSchema.parse({ version: "2.0.0-beta.4" })).toEqual({ version: "2.0.0-beta.4" });
    expect(WhatsNewSeenSchema.safeParse({ version: "<script>" }).success).toBe(false);
    expect(WhatsNewSeenSchema.safeParse({ version: "x".repeat(33) }).success).toBe(false);
    expect(WhatsNewSeenSchema.safeParse({}).success).toBe(false);
  });
});
