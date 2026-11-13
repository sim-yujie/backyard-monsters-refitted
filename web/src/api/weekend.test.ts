import { afterEach, describe, expect, it, vi } from "vitest";
import { resetWeekend, setWeekend, weekendCheckin, type WeekendRun } from "@/game/weekend";
import type { YardActionResult } from "@/game/yard/YardStore";
import { checkInWeekendMessage, WEEKEND_CHECKIN_KEY, type WeekendCheckinReport } from "./weekend";

const RUN: WeekendRun = {
  id: "builders",
  title: "Builder's Weekend",
  line: "Upgrades cost 30% less",
  percent: 30,
  key: "2026-11-14",
  startsAt: 1_000,
  endsAt: 1_000 + 172_800,
  announceAt: 0,
  forced: false,
};
const DONE = {
  key: RUN.key,
  amount: 50,
  day: 1,
  days: 2,
  claimedToday: true,
  marks: [
    { day: 1, claimed: true },
    { day: 2, claimed: false },
  ],
  nextAt: RUN.startsAt + 86_400,
};

const storeAnswering = (result: YardActionResult<WeekendCheckinReport>) => ({
  run: vi.fn((_action: { key: string }) => Promise.resolve(result)),
});

afterEach(() => resetWeekend());

describe("checkInWeekend (owner, 13 Nov 2026)", () => {
  it("goes through the yard queue and takes the answer's check-in", async () => {
    setWeekend({ active: RUN, next: null }, RUN.startsAt + 60);
    const store = storeAnswering({ ok: true, report: { paid: 50, checkin: DONE }, completed: [] });
    expect(await checkInWeekendMessage(store as never)).toBeNull();
    expect(store.run.mock.calls[0]![0].key).toBe(WEEKEND_CHECKIN_KEY);
    expect(weekendCheckin(RUN, RUN.startsAt + 60)?.claimedToday).toBe(true);
  });

  it("another tab got there first: no message, the card turns to done", async () => {
    setWeekend({ active: RUN, next: null }, RUN.startsAt + 60);
    const store = storeAnswering({
      ok: false,
      refusal: { reason: "checkedInToday", message: "You have checked in today.", detail: { checkin: DONE }, status: 409 },
    });
    expect(await checkInWeekendMessage(store as never)).toBeNull();
    expect(weekendCheckin(RUN, RUN.startsAt + 60)?.claimedToday).toBe(true);
  });

  it("any other refusal is said", async () => {
    const store = storeAnswering({
      ok: false,
      refusal: { reason: "noWeekend", message: "There is no weekend event on right now.", detail: {}, status: 409 },
    });
    expect(await checkInWeekendMessage(store as never)).toBe("There is no weekend event on right now.");
  });
});
