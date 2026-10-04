// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BotCheckAnswer, BotCheckChallenge } from "@/api/botCheck";
import { BotCheckWatch, RETRY_MS, type BotCheckView } from "./botCheckWatch";

/**
 * The in-game check (#273): heard from `checkPending`, asked for once there
 * is a screen to show it on, answered by a tap; a wrong tap shows the next
 * check, too many a wait and then a new check.
 */

const T0_MS = 1_900_000_000_000;
/** The server's clock runs 500 seconds ahead of the browser's. */
const SKEW_S = 500;
const serverNow = () => Math.floor(Date.now() / 1000) + SKEW_S;

const check = (id: string): BotCheckChallenge => ({
  id,
  prompt: "How many of these are in the picture?",
  name: "Pokey",
  reference: "data:image/webp;base64,AA",
  picture: "data:image/png;base64,AA",
});

let shown: BotCheckView[];
let hides: number;
let account: string | null;
let fetchAnswer: () => Promise<BotCheckAnswer>;
let answerFor: (challenge: string, option: string) => Promise<BotCheckAnswer>;
let fetches: number;
let watch: BotCheckWatch;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0_MS);
  shown = [];
  hides = 0;
  account = "token-a";
  fetches = 0;
  fetchAnswer = async () => ({ error: 0, now: serverNow(), checkPending: true, challenge: check("k1") });
  answerFor = async () => ({ error: 0, now: serverNow(), checkPending: false, solved: true });
  watch = new BotCheckWatch({
    fetch: () => {
      fetches += 1;
      return fetchAnswer();
    },
    answer: (challenge, option) => answerFor(challenge, option),
    onShow: (view) => shown.push(view),
    onHide: () => {
      hides += 1;
    },
    account: () => account,
    now: () => Date.now(),
  });
});

afterEach(() => {
  watch.stop();
  vi.useRealTimers();
});

describe("BotCheckWatch", () => {
  it("shows nothing until a check is pending, then asks for it once", async () => {
    watch.hold();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetches).toBe(0);
    watch.hear(false);
    expect(shown).toEqual([]);

    watch.hear(true);
    watch.hear(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetches).toBe(1);
    expect(shown).toEqual([{ kind: "challenge", challenge: check("k1"), retry: false }]);
    expect(watch.showing).toBe(true);
  });

  it("waits for a game screen to show it, and goes with the last one", async () => {
    watch.hear(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetches).toBe(0);
    const release = watch.hold();
    await vi.advanceTimersByTimeAsync(0);
    expect(shown).toHaveLength(1);
    release();
    expect(hides).toBe(1);
    // Back on a screen: the same check, not a new one.
    watch.hold();
    expect(shown).toHaveLength(2);
    expect(fetches).toBe(1);
  });

  it("a right tap clears it", async () => {
    watch.hold();
    watch.hear(true);
    await vi.advanceTimersByTimeAsync(0);
    const sent: string[][] = [];
    answerFor = async (challenge, option) => {
      sent.push([challenge, option]);
      return { error: 0, checkPending: false, solved: true };
    };
    await watch.choose("3");
    expect(sent).toEqual([["k1", "3"]]);
    expect(hides).toBe(1);
    expect(watch.showing).toBe(false);
    expect(watch.waiting).toBe(false);
  });

  it("a wrong tap shows the next check, marked as a retry", async () => {
    watch.hold();
    watch.hear(true);
    await vi.advanceTimersByTimeAsync(0);
    answerFor = async () => ({ error: 0, checkPending: true, solved: false, challenge: check("k2") });
    await watch.choose("1");
    expect(shown.at(-1)).toEqual({ kind: "challenge", challenge: check("k2"), retry: true });
    expect(hides).toBe(0);
  });

  it("too many wrong taps: a wait on the server's clock, then a new check", async () => {
    watch.hold();
    watch.hear(true);
    await vi.advanceTimersByTimeAsync(0);
    const until = serverNow() + 120;
    answerFor = async () => ({ error: 0, now: serverNow(), checkPending: true, solved: false, cooldownUntil: until });
    await watch.choose("1");
    expect(shown.at(-1)).toEqual({ kind: "wait", until: T0_MS + 120_000 });

    fetchAnswer = async () => ({ error: 0, now: serverNow(), checkPending: true, challenge: check("k3") });
    await vi.advanceTimersByTimeAsync(119_000);
    expect(fetches).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetches).toBe(2);
    expect(shown.at(-1)).toEqual({ kind: "challenge", challenge: check("k3"), retry: false });
  });

  it("a tap that fails throws for the card to show, and keeps the check", async () => {
    watch.hold();
    watch.hear(true);
    await vi.advanceTimersByTimeAsync(0);
    answerFor = async () => {
      throw new Error("offline");
    };
    await expect(watch.choose("1")).rejects.toThrow("offline");
    expect(watch.showing).toBe(true);
    answerFor = async () => ({ error: 0, checkPending: false, solved: true });
    await watch.choose("2");
    expect(watch.showing).toBe(false);
  });

  it("asks again a while after the check could not be fetched", async () => {
    fetchAnswer = async () => {
      throw new Error("offline");
    };
    watch.hold();
    watch.hear(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(shown).toEqual([]);
    fetchAnswer = async () => ({ error: 0, checkPending: true, challenge: check("k1") });
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(fetches).toBe(2);
    expect(shown).toHaveLength(1);
  });

  it("goes when an answer says none is pending, and for another account", async () => {
    watch.hold();
    watch.hear(true);
    await vi.advanceTimersByTimeAsync(0);
    watch.hear(false);
    expect(hides).toBe(1);

    watch.hear(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(watch.showing).toBe(true);
    account = "token-b";
    watch.hear(false);
    expect(watch.showing).toBe(false);
    expect(watch.waiting).toBe(false);
  });

  it("never shows after the idle disconnect", async () => {
    watch.hold();
    watch.stop();
    watch.hear(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetches).toBe(0);
    expect(shown).toEqual([]);
  });
});
