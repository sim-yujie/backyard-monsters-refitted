import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { replayAbandonedAttack } from "./abandonedAttack.js";
import { ReplayPool, type ReplayPoolOptions } from "./replayPool.js";
import { ReplayTimeoutError, ReplayWorkerLoadError } from "./replayErrors.js";
import type { ReplayJob } from "./replayRunner.js";

/**
 * The warm battle pool (patch 9.1): workers reused, the same answers as a
 * fresh worker, and a pool that heals itself (a crash, an exit while idle, a
 * stuck battle, a worker grown too big, one that never loads) without
 * leaking workers.
 */

const REAL_WORKER = new URL("./replayWorker.ts", import.meta.url);
const SANDBOX = fileURLToPath(new URL("../../../../../web/test/fixtures/baseload-sandbox-yard.json", import.meta.url));
const sandbox = JSON.parse(readFileSync(SANDBOX, "utf8"));
const LONG = 60_000;

/** A battle on the sandbox yard: `pokeys` Pokeys and a bomb, from `x`. */
const battle = (pokeys: number, x: number, seed: number): ReplayJob => ({
  kind: "abandoned",
  input: {
    defender: {
      type: "tribe",
      buildingdata: sandbox.buildingdata,
      buildinghealthdata: {},
      resources: { r1: 5_000_000, r2: 5_000_000, r3: 5_000_000, r4: 5_000_000 },
    },
    attacker: { academy: { C1: { level: 3 } }, champion: null, siege: null },
    log: {
      v: 1,
      seed,
      events: [
        { kind: "fling", t: 480, x, y: 115, r: 300, monsters: { C1: pokeys } },
        { kind: "bomb", t: 800, x: 180, y: -480, id: "pb1" },
      ],
    },
    tick: 20_000,
    declareWar: false,
    playerLevel: 40,
  } as never,
});

/**
 * A stand-in worker, written at test time: it answers `{ n }` (how many jobs
 * it has done) and, by the job's `input.cmd`, crashes, exits, hangs, or says
 * its heap is huge.
 */
const DIR = mkdtempSync(join(tmpdir(), "bymr-replay-pool-"));
const workerFile = (name: string, text: string): URL => {
  const path = join(DIR, name);
  writeFileSync(path, text);
  return pathToFileURL(path);
};
const FAKE = workerFile(
  "fake.js",
  `let n = 0;
self.onmessage = (event) => {
  const { id, job } = event.data;
  const cmd = job.input.cmd;
  n++;
  if (cmd === "crash") { setTimeout(() => { throw new Error("the replay blew up"); }, 0); return; }
  if (cmd === "hang") { for (;;) {} }
  self.postMessage({ ok: true, kind: "abandoned", result: { n }, id, heap: cmd === "fat" ? 2e9 : 1e6 });
  if (cmd === "exitAfter") setTimeout(() => process.exit(3), 20);
};
self.postMessage({ ready: true });
`
);
const BROKEN = workerFile("broken.js", "if (globalThis.x) { } else else { }\n");

const fake = (cmd = "ok"): ReplayJob => ({ kind: "abandoned", input: { cmd } as never });

const pools: ReplayPool[] = [];
const poolOf = (opts: Partial<ReplayPoolOptions> = {}): ReplayPool => {
  const pool = new ReplayPool({ workerUrl: FAKE, size: 1, maxJobs: 1_000, maxHeapBytes: 1e8, ...opts });
  pools.push(pool);
  return pool;
};
afterEach(() => {
  for (const pool of pools.splice(0)) pool.close();
});

const resultOf = async (pool: ReplayPool, job: ReplayJob, deadlineMs = LONG) =>
  (await pool.run(job, deadlineMs)).result as unknown as { n: number };

const until = async (check: () => boolean, ms = 5_000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await Bun.sleep(5);
  }
};

describe("the warm pool", () => {
  test("reuses its worker: one start for many battles", async () => {
    const pool = poolOf();
    for (let i = 1; i <= 5; i++) expect((await resultOf(pool, fake())).n).toBe(i);
    expect(pool.spawned).toBe(1);
  });

  test(
    "a warm worker gives the same answers as a fresh one, whatever it fought before",
    async () => {
      const pool = poolOf({ workerUrl: REAL_WORKER });
      const jobs = [battle(300, -615, 1834027731), battle(40, 300, 99), battle(120, -200, 7)];
      // Twice through, the second time in another order, on one warm worker.
      for (const job of [...jobs, ...[...jobs].reverse()]) {
        const reply = await pool.run(job, LONG);
        expect(reply.result).toEqual(replayAbandonedAttack(structuredClone(job.input) as never));
      }
      expect(pool.spawned).toBe(1);
    },
    LONG
  );

  test("fights `size` battles at once and queues the rest in order", async () => {
    const pool = poolOf({ size: 2 });
    const asked = [1, 2, 3, 4, 5, 6].map(() => resultOf(pool, fake()));
    expect(pool.fighting).toBe(2);
    expect(pool.queued).toBe(4);
    const answers = await Promise.all(asked);
    // Two workers, each starting at its first battle; six battles in all.
    expect(answers.filter((a) => a.n === 1)).toHaveLength(2);
    expect(Math.max(...answers.map((a) => a.n))).toBeLessThanOrEqual(5);
    expect(pool.spawned).toBe(2);
  });

  test("warm() starts every worker before the first battle, and keeps them started", async () => {
    const pool = poolOf({ size: 2 });
    pool.warm();
    expect(pool.alive).toBe(2);
    await expect(pool.run(fake("crash"), LONG)).rejects.toThrow("the replay blew up");
    expect(pool.alive).toBe(2);
    expect(pool.spawned).toBe(3);
  });

  test("a pool never warmed stops an idle worker, so tests and scripts leave none behind", async () => {
    const pool = poolOf({ idleMs: 30 });
    await resultOf(pool, fake());
    expect(pool.alive).toBe(1);
    await until(() => pool.alive === 0);
  });
});

describe("the pool heals itself", () => {
  test("a battle that crashes fails alone; the next gets a fresh worker", async () => {
    const pool = poolOf();
    const caught = await pool.run(fake("crash"), LONG).catch((err: unknown) => err);
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(ReplayWorkerLoadError);
    expect((await resultOf(pool, fake())).n).toBe(1);
    expect(pool.replaced.crash).toBe(1);
  });

  test("a worker that exits while idle is noticed and replaced", async () => {
    const pool = poolOf();
    await resultOf(pool, fake("exitAfter"));
    await until(() => pool.replaced.exit === 1);
    expect(pool.alive).toBe(0);
    expect((await resultOf(pool, fake())).n).toBe(1);
  });

  test("a stuck battle is stopped at its deadline and its worker replaced", async () => {
    const pool = poolOf();
    const started = performance.now();
    await expect(pool.run(fake("hang"), 100)).rejects.toBeInstanceOf(ReplayTimeoutError);
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(pool.replaced.timeout).toBe(1);
    expect((await resultOf(pool, fake())).n).toBe(1);
  });

  test("a job still queued at its deadline is dropped without touching a worker", async () => {
    const pool = poolOf();
    const stuck = pool.run(fake("hang"), 300).catch((err: unknown) => err);
    const queued = await pool.run(fake(), 50).catch((err: unknown) => err);
    expect(queued).toBeInstanceOf(ReplayTimeoutError);
    expect(pool.replaced.timeout).toBe(0);
    expect(await stuck).toBeInstanceOf(ReplayTimeoutError);
    expect(pool.replaced.timeout).toBe(1);
  });

  test("a worker grown too big is replaced after its battle", async () => {
    const pool = poolOf();
    expect((await resultOf(pool, fake("fat"))).n).toBe(1);
    expect(pool.replaced.heap).toBe(1);
    expect((await resultOf(pool, fake())).n).toBe(1);
    expect(pool.spawned).toBe(2);
  });

  test("a worker is replaced after maxJobs battles, so many battles start few workers", async () => {
    const pool = poolOf({ maxJobs: 50 });
    for (let i = 0; i < 200; i++) await resultOf(pool, fake());
    expect(pool.spawned).toBe(4);
    expect(pool.replaced.jobs).toBe(4);
  });

  test("a worker that never loads fails its job as a load error, and the seat pauses before trying again", async () => {
    const failures: string[] = [];
    let loaded = 0;
    const pool = poolOf({
      workerUrl: BROKEN,
      loadBackoffMs: 200,
      onLoadFailure: (reason) => failures.push(reason),
      onLoaded: () => loaded++,
    });
    const caught = await pool.run(fake(), LONG).catch((err: unknown) => err);
    expect(caught).toBeInstanceOf(ReplayWorkerLoadError);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("SyntaxError");
    // The seat pauses: a job asked for now waits, and fails only once the pause is over.
    const started = performance.now();
    await expect(pool.run(fake(), LONG)).rejects.toBeInstanceOf(ReplayWorkerLoadError);
    expect(performance.now() - started).toBeGreaterThanOrEqual(150);
    expect(failures).toHaveLength(2);
    expect(loaded).toBe(0);
    expect(pool.spawned).toBe(2);
  });

  test("close() stops every worker and fails what is queued", async () => {
    const pool = poolOf();
    const fighting = pool.run(fake("hang"), LONG).catch((err: unknown) => err);
    const queued = pool.run(fake(), LONG).catch((err: unknown) => err);
    await until(() => pool.fighting === 1);
    pool.close();
    expect(String(await fighting)).toContain("closed");
    expect(String(await queued)).toContain("closed");
    expect(pool.alive).toBe(0);
  });
});

describe("the real worker", () => {
  test.skipIf(process.platform !== "linux")(
    "fights at a lower priority (nice +10) and leaves this thread's alone",
    async () => {
      // A thread may end between the listing and the read: it is skipped.
      const niceOf = (task: string) => {
        try {
          return Number(readFileSync(`/proc/self/task/${task}/stat`, "utf8").split(") ")[1]!.split(" ")[16]);
        } catch {
          return null;
        }
      };
      const pool = poolOf({ workerUrl: REAL_WORKER });
      pool.warm();
      await pool.run(battle(10, 300, 5), LONG);
      const niced = readdirSync("/proc/self/task").filter((task) => niceOf(task) === 10);
      expect(niced.length).toBeGreaterThan(0);
      expect(niceOf(String(process.pid))).toBe(0);
    },
    LONG
  );
});
