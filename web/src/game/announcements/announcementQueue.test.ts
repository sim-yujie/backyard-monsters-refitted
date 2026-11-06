import { describe, expect, it } from "vitest";
import type { Announcement } from "@/api/announcements";
import {
  AnnouncementQueue,
  FIRST_DELAY_MS,
  GAP_MS,
  RETRY_MS,
  guideRunning,
  toShow,
  type AnnouncementQueueDeps,
} from "./announcementQueue";

const item = (id: number, shownFrom: string, dismissed = false): Announcement => ({
  id,
  title: `News ${id}`,
  body: "Hello",
  imageIds: [],
  shownFrom,
  endsAt: null,
  dismissed,
});

/** A queue on a hand-turned clock, with the pop-ups it opens recorded. */
const harness = (
  list: readonly Announcement[] | Error,
  busy: { now: boolean } = { now: false },
) => {
  let timer: { run: () => void; ms: number } | null = null;
  const opened: { id: number; step: { index: number; total: number }; close: () => void }[] =
    [];
  const dismissed: number[] = [];
  const closedEarly: number[] = [];
  const deps: AnnouncementQueueDeps = {
    load: () => (list instanceof Error ? Promise.reject(list) : Promise.resolve(list)),
    dismiss: (id) => {
      dismissed.push(id);
      return Promise.resolve();
    },
    show: (shown, step, closed) => {
      opened.push({ id: shown.id, step, close: closed });
      return {
        close: () => {
          closedEarly.push(shown.id);
          closed();
        },
      };
    },
    blocked: () => busy.now,
    setTimer: (run, ms) => {
      timer = { run, ms };
      return timer;
    },
    clearTimer: () => {
      timer = null;
    },
  };
  const shown = new Set<number>();
  const queue = new AnnouncementQueue(deps, shown);
  const tick = (): number | null => {
    const due = timer;
    if (!due) return null;
    timer = null;
    due.run();
    return due.ms;
  };
  return {
    queue,
    opened,
    dismissed,
    closedEarly,
    shown,
    tick,
    pending: () => timer?.ms ?? null,
  };
};

describe("toShow", () => {
  it("leaves out the dismissed and the already shown, newest first", () => {
    const list = [
      item(1, "2026-10-01T00:00:00Z"),
      item(2, "2026-10-20T00:00:00Z", true),
      item(3, "2026-10-10T00:00:00Z"),
      item(4, "2026-10-05T00:00:00Z"),
    ];
    expect(toShow(list, new Set([4])).map((a) => a.id)).toEqual([3, 1]);
  });
});

describe("guideRunning", () => {
  it("is true only while Bob's guided start has the yard", () => {
    expect(guideRunning("pending")).toBe(true);
    expect(guideRunning("active")).toBe(true);
    for (const state of ["done", "skipped", "legacy", undefined] as const)
      expect(guideRunning(state)).toBe(false);
  });
});

describe("AnnouncementQueue", () => {
  it('shows each one not dismissed, newest first, one at a time, and "Got it" dismisses it', async () => {
    const h = harness([
      item(1, "2026-10-01T00:00:00Z"),
      item(2, "2026-10-02T00:00:00Z"),
      item(3, "2026-10-03T00:00:00Z", true),
    ]);
    await h.queue.start();
    expect(h.opened).toHaveLength(0);
    expect(h.tick()).toBe(FIRST_DELAY_MS);
    expect(h.opened.map((o) => o.id)).toEqual([2]);
    expect(h.opened[0]!.step).toEqual({ index: 0, total: 2 });
    expect(h.pending()).toBeNull();

    h.opened[0]!.close();
    expect(h.dismissed).toEqual([2]);
    expect(h.tick()).toBe(GAP_MS);
    expect(h.opened.map((o) => o.id)).toEqual([2, 1]);
    expect(h.opened[1]!.step).toEqual({ index: 1, total: 2 });

    h.opened[1]!.close();
    expect(h.dismissed).toEqual([2, 1]);
    h.tick();
    expect(h.opened).toHaveLength(2);
  });

  it("waits while the guided start, another popup or Bob has the screen", async () => {
    const busy = { now: true };
    const h = harness([item(1, "2026-10-01T00:00:00Z")], busy);
    await h.queue.start();
    h.tick();
    expect(h.opened).toHaveLength(0);
    expect(h.pending()).toBe(RETRY_MS);
    h.tick();
    h.tick();
    expect(h.opened).toHaveLength(0);
    busy.now = false;
    h.tick();
    expect(h.opened.map((o) => o.id)).toEqual([1]);
  });

  it("shows nothing when there is nothing new or the list cannot be read", async () => {
    const none = harness([item(1, "2026-10-01T00:00:00Z", true)]);
    await none.queue.start();
    expect(none.pending()).toBeNull();

    const failed = harness(new Error("offline"));
    await expect(failed.queue.start()).resolves.toBeUndefined();
    expect(failed.pending()).toBeNull();
  });

  it('shows one only once on this page, even when "Got it" did not reach the server', async () => {
    const list = [item(1, "2026-10-01T00:00:00Z")];
    const h = harness(list);
    await h.queue.start();
    h.tick();
    h.opened[0]!.close();
    expect(h.shown.has(1)).toBe(true);

    const again = new AnnouncementQueue(
      {
        load: () => Promise.resolve(list),
        dismiss: () => Promise.resolve(),
        show: () => {
          throw new Error("must not show again");
        },
        blocked: () => false,
        setTimer: (run) => run(),
        clearTimer: () => undefined,
      },
      h.shown,
    );
    await again.start();
  });

  it("skips one the player read in News while it waited", async () => {
    const busy = { now: true };
    const h = harness([item(1, "2026-10-01T00:00:00Z")], busy);
    await h.queue.start();
    h.tick();
    h.shown.add(1);
    busy.now = false;
    h.tick();
    expect(h.opened).toHaveLength(0);
  });

  it("closing the yard closes the open one without dismissing it, and it shows on the next visit", async () => {
    const h = harness([item(1, "2026-10-01T00:00:00Z"), item(2, "2026-09-01T00:00:00Z")]);
    await h.queue.start();
    h.tick();
    h.queue.stop();
    expect(h.closedEarly).toEqual([1]);
    expect(h.dismissed).toEqual([]);
    expect(h.shown.has(1)).toBe(false);
    expect(h.pending()).toBeNull();
  });

  it("does nothing once stopped before the list arrives", async () => {
    const h = harness([item(1, "2026-10-01T00:00:00Z")]);
    const started = h.queue.start();
    h.queue.stop();
    await started;
    expect(h.pending()).toBeNull();
  });
});
