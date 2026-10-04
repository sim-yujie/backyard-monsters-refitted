// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PRESENCE_INTERVAL_MS, PresencePing } from "./presencePing";

/**
 * The presence ping (#242): every 30 seconds while a screen holds it and the
 * tab is visible, at once on a hold or a return to the tab when the last ping
 * is that old, never while hidden, signed out or released.
 */

let visibility: DocumentVisibilityState;
let signedIn: boolean;
let pings: number;
let ping: PresencePing;

const setVisibility = (state: DocumentVisibilityState): void => {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  signedIn = true;
  pings = 0;
  ping = new PresencePing({
    ping: async () => {
      pings += 1;
    },
    signedIn: () => signedIn,
    now: () => Date.now(),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PresencePing", () => {
  it("pings at once on the first hold, then every 30 seconds", () => {
    const release = ping.hold();
    vi.advanceTimersByTime(0);
    expect(pings).toBe(1);
    vi.advanceTimersByTime(PRESENCE_INTERVAL_MS - 1);
    expect(pings).toBe(1);
    vi.advanceTimersByTime(1);
    expect(pings).toBe(2);
    vi.advanceTimersByTime(PRESENCE_INTERVAL_MS * 3);
    expect(pings).toBe(5);
    release();
  });

  it("stops when the last hold is given back, and a second release does nothing", () => {
    const yard = ping.hold();
    const map = ping.hold();
    vi.advanceTimersByTime(0);
    expect(pings).toBe(1);
    yard();
    yard();
    expect(ping.running).toBe(true);
    vi.advanceTimersByTime(PRESENCE_INTERVAL_MS);
    expect(pings).toBe(2);
    map();
    expect(ping.running).toBe(false);
    vi.advanceTimersByTime(PRESENCE_INTERVAL_MS * 4);
    expect(pings).toBe(2);
  });

  it("moving between screens sends no extra ping", () => {
    const yard = ping.hold();
    vi.advanceTimersByTime(10_000);
    expect(pings).toBe(1);
    yard();
    const map = ping.hold();
    vi.advanceTimersByTime(0);
    expect(pings).toBe(1);
    vi.advanceTimersByTime(PRESENCE_INTERVAL_MS - 10_000 - 1);
    expect(pings).toBe(1);
    vi.advanceTimersByTime(1);
    expect(pings).toBe(2);
    map();
  });

  it("goes quiet while the tab is hidden and pings on return once 30 seconds have passed", () => {
    const release = ping.hold();
    vi.advanceTimersByTime(0);
    expect(pings).toBe(1);
    setVisibility("hidden");
    vi.advanceTimersByTime(PRESENCE_INTERVAL_MS * 5);
    expect(pings).toBe(1);
    setVisibility("visible");
    vi.advanceTimersByTime(0);
    expect(pings).toBe(2);

    // Back within 30 seconds of the last: the next goes on its usual time.
    vi.advanceTimersByTime(5_000);
    setVisibility("hidden");
    setVisibility("visible");
    vi.advanceTimersByTime(0);
    expect(pings).toBe(2);
    vi.advanceTimersByTime(PRESENCE_INTERVAL_MS - 5_000);
    expect(pings).toBe(3);
    release();
  });

  it("starts nothing on a hold while hidden", () => {
    visibility = "hidden";
    const release = ping.hold();
    vi.advanceTimersByTime(PRESENCE_INTERVAL_MS * 2);
    expect(pings).toBe(0);
    setVisibility("visible");
    vi.advanceTimersByTime(0);
    expect(pings).toBe(1);
    release();
  });

  it("sends nothing signed out, and pings within 30 seconds of signing in", () => {
    signedIn = false;
    const release = ping.hold();
    vi.advanceTimersByTime(PRESENCE_INTERVAL_MS * 2);
    expect(pings).toBe(0);
    expect(vi.getTimerCount()).toBe(1);
    signedIn = true;
    vi.advanceTimersByTime(PRESENCE_INTERVAL_MS);
    expect(pings).toBe(1);
    release();
  });

  it("a failed ping is ignored and the next goes on time", async () => {
    let calls = 0;
    const failing = new PresencePing({
      ping: () => {
        calls += 1;
        return Promise.reject(new Error("offline"));
      },
      signedIn: () => true,
      now: () => Date.now(),
    });
    const release = failing.hold();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(PRESENCE_INTERVAL_MS);
    expect(calls).toBe(2);
    release();
  });

  it("pings at once when asked, counts the next 30 seconds from there, and hands every answer on (#275)", async () => {
    const answers: unknown[] = [];
    const answering = new PresencePing({
      ping: async () => {
        pings += 1;
        return { error: 0, now: 1 };
      },
      signedIn: () => signedIn,
      now: () => Date.now(),
    });
    const stop = answering.onAnswer((answer) => answers.push(answer));
    const release = answering.hold();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pings).toBe(1);
    answering.pingNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(pings).toBe(2);
    await vi.advanceTimersByTimeAsync(PRESENCE_INTERVAL_MS - 1);
    expect(pings).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(pings).toBe(3);
    expect(answers).toEqual([{ error: 0, now: 1 }, { error: 0, now: 1 }, { error: 0, now: 1 }]);
    stop();
    signedIn = false;
    answering.pingNow();
    expect(pings).toBe(3);
    release();
  });

  it("removes its listener once released", () => {
    const release = ping.hold();
    release();
    setVisibility("hidden");
    setVisibility("visible");
    vi.advanceTimersByTime(PRESENCE_INTERVAL_MS);
    expect(pings).toBe(0);
  });
});
