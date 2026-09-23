import { beforeEach, describe, expect, it, vi } from "vitest";
import { AREA_BURST } from "@/config";
import { ApiError, NetworkError } from "@/api/http";
import type { GetAreaResponse } from "@/api/types";
import { QUEUE_DEPTH, ZoneStore, type AreaFetcher } from "./ZoneStore";
import { zoneFor } from "./zones";

/** An 11 x 11 block of plausible cells, the shape `getarea` really returns. */
const areaResponse = (x: number, y: number): GetAreaResponse => {
  const data: GetAreaResponse["data"] = {};
  for (let cellX = x; cellX <= x + 10; cellX++) {
    const column: Record<string, { i: number }> = {};
    for (let cellY = y; cellY <= y + 10; cellY++) {
      column[String(cellY)] = { i: 120 + ((cellX + cellY) % 40) };
    }
    data[String(cellX)] = column;
  }
  return { error: 0, x, y, data };
};

const clock = (start = 1_000_000) => {
  let value = start;
  return {
    now: () => value,
    advanceSeconds: (seconds: number) => {
      value += seconds * 1000;
    },
  };
};

/** A fetcher that resolves immediately and records what it was asked for. */
const okFetcher = (): AreaFetcher & { calls: [number, number][] } => {
  const calls: [number, number][] = [];
  const fetcher: AreaFetcher = (x, y) => {
    calls.push([x, y]);
    return Promise.resolve(areaResponse(x, y));
  };
  return Object.assign(fetcher, { calls });
};

/**
 * Runs pump repeatedly, so a queue larger than the concurrency limit drains
 * inside one test step.
 *
 * It cannot stop when the pending count stops falling: the store tops its queue
 * up from the visible set after every round, so a large viewport holds the
 * count steady while still making progress. A fixed round count with an early
 * exit on an empty queue is the honest condition.
 */
const drain = async (store: ZoneStore, rounds = 40): Promise<void> => {
  for (let index = 0; index < rounds; index++) {
    if (store.pendingRequests === 0) return;
    await store.pump();
  }
};

describe("ZoneStore", () => {
  let time: ReturnType<typeof clock>;

  beforeEach(() => {
    time = clock();
  });

  it("fetches the zones a viewport covers and exposes their cells", async () => {
    const fetcher = okFetcher();
    const store = new ZoneStore({ fetcher, now: time.now });

    store.ensureVisible({ minCol: 710, maxCol: 715, minRow: 345, maxRow: 349 });
    await drain(store);

    expect(fetcher.calls).toEqual([[710, 340]]);
    expect(store.getCell(712, 347)).toEqual({ i: 120 + ((712 + 347) % 40) });
    expect(store.getCell(400, 400)).toBeUndefined();
  });

  it("does not refetch a zone it already holds", async () => {
    const fetcher = okFetcher();
    const store = new ZoneStore({ fetcher, now: time.now });

    store.ensureVisible({ minCol: 710, maxCol: 712, minRow: 345, maxRow: 347 });
    await drain(store);
    store.ensureVisible({ minCol: 711, maxCol: 713, minRow: 346, maxRow: 348 });
    await drain(store);

    expect(fetcher.calls).toHaveLength(1);
  });

  it("deduplicates requests for a zone that is already in flight", async () => {
    let release: ((value: GetAreaResponse) => void) | undefined;
    const calls: number[] = [];
    const fetcher: AreaFetcher = (x, y) => {
      calls.push(x);
      return new Promise<GetAreaResponse>((resolve) => {
        release = () => resolve(areaResponse(x, y));
      });
    };

    const store = new ZoneStore({ fetcher, now: time.now });
    const range = { minCol: 710, maxCol: 712, minRow: 345, maxRow: 347 };

    store.ensureVisible(range);
    const first = store.pump();

    // A second viewport update for the same zone while the first is open.
    store.ensureVisible(range);
    await store.pump();

    expect(calls).toHaveLength(1);
    release?.(areaResponse(710, 340));
    await first;
    expect(calls).toHaveLength(1);
  });

  it("requests zones nearest the viewport centre first", async () => {
    const fetcher = okFetcher();
    const store = new ZoneStore({ fetcher, now: time.now, maxConcurrent: 1 });

    // 4 x 4 zones, viewport centre (719.5, 359.5). Sixteen fits inside one
    // token-bucket burst, so the bucket does not truncate the ordering this
    // test is about. Zone 710/350 has its middle at (715, 355), 4.5 cells from
    // the centre on each axis, against 5.5 for zone 720/360 — so it goes first.
    store.ensureVisible({ minCol: 700, maxCol: 739, minRow: 340, maxRow: 379 });
    await drain(store);

    expect(fetcher.calls).toHaveLength(16);
    expect(fetcher.calls[0]).toEqual([710, 350]);

    // Distance from the centre must never decrease as the queue is drained.
    const centre = { x: 719.5, y: 359.5 };
    const distances = fetcher.calls.map(
      ([x, y]) => (x + 5 - centre.x) ** 2 + (y + 5 - centre.y) ** 2,
    );
    for (let index = 1; index < distances.length; index++) {
      expect(distances[index]!).toBeGreaterThanOrEqual(distances[index - 1]!);
    }
  });

  it("drops speculative zones the player has panned away from", async () => {
    const fetcher = okFetcher();
    const store = new ZoneStore({ fetcher, now: time.now, maxConcurrent: 1 });

    // 100 zones are visible but the queue is capped, so it holds 64 of them.
    store.ensureVisible({ minCol: 0, maxCol: 99, minRow: 0, maxRow: 99 });
    expect(store.pendingRequests).toBe(QUEUE_DEPTH);

    store.ensureVisible({ minCol: 500, maxCol: 519, minRow: 500, maxRow: 519 });
    expect(store.pendingRequests).toBe(4);

    await drain(store);
    expect(fetcher.calls.every(([x]) => x >= 500)).toBe(true);
  });

  it("holds requests back rather than exceeding the token bucket", async () => {
    const fetcher = okFetcher();
    const store = new ZoneStore({ fetcher, now: time.now, maxConcurrent: 4 });

    // Far more zones than one burst allows.
    store.ensureVisible({ minCol: 0, maxCol: 399, minRow: 0, maxRow: 99 });
    await drain(store);

    expect(fetcher.calls).toHaveLength(AREA_BURST);
    expect(store.pendingRequests).toBeGreaterThan(0);

    // Two seconds of refill at 1.5/s buys three more.
    time.advanceSeconds(2);
    await drain(store);
    expect(fetcher.calls).toHaveLength(AREA_BURST + 3);
  });

  /**
   * Zoomed all the way out the viewport is the entire 80 x 80 grid of zones.
   * Queuing all of them would tie the client up for the best part of an hour at
   * the permitted request rate, so the queue is bounded and refilled from the
   * visible set as it drains.
   */
  it("bounds the queue when the whole world is visible", async () => {
    const fetcher = okFetcher();
    const store = new ZoneStore({ fetcher, now: time.now });

    store.ensureVisible({ minCol: 0, maxCol: 799, minRow: 0, maxRow: 799 });
    expect(store.pendingRequests).toBe(QUEUE_DEPTH);

    // It still makes progress, and still nearest the centre first.
    await drain(store);
    expect(fetcher.calls).toHaveLength(AREA_BURST);
    expect(store.pendingRequests).toBe(QUEUE_DEPTH);
    for (const [x, y] of fetcher.calls) {
      expect(Math.abs(x + 5 - 399.5)).toBeLessThan(80);
      expect(Math.abs(y + 5 - 399.5)).toBeLessThan(80);
    }
  });

  it("caps a manual refresh of a world-scale viewport", async () => {
    const fetcher = okFetcher();
    const store = new ZoneStore({ fetcher, now: time.now });

    store.ensureVisible({ minCol: 0, maxCol: 799, minRow: 0, maxRow: 799 });
    await drain(store);

    store.refreshVisible();
    expect(store.pendingRequests).toBeLessThanOrEqual(QUEUE_DEPTH);
  });

  it("refetches a visible zone once it is stale and leaves fresh ones alone", async () => {
    const fetcher = okFetcher();
    const store = new ZoneStore({ fetcher, now: time.now });
    const range = { minCol: 710, maxCol: 712, minRow: 345, maxRow: 347 };

    store.ensureVisible(range);
    await drain(store);
    expect(fetcher.calls).toHaveLength(1);

    time.advanceSeconds(20);
    store.refreshStale(60);
    await drain(store);
    expect(fetcher.calls).toHaveLength(1);

    // Past 60 s plus the largest possible jitter (25%).
    time.advanceSeconds(70);
    store.refreshStale(60);
    await drain(store);
    expect(fetcher.calls).toHaveLength(2);
  });

  it("refetches everything visible on demand, however fresh it is", async () => {
    const fetcher = okFetcher();
    const store = new ZoneStore({ fetcher, now: time.now });

    store.ensureVisible({ minCol: 710, maxCol: 725, minRow: 345, maxRow: 347 });
    await drain(store);
    expect(fetcher.calls).toHaveLength(2);

    store.refreshVisible();
    await drain(store);
    expect(fetcher.calls).toHaveLength(4);
  });

  it("forces a single cell's zone after an action on it", async () => {
    const fetcher = okFetcher();
    const store = new ZoneStore({ fetcher, now: time.now });

    store.ensureVisible({ minCol: 710, maxCol: 712, minRow: 345, maxRow: 347 });
    await drain(store);

    store.invalidateCell(711, 346);
    await drain(store);

    expect(fetcher.calls).toEqual([
      [710, 340],
      [710, 340],
    ]);
  });

  it("reports the caller's resources when the server attaches them", async () => {
    const onResources = vi.fn();
    const fetcher: AreaFetcher = (x, y) =>
      Promise.resolve({ ...areaResponse(x, y), resources: { r1: 5 }, credits: 7 });
    const store = new ZoneStore({ fetcher, now: time.now, onResources });

    store.ensureVisible({ minCol: 0, maxCol: 1, minRow: 0, maxRow: 1 });
    await drain(store);

    expect(onResources).toHaveBeenCalledWith({ r1: 5 }, 7);
  });

  it("stands down and reports when the server answers 429", async () => {
    const onError = vi.fn();
    const fetcher: AreaFetcher = () =>
      Promise.reject(
        new ApiError("Too many area requests. Please slow down.", { status: 429 }),
      );
    const store = new ZoneStore({ fetcher, now: time.now, onError });

    store.ensureVisible({ minCol: 0, maxCol: 1, minRow: 0, maxRow: 1 });
    await drain(store);

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "rate-limit" }),
    );
    expect(store.paused).toBe(true);
    // The zone stays queued so it is retried once the backoff lapses.
    expect(store.pendingRequests).toBe(1);
  });

  it("retries after a network failure and reports the loss", async () => {
    const onError = vi.fn();
    let attempts = 0;
    const fetcher: AreaFetcher = (x, y) => {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new NetworkError("offline", undefined));
      return Promise.resolve(areaResponse(x, y));
    };
    const store = new ZoneStore({ fetcher, now: time.now, onError });

    store.ensureVisible({ minCol: 0, maxCol: 1, minRow: 0, maxRow: 1 });
    await drain(store);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ kind: "network" }));

    time.advanceSeconds(2);
    await drain(store);
    expect(store.getCell(5, 5)).toBeDefined();
  });

  it("stops and signals an auth failure on 401", async () => {
    const onAuthFailure = vi.fn();
    const fetcher: AreaFetcher = () =>
      Promise.reject(
        new ApiError("Could not authenticate", {
          status: 200,
          serverStatus: 401,
          details: { status: 401 },
        }),
      );
    const store = new ZoneStore({ fetcher, now: time.now, onAuthFailure });

    store.ensureVisible({ minCol: 0, maxCol: 1, minRow: 0, maxRow: 1 });
    await drain(store);

    expect(onAuthFailure).toHaveBeenCalledTimes(1);
    expect(store.pendingRequests).toBe(0);

    time.advanceSeconds(3600);
    await drain(store);
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
  });

  it("bumps its revision and announces each applied zone", async () => {
    const onZone = vi.fn();
    const fetcher = okFetcher();
    const store = new ZoneStore({ fetcher, now: time.now, onZone });

    store.ensureVisible({ minCol: 710, maxCol: 725, minRow: 345, maxRow: 347 });
    await drain(store);

    expect(store.revision).toBe(2);
    expect(store.loadedZones).toBe(2);
    expect(onZone).toHaveBeenCalledTimes(2);
    expect(onZone.mock.calls[0]?.[0]).toMatchObject({
      id: zoneFor(710, 345).id,
      fetchedAt: time.now(),
    });
  });
});
