import { describe, expect, test } from "bun:test";

import { areaGate, createAreaGate } from "./areaGate.js";

/** The map's back-pressure (live map, beta 9): a burst is refused fast, never queued without limit. */
const options = { concurrency: 2, maxWaiting: 1, maxWaitMs: 50, retryMin: 2, retryMax: 2 };

describe("createAreaGate", () => {
  test("lets `concurrency` through, queues `maxWaiting`, refuses the rest at once", async () => {
    const gate = createAreaGate(options);
    expect(await gate.acquire()).toBe(true);
    expect(await gate.acquire()).toBe(true);
    const third = gate.acquire();
    expect(await gate.acquire()).toBe(false);
    gate.release();
    expect(await third).toBe(true);
    expect(gate.stats).toEqual({ active: 2, waiting: 0, refused: 1 });
  });

  test("one that waited too long is refused, and leaves the queue", async () => {
    const gate = createAreaGate(options);
    await gate.acquire();
    await gate.acquire();
    expect(await gate.acquire()).toBe(false);
    expect(gate.stats.waiting).toBe(0);
    gate.release();
    gate.release();
    expect(gate.stats.active).toBe(0);
  });
});

describe("areaGate middleware", () => {
  test("refused: 503 with Retry-After and retry, and the controller never runs", async () => {
    const gate = createAreaGate({ ...options, concurrency: 0, maxWaiting: 0 });
    const headers: Record<string, string> = {};
    const ctx = { status: 200, body: undefined as unknown, set: (k: string, v: string) => (headers[k] = v) };
    let ran = false;
    await areaGate(gate, options)(ctx as never, async () => {
      ran = true;
    });
    expect(ran).toBe(false);
    expect(ctx.status).toBe(503);
    expect(headers["Retry-After"]).toBe("2");
    expect(ctx.body).toMatchObject({ retry: 2 });
  });

  test("a turn is given back even when the controller throws", async () => {
    const gate = createAreaGate(options);
    const ctx = { set: () => {} };
    await expect(
      areaGate(gate, options)(ctx as never, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(gate.stats.active).toBe(0);
  });
});
