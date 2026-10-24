import { describe, expect, test } from "bun:test";
import type { LogRecord } from "@logtape/logtape";
import type { EntityManager } from "@mikro-orm/postgresql";

import { errorCaptureSink, takeCapturedErrors } from "../../utils/errorCapture.js";
import { flushServerErrors } from "../errors/errorStore.js";
import { ERROR_SLOT_MS, errorRateCounter, serverErrorRate } from "./errorRate.js";

/** The 10-minute server error counter behind the "sudden jump in errors" alert. */

const T0 = Math.floor(Date.UTC(2026, 9, 23) / ERROR_SLOT_MS) * ERROR_SLOT_MS;
const MIN = 60_000;

describe("server error rate", () => {
  test("unknown until something is noted or it is started", () => {
    const counter = errorRateCounter();
    expect(counter.rate(T0)).toBeNull();
    counter.start(T0);
    expect(counter.rate(T0)).toEqual({ recent: 0, usual: 0 });
  });

  test("recent: the last 10 minutes, the previous slot counted for the part still inside them", () => {
    const counter = errorRateCounter();
    counter.note(10, T0 + 5 * MIN); // slot 0
    counter.note(4, T0 + 12 * MIN); // slot 1
    // At 12 minutes: all of slot 1, and 80% of slot 0 (its last 8 minutes).
    expect(counter.rate(T0 + 12 * MIN)?.recent).toBe(12);
    // At 20 minutes: slot 1 entirely, nothing of slot 0.
    expect(counter.rate(T0 + 20 * MIN)?.recent).toBe(4);
  });

  test("usual: the average of the finished slots before them, over the past day", () => {
    const counter = errorRateCounter();
    for (let slot = 0; slot < 6; slot++) counter.note(3, T0 + slot * ERROR_SLOT_MS);
    counter.note(60, T0 + 6 * ERROR_SLOT_MS + MIN);
    const rate = counter.rate(T0 + 6 * ERROR_SLOT_MS + 2 * MIN)!;
    // Slots 0-4 finished and outside the last 10 minutes; slot 5 is partly inside them.
    expect(rate.usual).toBe(3);
    expect(rate.recent).toBe(60 + Math.round(3 * 0.8));
  });

  test("a day later the old counts no longer count", () => {
    const counter = errorRateCounter();
    counter.note(1000, T0);
    const later = T0 + 25 * 60 * MIN;
    counter.note(1, later);
    expect(counter.rate(later)!.usual).toBe(0);
  });

  test("nothing, zero or nonsense adds nothing", () => {
    const counter = errorRateCounter();
    counter.note(0, T0);
    counter.note(Number.NaN, T0);
    expect(counter.rate(T0)).toBeNull();
  });

  test("the error store's flush feeds the server's counter, an empty flush too", async () => {
    const em = { execute: async () => [{ id: 1 }] } as unknown as EntityManager;
    takeCapturedErrors();
    await flushServerErrors(em);
    const before = serverErrorRate.rate();
    expect(before).not.toBeNull();
    for (let i = 0; i < 3; i++) {
      errorCaptureSink({ category: ["bymr", "app"], level: "error", message: ["alert feed test"], rawMessage: "", timestamp: Date.now(), properties: {} } as unknown as LogRecord);
    }
    await flushServerErrors(em);
    expect(serverErrorRate.rate()!.recent - before!.recent).toBe(3);
  });
});
