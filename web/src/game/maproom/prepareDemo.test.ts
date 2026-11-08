import { describe, expect, it } from "vitest";
import { DEMO_MS, PREPBAR_DEMO_KEY, demoAllowed, demoState, readPrepareDemo } from "./prepareDemo";

const memoryStore = (): Storage => {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
};

/** The "Preparing map" demo switch for testers (owner, 8 Nov 2026). */
describe("?prepbar-demo", () => {
  it("is off by default", () => {
    expect(readPrepareDemo("", memoryStore(), true)).toBe(false);
  });

  it("turns on and off from the URL, remembered for the tab", () => {
    const store = memoryStore();
    expect(readPrepareDemo("?prepbar-demo=1", store, true)).toBe(true);
    expect(store.getItem(PREPBAR_DEMO_KEY)).toBe("1");
    expect(readPrepareDemo("", store, true)).toBe(true);
    expect(readPrepareDemo("?prepbar-demo=0", store, true)).toBe(false);
    expect(store.getItem(PREPBAR_DEMO_KEY)).toBeNull();
    expect(readPrepareDemo("", store, true)).toBe(false);
  });

  it("does nothing on the live game: only on a development build or a page served from this computer", () => {
    const store = memoryStore();
    expect(readPrepareDemo("?prepbar-demo=1", store, false)).toBe(false);
    expect(store.getItem(PREPBAR_DEMO_KEY)).toBeNull();
    expect(demoAllowed(false, "bymrevamped.com")).toBe(false);
    expect(demoAllowed(false, "localhost")).toBe(true);
    expect(demoAllowed(false, "127.0.0.1")).toBe(true);
    expect(demoAllowed(true, "bymrevamped.com")).toBe(true);
  });

  it("works with no storage at all", () => {
    expect(readPrepareDemo("?prepbar-demo=1", null, true)).toBe(true);
    expect(readPrepareDemo("", null, true)).toBe(false);
  });
});

describe("the demo's made-up progress", () => {
  it("shows at once, only climbs, and ends hidden at 100% after DEMO_MS", () => {
    expect(demoState(0)).toEqual({ show: true, percent: 0 });
    let last = -1;
    for (let ms = 0; ms < DEMO_MS; ms += 250) {
      const state = demoState(ms);
      expect(state.show).toBe(true);
      expect(state.percent).toBeGreaterThanOrEqual(last);
      expect(state.percent).toBeLessThan(100);
      last = state.percent;
    }
    expect(last).toBeGreaterThan(90);
    expect(demoState(DEMO_MS)).toEqual({ show: false, percent: 100 });
  });

  it("reaches about 10% at 1 s, 50% at 6.4 s and 95% at 14.1 s (the tester's early, mid and late shots)", () => {
    expect(demoState(1_050).percent).toBe(10);
    expect(demoState(6_430).percent).toBe(50);
    expect(demoState(14_150).percent).toBe(95);
  });
});
