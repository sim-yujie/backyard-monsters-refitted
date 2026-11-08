import { describe, expect, it } from "vitest";
import { DEMO_MS, PREPBAR_DEMO_KEY, PREPBAR_KEY, demoState, pickDemo, pickPrepareDesign, readPrepareChoice } from "./prepareDesign";

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

/** The "Preparing map" prototype switches (owner, 8 Nov 2026). */
describe("prepbar switches", () => {
  it("picks the URL's design, else the remembered one, else the first bar", () => {
    expect(pickPrepareDesign("b", "a")).toBe("b");
    expect(pickPrepareDesign("C", null)).toBe("c");
    expect(pickPrepareDesign(null, "a")).toBe("a");
    expect(pickPrepareDesign("nonsense", null)).toBe("bar");
    expect(pickPrepareDesign(null, null)).toBe("bar");
  });

  it("turns the demo on and off from the URL, else as remembered", () => {
    expect(pickDemo("1", null)).toBe(true);
    expect(pickDemo("0", "1")).toBe(false);
    expect(pickDemo(null, "1")).toBe(true);
    expect(pickDemo(null, null)).toBe(false);
  });

  it("remembers what the URL said, so the game's own page changes keep it; bar and 0 forget it", () => {
    const store = memoryStore();
    expect(readPrepareChoice("?prepbar=b&prepbar-demo=1", store)).toEqual({ design: "b", demo: true });
    expect(store.getItem(PREPBAR_KEY)).toBe("b");
    expect(store.getItem(PREPBAR_DEMO_KEY)).toBe("1");
    expect(readPrepareChoice("", store)).toEqual({ design: "b", demo: true });
    expect(readPrepareChoice("?prepbar=bar&prepbar-demo=0", store)).toEqual({ design: "bar", demo: false });
    expect(store.getItem(PREPBAR_KEY)).toBeNull();
    expect(store.getItem(PREPBAR_DEMO_KEY)).toBeNull();
  });

  it("works with no storage at all", () => {
    expect(readPrepareChoice("?prepbar=a", null)).toEqual({ design: "a", demo: false });
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

  it("passes the samples the tester shoots (about 10%, 50% and 95%)", () => {
    const at = (percent: number): number => {
      for (let ms = 0; ms < DEMO_MS; ms += 50) if (demoState(ms).percent >= percent) return ms;
      return DEMO_MS;
    };
    expect(at(10)).toBeLessThan(at(50));
    expect(at(50)).toBeLessThan(at(95));
    expect(at(95)).toBeLessThan(DEMO_MS);
  });
});
