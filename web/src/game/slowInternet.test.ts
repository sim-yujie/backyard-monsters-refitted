import { describe, expect, it } from "vitest";
import {
  connectionLooksSlow,
  FIRST_LOOK_MS,
  MAX_TRIES,
  maySuggestLow,
  measuredMbps,
  noteLowSuggested,
  RETRY_MS,
  suggestLowOnce,
} from "./slowInternet";

const storage = (entries: Record<string, string> = {}): Storage => {
  const kept = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
  } as Storage;
};

/** 600 KB in `seconds`. */
const download = (seconds: number) => ({ transferSize: 600_000, startTime: 100, responseEnd: 100 + seconds * 1000 });

describe("connectionLooksSlow", () => {
  it("believes what Chrome says: Data Saver, 2G or 3G, or under 1.5 Mbit/s", () => {
    expect(connectionLooksSlow({ saveData: true, effectiveType: "4g", downlink: 10 }, [])).toBe(true);
    expect(connectionLooksSlow({ effectiveType: "3g", downlink: 10 }, [])).toBe(true);
    expect(connectionLooksSlow({ effectiveType: "4g", downlink: 1.2 }, [])).toBe(true);
    expect(connectionLooksSlow({ effectiveType: "4g", downlink: 10 }, [download(60)])).toBe(false);
  });

  it("times the page's own downloads where the browser says nothing (Safari, Firefox)", () => {
    expect(measuredMbps([download(4)])).toBeCloseTo(1.2, 5);
    expect(connectionLooksSlow(undefined, [download(4)])).toBe(true);
    // The fastest one counts: 4.8 Mbit/s.
    expect(connectionLooksSlow(undefined, [download(4), download(1)])).toBe(false);
  });

  it("says nothing from cached or tiny downloads", () => {
    expect(measuredMbps([{ transferSize: 0, startTime: 0, responseEnd: 50 }])).toBeNull();
    expect(measuredMbps([{ transferSize: 20_000, startTime: 0, responseEnd: 5000 }])).toBeNull();
    expect(connectionLooksSlow(undefined, [])).toBe(false);
  });
});

describe("maySuggestLow", () => {
  it("only once, and never to a player who already picked a Quality", () => {
    const store = storage();
    expect(maySuggestLow(store)).toBe(true);
    noteLowSuggested(store);
    expect(maySuggestLow(store)).toBe(false);
    expect(maySuggestLow(storage({ "bymr.quality": "high" }))).toBe(false);
    expect(maySuggestLow(null)).toBe(false);
  });
});

describe("suggestLowOnce", () => {
  /** Timers run by hand. */
  const clock = () => {
    const timers: { run: () => void; ms: number }[] = [];
    return {
      timers,
      setTimer: (run: () => void, ms: number) => timers.push({ run, ms }),
      clearTimer: () => void timers.splice(0),
      next: () => timers.shift()?.run(),
    };
  };

  it("shows a few seconds after the yard opens when the link is slow, once the screen is free", () => {
    const time = clock();
    let busy = true;
    let shown = 0;
    suggestLowOnce({
      allowed: () => shown === 0,
      slow: () => true,
      busy: () => busy,
      show: () => (shown += 1),
      setTimer: time.setTimer,
      clearTimer: time.clearTimer,
    });
    expect(time.timers[0]?.ms).toBe(FIRST_LOOK_MS);
    time.next();
    expect(shown).toBe(0);
    expect(time.timers[0]?.ms).toBe(RETRY_MS);
    busy = false;
    time.next();
    expect(shown).toBe(1);
    expect(time.timers).toHaveLength(0);
  });

  it("shows nothing on a fast link, or where it may not", () => {
    for (const [allowed, slow] of [
      [true, false],
      [false, true],
    ] as const) {
      const time = clock();
      let shown = 0;
      suggestLowOnce({
        allowed: () => allowed,
        slow: () => slow,
        busy: () => false,
        show: () => (shown += 1),
        setTimer: time.setTimer,
        clearTimer: time.clearTimer,
      });
      time.next();
      expect(shown).toBe(0);
      expect(time.timers).toHaveLength(0);
    }
  });

  it("gives up for this visit when the screen stays busy, and stops with the yard", () => {
    const time = clock();
    let shown = 0;
    const always = { allowed: () => true, slow: () => true, show: () => (shown += 1) };
    suggestLowOnce({ ...always, busy: () => true, setTimer: time.setTimer, clearTimer: time.clearTimer });
    for (let i = 0; i < MAX_TRIES + 5; i += 1) time.next();
    expect(shown).toBe(0);
    expect(time.timers).toHaveLength(0);

    const other = clock();
    const stop = suggestLowOnce({ ...always, busy: () => false, setTimer: other.setTimer, clearTimer: other.clearTimer });
    stop();
    expect(other.timers).toHaveLength(0);
  });
});
