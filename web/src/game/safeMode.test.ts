import { describe, expect, it } from "vitest";
import { quality, qualityChoice, musicHeld, setQuality } from "./quality";
import {
  SAFE_MODE_KEY,
  STABLE_MS,
  SafeModeWatch,
  TICK_MS,
  clearSafeMode,
  lowerQuality,
  markLoad,
  readSafeMode,
  safeModeCap,
  stepDownAtBoot,
  unfinishedLoads,
} from "./safeMode";
import type { Quality } from "./quality";

/**
 * Patch 7.11: safe mode. iOS closes a tab that runs out of memory without a
 * word, so a page load that started a yard and never said it ran fine counts
 * as a failure; two in a row and the game starts a Quality level lower.
 */

const storage = (entries: Record<string, string> = {}): Storage => {
  const kept = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
    removeItem: (key: string) => void kept.delete(key),
  } as Storage;
};

/** Timers the test runs by hand. */
const clock = () => {
  let next = 1;
  const timers = new Map<number, { run: () => void; at: number }>();
  let now = 0;
  return {
    setTimer: (run: () => void, ms: number): unknown => {
      timers.set(next, { run, at: now + ms });
      return next++;
    },
    clearTimer: (handle: unknown): void => void timers.delete(handle as number),
    /** Lets `ms` pass, running what falls due in order. */
    pass: (ms: number): void => {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].run();
      }
      now = end;
    },
    waiting: (): number => timers.size,
  };
};

/** One page load ("a tab"): its boot, and its watch once the yard starts loading. */
const pageLoad = (store: Storage | null, id: string, fallback: Quality = "high") => {
  const time = clock();
  const page = { visible: true, idle: true };
  const steppedTo = stepDownAtBoot(store);
  const watch = new SafeModeWatch({
    store,
    id,
    level: () => quality(store, () => fallback),
    idle: () => page.idle,
    visible: () => page.visible,
    setTimer: time.setTimer,
    clearTimer: time.clearTimer,
  });
  return {
    steppedTo,
    watch,
    time,
    page,
    /** The yard starts loading. */
    yard: () => watch.start(),
    hide: () => {
      page.visible = false;
      watch.hidden();
    },
    show: () => {
      page.visible = true;
      watch.shown();
    },
  };
};

/** A load that reaches the yard and is then killed: nothing more is heard from it. */
const crash = (store: Storage, id: string, fallback: Quality = "high"): ReturnType<typeof pageLoad> => {
  const load = pageLoad(store, id, fallback);
  load.yard();
  return load;
};

describe("safe mode", () => {
  it("(1) two unfinished loads: the third starts one step lower, with the notice", () => {
    const store = storage();
    expect(crash(store, "a").steppedTo).toBeNull();
    expect(quality(store, () => "high")).toBe("high");
    expect(crash(store, "b").steppedTo).toBeNull();
    expect(unfinishedLoads(store)).toBe(2);
    expect(quality(store, () => "high")).toBe("high");

    const third = pageLoad(store, "c");
    expect(third.steppedTo).toBe("medium");
    expect(safeModeCap(store)).toBe("medium");
    expect(quality(store, () => "high")).toBe("medium");
    expect(unfinishedLoads(store)).toBe(0);
    // Not the player's choice: nothing is written there, and the music is not held.
    expect(qualityChoice(store)).toBeNull();
    expect(store.getItem("bymr.quality")).toBeNull();
    expect(musicHeld("medium", store)).toBe(false);
    // The notice is for that one load.
    third.yard();
    expect(pageLoad(store, "d").steppedTo).toBeNull();
  });

  it("(2) then two more unfinished loads: Low, and Low stays Low without another notice", () => {
    const store = storage();
    crash(store, "a");
    crash(store, "b");
    expect(crash(store, "c").steppedTo).toBe("medium");
    expect(crash(store, "d").steppedTo).toBeNull();
    const fifth = pageLoad(store, "e");
    expect(fifth.steppedTo).toBe("low");
    expect(quality(store, () => "high")).toBe("low");
    fifth.yard();
    crash(store, "f");
    expect(pageLoad(store, "g").steppedTo).toBeNull();
    expect(safeModeCap(store)).toBe("low");
    expect(unfinishedLoads(store)).toBe(0);
  });

  it("(2b) steps below the level the failed loads ran at: a chosen Medium, or a phone's Medium, goes to Low", () => {
    const store = storage({ "bymr.quality": "medium" });
    crash(store, "a");
    crash(store, "b");
    expect(pageLoad(store, "c").steppedTo).toBe("low");
    expect(quality(store, () => "high")).toBe("low");
    // The device's Medium (no choice).
    const phone = storage();
    crash(phone, "a", "medium");
    crash(phone, "b", "medium");
    expect(pageLoad(phone, "c", "medium").steppedTo).toBe("low");
  });

  it("(3) hidden, then killed: the attempt was taken back on hide and is never counted", () => {
    const store = storage();
    for (const id of ["a", "b", "c"]) {
      const load = pageLoad(store, id);
      expect(load.steppedTo).toBeNull();
      load.yard();
      expect(unfinishedLoads(store)).toBe(1);
      load.time.pass(5000);
      load.hide();
      expect(unfinishedLoads(store)).toBe(0);
      // Killed in the background: nothing more happens.
    }
    expect(pageLoad(store, "d").steppedTo).toBeNull();
    expect(safeModeCap(store)).toBeNull();
  });

  it("(4) crash after return: hidden, shown again, then killed counts once", () => {
    const store = storage();
    const first = pageLoad(store, "a");
    first.yard();
    first.hide();
    expect(unfinishedLoads(store)).toBe(0);
    first.show();
    expect(unfinishedLoads(store)).toBe(1);
    first.show();
    expect(unfinishedLoads(store)).toBe(1);
    // Killed. One failure is not enough.
    expect(pageLoad(store, "b").steppedTo).toBeNull();
    crash(store, "b");
    expect(pageLoad(store, "c").steppedTo).toBe("medium");
  });

  it("(5) sticks after a successful stable load", () => {
    const store = storage();
    crash(store, "a");
    crash(store, "b");
    const good = pageLoad(store, "c");
    expect(good.steppedTo).toBe("medium");
    good.yard();
    good.time.pass(STABLE_MS);
    expect(good.watch.stable).toBe(true);
    expect(unfinishedLoads(store)).toBe(0);
    expect(safeModeCap(store)).toBe("medium");
    // The next visits are still on Medium, and say nothing.
    const next = pageLoad(store, "d");
    expect(next.steppedTo).toBeNull();
    expect(quality(store, () => "high")).toBe("medium");
    // A stable load also ends a run of failures: one before it and one after are not two in a row.
    const fresh = storage();
    crash(fresh, "a");
    const fine = pageLoad(fresh, "b");
    fine.yard();
    fine.time.pass(STABLE_MS);
    crash(fresh, "c");
    expect(pageLoad(fresh, "d").steppedTo).toBeNull();
  });

  it("(6) a Settings choice or ?quality= clears the cap, and the count with it", () => {
    const store = storage();
    crash(store, "a");
    crash(store, "b");
    expect(pageLoad(store, "c").steppedTo).toBe("medium");
    crash(store, "d");
    setQuality("high", store);
    expect(safeModeCap(store)).toBeNull();
    expect(unfinishedLoads(store)).toBe(0);
    expect(quality(store, () => "medium")).toBe("high");
    expect(store.getItem(SAFE_MODE_KEY)).toBeNull();
    // (`?quality=` goes through setQuality too: qualityParam.test.ts.)
    // Crashing again on the chosen High steps down again.
    crash(store, "e");
    crash(store, "f");
    expect(pageLoad(store, "g").steppedTo).toBe("medium");
    expect(qualityChoice(store)).toBe("high");
    expect(quality(store)).toBe("medium");
    // A choice at or under the cap is not raised by it.
    expect(lowerQuality("low", "medium")).toBe("low");
  });

  it("(7) pagehide and visibilitychange both firing subtract once, and a restored page re-arms once", () => {
    const store = storage();
    crash(store, "a");
    const load = pageLoad(store, "b");
    load.yard();
    expect(unfinishedLoads(store)).toBe(2);
    load.hide();
    load.watch.hidden();
    load.watch.hidden();
    // Only this load's own mark went; the earlier failure is still counted.
    expect(unfinishedLoads(store)).toBe(1);
    expect(Object.keys(readSafeMode(store).loads)).toEqual(["a"]);
    expect(load.time.waiting()).toBe(0);
    // Back from the back/forward cache: pageshow and visibilitychange.
    load.show();
    load.watch.shown();
    expect(unfinishedLoads(store)).toBe(2);
    expect(load.time.waiting()).toBe(1);
    // Events before the yard starts (the login page) do nothing.
    const login = pageLoad(storage(), "z");
    login.hide();
    login.show();
    expect(login.time.waiting()).toBe(0);
  });

  it("(8) two tabs: A stable, B opens, no trigger; nor with A still loading", () => {
    const store = storage();
    const a = pageLoad(store, "a");
    a.yard();
    a.time.pass(STABLE_MS);
    expect(a.watch.stable).toBe(true);
    const b = pageLoad(store, "b");
    expect(b.steppedTo).toBeNull();
    b.yard();
    // A third and a fourth, each opened while the one before is still up.
    const c = pageLoad(store, "c");
    expect(c.steppedTo).toBeNull();
    // A phone shows one tab at a time: opening C hid B, which took its mark back.
    b.hide();
    c.yard();
    expect(pageLoad(store, "d").steppedTo).toBeNull();
    expect(safeModeCap(store)).toBeNull();
    // A load only ever removes its own mark.
    b.show();
    c.hide();
    expect(Object.keys(readSafeMode(store).loads)).toEqual(["b"]);
  });

  it("(9) the 30 s count visible time only, and wait for the yard's sheets to be in", () => {
    const store = storage();
    const load = pageLoad(store, "a");
    load.page.idle = false;
    load.yard();
    load.time.pass(STABLE_MS - TICK_MS);
    expect(load.watch.stable).toBe(false);
    // Hidden for a long while: none of it counts, and the clock starts again.
    load.hide();
    load.time.pass(10 * STABLE_MS);
    expect(load.watch.stable).toBe(false);
    load.show();
    load.time.pass(STABLE_MS - TICK_MS);
    expect(load.watch.stable).toBe(false);
    // 30 s seen, but the sheets are still coming in (two at a time on a slow link).
    load.time.pass(5 * TICK_MS);
    expect(load.watch.stable).toBe(false);
    expect(unfinishedLoads(store)).toBe(1);
    load.page.idle = true;
    load.time.pass(TICK_MS);
    expect(load.watch.stable).toBe(true);
    expect(unfinishedLoads(store)).toBe(0);
    expect(load.time.waiting()).toBe(0);
    // Once stable, hiding and showing do nothing more.
    load.hide();
    load.show();
    expect(unfinishedLoads(store)).toBe(0);
    // A yard that starts while the page is hidden waits to be seen.
    const hiddenStart = pageLoad(store, "b");
    hiddenStart.page.visible = false;
    hiddenStart.yard();
    expect(unfinishedLoads(store)).toBe(0);
    hiddenStart.show();
    expect(unfinishedLoads(store)).toBe(1);
  });

  it("(10) storage throwing or missing: off, and nothing throws", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    // Reads work, writes do not (a full or private store).
    const readOnly = { ...storage(), setItem: () => { throw new Error("full"); } } as Storage;
    for (const store of [blocked, readOnly, null]) {
      for (const id of ["a", "b", "c", "d"]) {
        const load = pageLoad(store, id);
        expect(load.steppedTo).toBeNull();
        load.yard();
        load.hide();
        load.show();
        load.time.pass(STABLE_MS);
        expect(load.watch.stable).toBe(true);
      }
      expect(safeModeCap(store)).toBeNull();
      expect(unfinishedLoads(store)).toBe(0);
      expect(() => clearSafeMode(store)).not.toThrow();
      expect(() => markLoad(store, "x", "high")).not.toThrow();
      expect(quality(store, () => "high")).toBe("high");
    }
  });

  it("reads anything unreadable as nothing kept; a tester's hand-written state forces the notice", () => {
    for (const raw of ["", "nonsense", "null", "[]", '{"cap":"ultra","loads":7}']) {
      const store = storage({ [SAFE_MODE_KEY]: raw });
      expect(readSafeMode(store)).toEqual({ cap: null, loads: {} });
      expect(stepDownAtBoot(store)).toBeNull();
    }
    const byHand = storage({ [SAFE_MODE_KEY]: '{"cap":null,"loads":{"a":"high","b":"high"}}' });
    expect(pageLoad(byHand, "c").steppedTo).toBe("medium");
    expect(byHand.getItem(SAFE_MODE_KEY)).toBe('{"cap":"medium","loads":{}}');
    // A level that is not one counts as High.
    const odd = storage({ [SAFE_MODE_KEY]: '{"loads":{"a":"x","b":1}}' });
    expect(stepDownAtBoot(odd)).toBe("medium");
  });
});
