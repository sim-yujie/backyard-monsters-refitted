import { describe, expect, it } from "vitest";
import {
  DEFAULT_REPEAT_BAR_LOOK,
  REPEAT_BAR_KEY,
  REPEAT_BAR_MIN_MS,
  atLeast,
  pickRepeatBarLook,
  repeatBarLook,
  waitingProgress,
  type BarTimers,
} from "./repeatBarTiming";

/** A clock that only moves when told to, and timers that fire as it passes them. */
const fakeTimers = (): BarTimers & { advance: (ms: number) => Promise<void> } => {
  let now = 0;
  const waits: { at: number; resolve: () => void }[] = [];
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  };
  return {
    now: () => now,
    wait: (ms) => new Promise<void>((resolve) => waits.push({ at: now + ms, resolve })),
    advance: async (ms) => {
      const end = now + ms;
      while (now < end) {
        now = Math.min(end, now + 50);
        for (const wait of waits.filter((one) => one.at <= now)) {
          waits.splice(waits.indexOf(wait), 1);
          wait.resolve();
        }
        await flush();
      }
    },
  };
};

/** A promise and its handles. */
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

/** What a promise has done so far. */
const watch = <T>(promise: Promise<T>) => {
  const state: { done: boolean; value?: T; error?: unknown } = { done: false };
  promise.then(
    (value) => Object.assign(state, { done: true, value }),
    (error: unknown) => Object.assign(state, { done: true, error }),
  );
  return state;
};

describe("the bar's fill while it waits", () => {
  it("rises, reaches 85% at the 5 s mark, and creeps on without ever being full", () => {
    expect(REPEAT_BAR_MIN_MS).toBe(5000);
    expect(waitingProgress(0)).toBe(0);
    expect(waitingProgress(5000)).toBeCloseTo(0.85, 5);
    let last = -1;
    for (let t = 0; t <= 120_000; t += 250) {
      const value = waitingProgress(t);
      expect(value).toBeGreaterThanOrEqual(last);
      expect(value).toBeLessThan(1);
      last = value;
    }
    // Still moving well past the minimum: it creeps, it does not stall.
    expect(waitingProgress(9000)).toBeGreaterThan(waitingProgress(7000));
    expect(waitingProgress(1e9)).toBeLessThan(0.98);
  });

  it("treats nonsense time as the start", () => {
    expect(waitingProgress(-50)).toBe(0);
    expect(waitingProgress(Number.NaN)).toBe(0);
  });
});

describe("the 5 s minimum", () => {
  it("an answer before 5 s waits until 5 s", async () => {
    const timers = fakeTimers();
    const answer = deferred<string>();
    const state = watch(atLeast(answer.promise, REPEAT_BAR_MIN_MS, timers));
    await timers.advance(1000);
    answer.resolve("landed");
    await timers.advance(3900);
    expect(state.done).toBe(false);
    await timers.advance(150);
    expect(state).toEqual({ done: true, value: "landed" });
  });

  it("an answer after 5 s goes straight through, the moment it comes", async () => {
    const timers = fakeTimers();
    const answer = deferred<string>();
    const state = watch(atLeast(answer.promise, REPEAT_BAR_MIN_MS, timers));
    await timers.advance(8000);
    expect(state.done).toBe(false);
    answer.resolve("late");
    await timers.advance(0);
    await Promise.resolve();
    expect(state).toEqual({ done: true, value: "late" });
  });

  it("an error comes out at once, without waiting out the 5 s", async () => {
    const timers = fakeTimers();
    const answer = deferred<string>();
    const state = watch(atLeast(answer.promise, REPEAT_BAR_MIN_MS, timers));
    await timers.advance(1000);
    answer.reject(new Error("refused"));
    await Promise.resolve();
    await Promise.resolve();
    expect(state.done).toBe(true);
    expect((state.error as Error).message).toBe("refused");
  });

  it("counts from when the bar started, not from when it was asked", async () => {
    const timers = fakeTimers();
    await timers.advance(4000);
    const state = watch(atLeast(Promise.resolve(1), REPEAT_BAR_MIN_MS, timers, 0));
    await timers.advance(1000);
    expect(state.done).toBe(true);
  });
});

describe("the look switch", () => {
  const memory = (): Storage => {
    const data = new Map<string, string>();
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
      clear: () => data.clear(),
      key: () => null,
      get length() {
        return data.size;
      },
    };
  };

  it("is the army unless a valid look is asked for or saved", () => {
    expect(DEFAULT_REPEAT_BAR_LOOK).toBe("army");
    expect(pickRepeatBarLook(null, null)).toBe("army");
    expect(pickRepeatBarLook("fuse", "goo")).toBe("fuse");
    expect(pickRepeatBarLook("nonsense", "goo")).toBe("goo");
    expect(pickRepeatBarLook(null, "nonsense")).toBe("army");
  });

  it("?repeatBar= is remembered on this browser, and ?repeatBar=auto forgets it", () => {
    const store = memory();
    expect(repeatBarLook("?repeatBar=goo", store)).toBe("goo");
    expect(store.getItem(REPEAT_BAR_KEY)).toBe("goo");
    expect(repeatBarLook("", store)).toBe("goo");
    expect(repeatBarLook("?repeatBar=auto", store)).toBe("army");
    expect(store.getItem(REPEAT_BAR_KEY)).toBeNull();
    expect(repeatBarLook("?repeatBar=fuse", null)).toBe("fuse");
  });
});
