import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompletedJob } from "./types";

/**
 * The own-yard loads' "while you were away" list (issue #135): the map loads
 * the own yard before the yard does, and that load's catch-up is the one that
 * finishes the overnight jobs, so its `completed` has to survive until the
 * yard's store starts.
 */

const session = vi.hoisted(() => ({ userId: 2505 as number | null }));
vi.mock("./auth", () => ({
  getSession: () => (session.userId === null ? null : { userId: session.userId }),
}));

const { loadOwnYard, takeAwayJobs } = await import("./base");

const upgrade = (id: number, at: number): CompletedJob => ({
  kind: "upgrade",
  id,
  t: 20,
  at,
  detail: { from: 1, level: 2, points: 10 },
});

const answerWith = (completed?: CompletedJob[]): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 0, ...(completed && { completed }) }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ),
  );
};

beforeEach(() => {
  session.userId = 2505;
  takeAwayJobs();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("takeAwayJobs", () => {
  it("keeps what an own-yard load finished until the yard takes it, once", async () => {
    answerWith([upgrade(1, 50)]);
    await loadOwnYard();
    // The yard's own load, a moment later, finds one more.
    answerWith([upgrade(2, 40)]);
    await loadOwnYard();

    expect(takeAwayJobs().map((job) => job.id)).toEqual([2, 1]);
    expect(takeAwayJobs()).toEqual([]);
  });

  it("keeps nothing from a load with no list, or an empty one", async () => {
    answerWith();
    await loadOwnYard();
    answerWith([]);
    await loadOwnYard();

    expect(takeAwayJobs()).toEqual([]);
  });

  it("never hands one account's list to another", async () => {
    answerWith([upgrade(1, 50)]);
    await loadOwnYard();

    session.userId = 2503;
    expect(takeAwayJobs()).toEqual([]);

    answerWith([upgrade(3, 60)]);
    await loadOwnYard();
    session.userId = 2505;
    expect(takeAwayJobs()).toEqual([]);
  });
});
