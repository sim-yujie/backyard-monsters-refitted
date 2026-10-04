// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IDLE_INPUT_EVENTS,
  IDLE_TIMINGS,
  IdleState,
  IdleWatch,
  idleDurationText,
  idleTimingsFor,
} from "./idleWatch";

/**
 * The idle disconnect (#271): a countdown at 9 minutes without input, the
 * disconnect at 10, any input cancelling, nothing while no game screen holds
 * the watch, and an attack or replay holding it off until it is left.
 */

const MINUTE = 60_000;
const { disconnectMs, warningMs } = IDLE_TIMINGS;
const warnAfter = disconnectMs - warningMs;

let visibility: DocumentVisibilityState;
let input: EventTarget;
let events: string[];
let warnedUntil: number | null;
let watch: IdleWatch;

const setVisibility = (state: DocumentVisibilityState): void => {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  input = new EventTarget();
  events = [];
  warnedUntil = null;
  watch = new IdleWatch({
    input,
    onWarn: (at) => {
      warnedUntil = at;
      events.push("warn");
    },
    onCancelWarn: () => events.push("cancel"),
    onDisconnect: () => events.push("disconnect"),
  });
});

afterEach(() => {
  watch.destroy();
  vi.useRealTimers();
});

describe("IdleWatch", () => {
  it("is ten minutes and one, as the owner set", () => {
    expect(IDLE_TIMINGS).toEqual({ disconnectMs: 10 * MINUTE, warningMs: MINUTE });
  });

  it("warns at 9 minutes without input and disconnects at 10", () => {
    watch.hold();
    const start = Date.now();
    vi.advanceTimersByTime(warnAfter - 1);
    expect(events).toEqual([]);
    expect(watch.state).toBe(IdleState.WATCHING);
    vi.advanceTimersByTime(1);
    expect(events).toEqual(["warn"]);
    expect(warnedUntil).toBe(start + disconnectMs);
    expect(watch.state).toBe(IdleState.WARNING);
    vi.advanceTimersByTime(warningMs - 1);
    expect(events).toEqual(["warn"]);
    vi.advanceTimersByTime(1);
    expect(events).toEqual(["warn", "cancel", "disconnect"]);
    expect(watch.state).toBe(IdleState.DISCONNECTED);
  });

  it.each(IDLE_INPUT_EVENTS)("counts %s as input", (type) => {
    watch.hold();
    vi.advanceTimersByTime(5 * MINUTE);
    input.dispatchEvent(new Event(type));
    vi.advanceTimersByTime(warnAfter - 1);
    expect(events).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(events).toEqual(["warn"]);
  });

  it("takes the countdown down on input and starts the 10 minutes again", () => {
    watch.hold();
    vi.advanceTimersByTime(warnAfter + 30_000);
    expect(events).toEqual(["warn"]);
    input.dispatchEvent(new Event("pointermove"));
    expect(events).toEqual(["warn", "cancel"]);
    expect(watch.state).toBe(IdleState.WATCHING);
    vi.advanceTimersByTime(warnAfter - 1);
    expect(events).toEqual(["warn", "cancel"]);
    vi.advanceTimersByTime(1 + warningMs);
    expect(events).toEqual(["warn", "cancel", "warn", "cancel", "disconnect"]);
  });

  it("does nothing while no screen holds it, and stops when the last hold goes", () => {
    vi.advanceTimersByTime(disconnectMs * 2);
    expect(events).toEqual([]);
    expect(watch.state).toBe(IdleState.OFF);

    input.dispatchEvent(new Event("keydown"));
    const release = watch.hold();
    vi.advanceTimersByTime(warnAfter);
    expect(events).toEqual(["warn"]);
    release();
    release();
    expect(events).toEqual(["warn", "cancel"]);
    vi.advanceTimersByTime(disconnectMs);
    expect(events).toEqual(["warn", "cancel"]);
    expect(watch.state).toBe(IdleState.OFF);
  });

  it("keeps counting from the last input across screens", () => {
    const yard = watch.hold();
    vi.advanceTimersByTime(5 * MINUTE);
    // Yard to map: the hold passes over without starting the 10 minutes again.
    yard();
    watch.hold();
    vi.advanceTimersByTime(4 * MINUTE);
    expect(events).toEqual(["warn"]);
  });

  it("disconnects once, and input after it changes nothing", () => {
    watch.hold();
    vi.advanceTimersByTime(disconnectMs);
    input.dispatchEvent(new Event("pointerdown"));
    vi.advanceTimersByTime(disconnectMs * 2);
    expect(events).toEqual(["warn", "cancel", "disconnect"]);
    expect(watch.state).toBe(IdleState.DISCONNECTED);
  });

  describe("an attack or a replay", () => {
    it("holds the countdown and the disconnect off for as long as it lasts", () => {
      watch.hold();
      const undefer = watch.defer();
      vi.advanceTimersByTime(disconnectMs * 3);
      expect(events).toEqual([]);
      expect(watch.state).toBe(IdleState.OFF);
      undefer();
      expect(events).toEqual(["disconnect"]);
    });

    it("takes a countdown already up down when it starts", () => {
      watch.hold();
      vi.advanceTimersByTime(warnAfter);
      watch.defer();
      expect(events).toEqual(["warn", "cancel"]);
      vi.advanceTimersByTime(disconnectMs);
      expect(events).toEqual(["warn", "cancel"]);
    });

    it("disconnects at once when left with the player still idle", () => {
      watch.hold();
      vi.advanceTimersByTime(MINUTE);
      const undefer = watch.defer();
      vi.advanceTimersByTime(12 * MINUTE);
      undefer();
      undefer();
      expect(events).toEqual(["disconnect"]);
    });

    it("shows the countdown for what is left when left between 9 and 10 minutes", () => {
      watch.hold();
      const start = Date.now();
      const undefer = watch.defer();
      vi.advanceTimersByTime(warnAfter + 20_000);
      undefer();
      expect(events).toEqual(["warn"]);
      expect(warnedUntil).toBe(start + disconnectMs);
      vi.advanceTimersByTime(warningMs - 20_000);
      expect(events).toEqual(["warn", "cancel", "disconnect"]);
    });

    it("leaves a player who gave input during it watched as usual", () => {
      watch.hold();
      const undefer = watch.defer();
      vi.advanceTimersByTime(20 * MINUTE);
      input.dispatchEvent(new Event("wheel"));
      vi.advanceTimersByTime(2 * MINUTE);
      undefer();
      expect(events).toEqual([]);
      vi.advanceTimersByTime(warnAfter - 2 * MINUTE);
      expect(events).toEqual(["warn"]);
    });
  });

  describe("a hidden tab", () => {
    it("counts hidden time, and checks the clock again on the way back", () => {
      watch.hold();
      setVisibility("hidden");
      // A hidden tab throttles timers: the clock moves on without them firing.
      vi.setSystemTime(Date.now() + 15 * MINUTE);
      expect(events).toEqual([]);
      setVisibility("visible");
      expect(events).toEqual(["disconnect"]);
    });

    it("shows the countdown for what is left after 9 minutes away", () => {
      watch.hold();
      const start = Date.now();
      setVisibility("hidden");
      vi.setSystemTime(start + warnAfter + 10_000);
      setVisibility("visible");
      expect(events).toEqual(["warn"]);
      expect(warnedUntil).toBe(start + disconnectMs);
    });
  });

  it("stops listening when destroyed", () => {
    watch.hold();
    watch.destroy();
    vi.advanceTimersByTime(disconnectMs * 2);
    expect(events).toEqual([]);
  });
});

describe("idleTimingsFor", () => {
  it("shortens the times from ?idle in a dev build", () => {
    expect(idleTimingsFor("?idle=40,20", true)).toEqual({
      disconnectMs: 40_000,
      warningMs: 20_000,
    });
    expect(idleTimingsFor("?idle=30", true)).toEqual({
      disconnectMs: 30_000,
      warningMs: 15_000,
    });
    expect(idleTimingsFor("?idle=10,60", true)).toEqual({
      disconnectMs: 10_000,
      warningMs: 10_000,
    });
  });

  it("never in a production build", () => {
    expect(idleTimingsFor("?idle=40,20", false)).toBe(IDLE_TIMINGS);
  });

  it("keeps the real times without the flag or with one that does not parse", () => {
    expect(idleTimingsFor("", true)).toBe(IDLE_TIMINGS);
    expect(idleTimingsFor("?idle=soon", true)).toBe(IDLE_TIMINGS);
    expect(idleTimingsFor("?idle=-5", true)).toBe(IDLE_TIMINGS);
    expect(idleTimingsFor("?idle=0", true)).toBe(IDLE_TIMINGS);
  });
});

describe("idleDurationText", () => {
  it("says the time in words", () => {
    expect(idleDurationText(10 * MINUTE)).toBe("10 minutes");
    expect(idleDurationText(MINUTE)).toBe("1 minute");
    expect(idleDurationText(40_000)).toBe("40 seconds");
  });
});
