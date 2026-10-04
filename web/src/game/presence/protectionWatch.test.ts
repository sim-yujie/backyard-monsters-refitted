// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROTECTION_TIMINGS,
  ProtectionWatch,
  RESUME_GRACE_MS,
  protectionTimingsFor,
  type ProtectionAnswer,
} from "./protectionWatch";

/**
 * "Stay protected?" (#275): nine minutes after the last real action, on the
 * server's clock, a prompt; any real action or the tap takes it down. The
 * idle "Still there?" countdown comes first.
 */

/** The server's clock runs 500 seconds ahead of the browser's. */
const SKEW_S = 500;
const T0_MS = 1_900_000_000_000;
const serverNow = () => Math.floor(Date.now() / 1000) + SKEW_S;

let shown: number[];
let hides: number;
let account: string | null;
let stayAnswer: () => Promise<ProtectionAnswer>;
let watch: ProtectionWatch;

const make = (timings = PROTECTION_TIMINGS) =>
  new ProtectionWatch({
    timings,
    onShow: (endsAt) => shown.push(endsAt),
    onHide: () => {
      hides += 1;
    },
    stay: () => stayAnswer(),
    account: () => account,
    now: () => Date.now(),
  });

const minutes = (count: number) => count * 60_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0_MS);
  shown = [];
  hides = 0;
  account = "token-a";
  stayAnswer = async () => ({ now: serverNow(), lastAction: serverNow() });
  watch = make();
  watch.hold();
});

afterEach(() => {
  watch.stop();
  vi.useRealTimers();
});

describe("ProtectionWatch", () => {
  it("asks at 9 minutes since the last real action, on the server's clock", () => {
    // The answer says the last action was two minutes ago on the server.
    watch.hear({ now: serverNow(), lastAction: serverNow() - 120 });
    vi.advanceTimersByTime(minutes(7) - 1);
    expect(shown).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(shown).toHaveLength(1);
    expect(watch.showing).toBe(true);
    // It counts down to the end of the ten minutes, in browser time.
    expect(shown[0]).toBe(Date.now() + minutes(1));
  });

  it("goes the moment a real action's answer says so, and comes back nine minutes after it", () => {
    watch.hear({ now: serverNow(), lastAction: serverNow() });
    vi.advanceTimersByTime(minutes(9));
    expect(watch.showing).toBe(true);

    // A collect: its answer carries only `lastAction`.
    watch.hear({ lastAction: serverNow() });
    expect(watch.showing).toBe(false);
    expect(hides).toBe(1);
    vi.advanceTimersByTime(minutes(9));
    expect(watch.showing).toBe(true);
  });

  it("before any real action is known, counts from the first answer", () => {
    watch.hear({ now: serverNow(), lastAction: 0 });
    vi.advanceTimersByTime(minutes(5));
    // Later pings saying "none" do not move it.
    watch.hear({ now: serverNow(), lastAction: 0 });
    vi.advanceTimersByTime(minutes(4));
    expect(watch.showing).toBe(true);
  });

  it("the tap is heard like a ping, and takes the prompt down", async () => {
    watch.hear({ now: serverNow(), lastAction: serverNow() });
    vi.advanceTimersByTime(minutes(9) + 30_000);
    expect(watch.due).toBe(true);
    await watch.stay();
    expect(watch.showing).toBe(false);
    expect(watch.due).toBe(false);
  });

  it("waits while the idle countdown is up, and shows a moment after it goes", () => {
    watch.hear({ now: serverNow(), lastAction: serverNow() });
    watch.suppress(true);
    vi.advanceTimersByTime(minutes(9));
    expect(watch.due).toBe(true);
    expect(watch.showing).toBe(false);

    watch.suppress(false);
    expect(watch.showing).toBe(false);
    vi.advanceTimersByTime(RESUME_GRACE_MS);
    expect(watch.showing).toBe(true);
  });

  it("shows only while a game screen holds it", () => {
    const fresh = make();
    fresh.hear({ now: serverNow(), lastAction: serverNow() });
    vi.advanceTimersByTime(minutes(9));
    expect(fresh.showing).toBe(false);
    const release = fresh.hold();
    expect(fresh.showing).toBe(true);
    release();
    expect(fresh.showing).toBe(false);
    fresh.stop();
  });

  it("starts again for another account, and never shows after the idle disconnect", () => {
    watch.hear({ now: serverNow(), lastAction: serverNow() - 500 });
    account = "token-b";
    watch.hear({ now: serverNow(), lastAction: 0 });
    vi.advanceTimersByTime(minutes(8));
    expect(watch.showing).toBe(false);
    vi.advanceTimersByTime(minutes(1));
    expect(watch.showing).toBe(true);
    watch.stop();
    expect(watch.showing).toBe(false);
  });
});

describe("protectionTimingsFor", () => {
  it("takes ?protect= in a dev build only", () => {
    expect(protectionTimingsFor("?protect=40,20", true)).toEqual({ windowMs: 40_000, warningMs: 20_000 });
    expect(protectionTimingsFor("?protect=40", true)).toEqual({ windowMs: 40_000, warningMs: 20_000 });
    expect(protectionTimingsFor("?protect=40,90", true)).toEqual({ windowMs: 40_000, warningMs: 40_000 });
    expect(protectionTimingsFor("?protect=40,20", false)).toBe(PROTECTION_TIMINGS);
    expect(protectionTimingsFor("?protect=nope", true)).toBe(PROTECTION_TIMINGS);
    expect(PROTECTION_TIMINGS).toEqual({ windowMs: 600_000, warningMs: 60_000 });
  });

  it("asks at the shortened time", () => {
    const fast = make(protectionTimingsFor("?protect=40,20", true));
    fast.hold();
    fast.hear({ now: serverNow(), lastAction: serverNow() });
    vi.advanceTimersByTime(19_999);
    expect(fast.showing).toBe(false);
    vi.advanceTimersByTime(1);
    expect(fast.showing).toBe(true);
    fast.stop();
  });
});
