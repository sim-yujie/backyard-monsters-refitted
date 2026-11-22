import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { replayAbandonedAttack } from "./abandonedAttack.js";
import {
  ReplayTimeoutError,
  ReplayWorkerLoadError,
  WORKER_LOAD_FAILURE_LIMIT,
  WORKER_LOAD_FAILURE_WINDOW_MS,
  isReplayDeferred,
  isReplayWorkerLoadError,
  onReplayWorkersBroken,
  replayAbandonedInWorker,
  replayLoad,
  reserveReplaySlot,
  type ReplayWorkersBroken,
} from "./replayRunner.js";

/**
 * The replay runs in a worker (issue #23, C5): the same answer as inline, a
 * deadline that stops it, and an event loop left free meanwhile.
 */

const SANDBOX = fileURLToPath(new URL("../../../../../web/test/fixtures/baseload-sandbox-yard.json", import.meta.url));
const sandbox = JSON.parse(readFileSync(SANDBOX, "utf8"));

const REPLAY_TIMEOUT_MS = 60_000;

/** Three hundred Pokeys and a champion on the sandbox yard: a heavy battle. */
const LOG = {
  v: 1,
  seed: 1834027731,
  events: [
    { kind: "fling", t: 480, x: -615, y: 115, r: 300, monsters: { C1: 300 }, champion: { t: 5, l: 5 } },
    { kind: "bomb", t: 800, x: 180, y: -480, id: "pb1" },
  ],
};
const SERVED = { r1: 5_000_000, r2: 5_000_000, r3: 5_000_000, r4: 5_000_000 };
const attacker = {
  academy: { C1: { level: 3 } },
  champion: [{ t: 5, l: 5, hp: 62000, status: 0 }],
  catapult: 2,
  buildingdata: {},
};

const abandonedInput = () => ({
  defender: { type: "tribe", buildingdata: sandbox.buildingdata, buildinghealthdata: {}, resources: SERVED },
  attacker: { academy: attacker.academy, champion: attacker.champion as never, siege: null },
  log: LOG as never,
  tick: 20_000,
  declareWar: false,
  playerLevel: 40,
});

/** The longest the event loop went without running a 1 ms timer while `work` ran. */
const longestStall = async (work: () => Promise<unknown>): Promise<number> => {
  let last = performance.now();
  let longest = 0;
  const ticker = setInterval(() => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
  }, 1);
  try {
    await work();
  } finally {
    clearInterval(ticker);
  }
  // The gap since the last tick too: work that held the loop to its very end
  // returns before the timer could fire again.
  return Math.max(longest, performance.now() - last);
};

describe("replays in a worker (#23, C5)", () => {
  test(
    "give the same abandoned-attack outcome as the replay run inline",
    async () => {
      expect(await replayAbandonedInWorker(abandonedInput())).toEqual(replayAbandonedAttack(abandonedInput()));
    },
    REPLAY_TIMEOUT_MS
  );

  test(
    "leave the event loop free: a 1 ms timer keeps firing through a heavy replay",
    async () => {
      const inlineStart = performance.now();
      replayAbandonedAttack(abandonedInput());
      const inline = performance.now() - inlineStart;

      const workerStart = performance.now();
      const stall = await longestStall(() => replayAbandonedInWorker(abandonedInput()));
      const worker = performance.now() - workerStart;
      // The same timer over an idle wait as long, right after: how long a busy
      // machine pauses this thread with no replay at all (issue #210).
      const baseline = await longestStall(() => new Promise((resolve) => setTimeout(resolve, worker)));

      console.warn(
        `replay inline ${inline.toFixed(0)} ms; longest event-loop stall in a worker ${stall.toFixed(0)} ms, idle ${baseline.toFixed(0)} ms`
      );
      // Inline, the loop is held for the whole replay; in a worker, never for
      // long. The limit is a third of the inline run (which stretches with the
      // machine's load as the stall does) or the idle pause plus 100 ms,
      // whichever is more, and never over half the inline run, so a replay
      // that ran on this thread would always fail.
      expect(inline).toBeGreaterThan(150);
      expect(stall).toBeLessThan(Math.min(inline / 2, Math.max(inline / 3, baseline + 100)));
    },
    REPLAY_TIMEOUT_MS
  );

  test(
    "stop at the deadline",
    async () => {
      const started = performance.now();
      const caught = await replayAbandonedInWorker(abandonedInput(), 50).catch((err: unknown) => err);
      expect(caught).toBeInstanceOf(ReplayTimeoutError);
      expect(performance.now() - started).toBeLessThan(1_000);
    },
    REPLAY_TIMEOUT_MS
  );
});

describe("the auto-attack slots (issue #221)", () => {
  test("are taken up to the cap, then turn the next one away once it has waited", async () => {
    const one = await reserveReplaySlot(0, 2);
    const two = await reserveReplaySlot(0, 2);
    expect(one).not.toBeNull();
    expect(two).not.toBeNull();
    expect(replayLoad().reserved).toBe(2);

    const started = performance.now();
    expect(await reserveReplaySlot(120, 2)).toBeNull();
    expect(performance.now() - started).toBeGreaterThanOrEqual(100);

    one!();
    one!();
    expect(replayLoad().reserved).toBe(1);
    const three = await reserveReplaySlot(0, 2);
    expect(three).not.toBeNull();
    two!();
    three!();
    expect(replayLoad().reserved).toBe(0);
  });

  test("count the replays already running: a slot waits for a worker to finish", async () => {
    const replay = replayAbandonedInWorker(abandonedInput());
    expect(replayLoad().running).toBe(1);
    const waiting = reserveReplaySlot(REPLAY_TIMEOUT_MS, 1);
    await replay;
    const slot = await waiting;
    expect(slot).not.toBeNull();
    expect(replayLoad().running).toBe(0);
    slot!();
  }, REPLAY_TIMEOUT_MS);
});

/**
 * Worker modules for the load-failure tests, written at test time so the
 * type check and the linter never see them: one that does not parse (the
 * 22 Nov 2026 outage's "SyntaxError: Unexpected keyword 'else'"), and one
 * that loads, says so, then dies before it answers.
 */
const WORKER_DIR = mkdtempSync(join(tmpdir(), "bymr-replay-worker-"));
const workerFile = (name: string, text: string): URL => {
  const path = join(WORKER_DIR, name);
  writeFileSync(path, text);
  return pathToFileURL(path);
};
const BROKEN_WORKER = workerFile("broken.js", "if (globalThis.x) { } else else { }\n");
const DIES_AFTER_LOAD = workerFile(
  "dies.js",
  "self.onmessage = () => { setTimeout(() => { throw new Error('the replay blew up'); }, 0); };\nself.postMessage({ ready: true });\n"
);

describe("a replay worker that fails to load (22 Nov 2026)", () => {
  afterEach(() => onReplayWorkersBroken(null));

  test("rejects with ReplayWorkerLoadError, which leaves the attack for later", async () => {
    const caught = await replayAbandonedInWorker(abandonedInput(), 10_000, BROKEN_WORKER).catch((err: unknown) => err);
    expect(caught).toBeInstanceOf(ReplayWorkerLoadError);
    expect(isReplayWorkerLoadError(caught)).toBe(true);
    expect(isReplayDeferred(caught)).toBe(true);
    expect(String((caught as Error).message)).toContain("SyntaxError");
    expect(replayLoad().running).toBe(0);
  });

  test("one that loaded and then died is the replay's own failure, not a load failure", async () => {
    const caught = await replayAbandonedInWorker(abandonedInput(), 10_000, DIES_AFTER_LOAD).catch((err: unknown) => err);
    expect(caught).toBeInstanceOf(Error);
    expect(isReplayWorkerLoadError(caught)).toBe(false);
    expect(isReplayDeferred(caught)).toBe(false);
  });

  test("a timeout is deferred too; a replay's own error is not", () => {
    expect(isReplayDeferred(new ReplayTimeoutError(5_000))).toBe(true);
    expect(isReplayDeferred(new Error("Battle replay failed: bad log"))).toBe(false);
  });

  test(`${WORKER_LOAD_FAILURE_LIMIT} in a row tell the broken-workers handler, once`, async () => {
    const told: ReplayWorkersBroken[] = [];
    onReplayWorkersBroken((broken) => told.push(broken));
    for (let i = 0; i < WORKER_LOAD_FAILURE_LIMIT - 1; i++) {
      await replayAbandonedInWorker(abandonedInput(), 10_000, BROKEN_WORKER).catch(() => null);
    }
    expect(told).toHaveLength(0);
    await replayAbandonedInWorker(abandonedInput(), 10_000, BROKEN_WORKER).catch(() => null);
    expect(told).toHaveLength(1);
    expect(told[0]!.failures).toBe(WORKER_LOAD_FAILURE_LIMIT);
    expect(told[0]!.lastError).toContain("SyntaxError");
    // Told once: the server is on its way out.
    await replayAbandonedInWorker(abandonedInput(), 10_000, BROKEN_WORKER).catch(() => null);
    expect(told).toHaveLength(1);
  });

  test("a worker that loads in between starts the count again", async () => {
    const told: ReplayWorkersBroken[] = [];
    onReplayWorkersBroken((broken) => told.push(broken));
    for (let i = 0; i < WORKER_LOAD_FAILURE_LIMIT - 1; i++) {
      await replayAbandonedInWorker(abandonedInput(), 10_000, BROKEN_WORKER).catch(() => null);
    }
    await replayAbandonedInWorker(abandonedInput(), 10_000, DIES_AFTER_LOAD).catch(() => null);
    for (let i = 0; i < WORKER_LOAD_FAILURE_LIMIT - 1; i++) {
      await replayAbandonedInWorker(abandonedInput(), 10_000, BROKEN_WORKER).catch(() => null);
    }
    expect(told).toHaveLength(0);
  });

  test("failures spread over more than the window do not add up", async () => {
    const told: ReplayWorkersBroken[] = [];
    onReplayWorkersBroken((broken) => told.push(broken));
    const realNow = Date.now;
    let shift = 0;
    Date.now = () => realNow() + shift;
    try {
      for (let i = 0; i < WORKER_LOAD_FAILURE_LIMIT; i++) {
        await replayAbandonedInWorker(abandonedInput(), 10_000, BROKEN_WORKER).catch(() => null);
        shift += WORKER_LOAD_FAILURE_WINDOW_MS / (WORKER_LOAD_FAILURE_LIMIT - 1) + 1_000;
      }
    } finally {
      Date.now = realNow;
    }
    expect(told).toHaveLength(0);
  });
});
