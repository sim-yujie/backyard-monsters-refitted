// Contention simulation of the replay slot (replayRunner.ts) on the live droplet (2 shared vCPU).
// No database, no server: a discrete-time model (1 ms steps) of one peak hour.
//
//   bun measure/sim.ts [scenario.json]      (prints a table; writes measure/results/sim-*.json)
//
// What it copies from the code (revamp 21000c79e):
// - reserveReplaySlot: a Repeat (and a raid start, Trojan spring, baiter test) polls every 50 ms
//   while running + reserved >= cap, and is refused "busy" after 5 s. No queue: whichever waiter's
//   own 50 ms timer fires first after the slot frees takes it (poll-and-barge).
// - Attack saves, the finaliser sweep and Inferno landings start their worker at once (no wait),
//   but each counts in `running` while its worker lives.
// - A Repeat holds its reservation from reserveReplaySlot to the `finally` of runAutoAttack: the
//   plan check, the attack load and checkpoint (database), the landing's replay (its own worker,
//   which also counts in `running`), the landing's database writes, and keepReplay.
// - A raid start holds its reservation across freezeYard, the fight and lockForFight.
//
// CPU: the box has 2 vCPU. The main thread (all HTTP, database driver, JSON) uses `mainLoad` of a
// core on average at the peak (lead: ~0.5). Live workers share what is left equally (processor
// sharing), at most one core each. Database phases are plain delays (Postgres is on the same box
// but its time is mostly waiting); they are scaled by `dbScale`.
//
// Load model (closed loop, as players behave): at the peak, `farmers` players are each farming
// camps with Repeat attack (press -> answer -> read result -> pick the next camp -> press), and
// `handAttackers` players are attacking by hand (attack of 1-3 min, then the save's replay). Raids
// and the minute sweep come on top as open arrivals. Daily players -> peak counts is a stated
// assumption (see scenarios below), to be replaced by the live numbers the lead reads.
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";

type Kind = "repeat" | "save" | "raid" | "inferno" | "finalise";

/** Fight CPU ms on the PC (cold worker, measured by bench.ts) per kind: sampled from the measured rows. */
// BENCH_TAG=pin2: the bench run pinned to 2 physical cores (taskset -c 0,2), as the droplet has 2 vCPU.
const BENCH_TAG = process.env.BENCH_TAG ?? "pin2";
const bench = JSON.parse(readFileSync(new URL(`./results/bench-cold-${BENCH_TAG}.json`, import.meta.url), "utf8"));
const benchWarm = JSON.parse(readFileSync(new URL(`./results/bench-warm-${BENCH_TAG}.json`, import.meta.url), "utf8"));
const fightsOf = (b: any, kind: string) => b.rows.filter((r: any) => r.kind === kind).map((r: any) => r.fight as number);
const startupsOf = (b: any) => b.rows.map((r: any) => r.startup as number);
const FIGHT_COLD: Record<string, number[]> = {
  repeat: fightsOf(bench, "repeat"),
  save: fightsOf(bench, "save"),
  raid: fightsOf(bench, "raid"),
  inferno: fightsOf(bench, "inferno"),
  finalise: fightsOf(bench, "save"),
};
const FIGHT_WARM: Record<string, number[]> = {
  repeat: fightsOf(benchWarm, "repeat"),
  save: fightsOf(benchWarm, "save"),
  raid: fightsOf(benchWarm, "raid"),
  inferno: fightsOf(benchWarm, "inferno"),
  finalise: fightsOf(benchWarm, "save"),
};
const STARTUP = startupsOf(bench);

/** Repeat's database phases on the PC (ms, measured by repeatRun.ts + the BLMEASURE marks). */
const repeatMarks = readFileSync(new URL(`./results/server-marks-${BENCH_TAG}.jsonl`, import.meta.url), "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l))
  .filter((r) => r.ev === "repeat-marks");
const REPEAT_LOAD_DB = repeatMarks.map((m) => m.attackLoadAndCheckpoint - m.planCheck);
// The landing minus its replay: the replay's own time is simulated from the bench.
const REPEAT_LAND_DB = repeatMarks.map((m) => Math.max(20, m.landing - m.attackLoadAndCheckpoint - 39) + (m.keepReplay - m.landing));
const PRE_SLOT_DB = 40;

export interface Fix {
  name: string;
  cap: number;
  /** Max ms a slot-taker waits before "busy". */
  waitMs: number;
  /** FIFO queue (fair) instead of poll-and-barge. */
  fifo: boolean;
  /** Warm worker pool: no start-up, warm JIT fight times. */
  warm: boolean;
  /** The Repeat reserves only around its replay(s), not its database work. */
  narrow: boolean;
  /** The Repeat's own worker does not count twice (reserved + running). */
  noDoubleCount: boolean;
  /** Workers run niced: the main thread gets its CPU first. */
  niced: boolean;
}

export interface Scenario {
  label: string;
  dau: number;
  farmers: number;
  handAttackers: number;
  raidsPerHour: number;
  /** Abandoned attacks landed by the minute sweep, per hour. */
  finalisePerHour: number;
  infernoPerHour: number;
  /** Droplet ms per PC ms for the battle CPU. */
  cpuScale: number;
  dbScale: number;
  mainLoad: number;
  /** Think time between a Repeat's answer and the next press, ms [min, max]. */
  thinkMs: [number, number];
  seconds: number;
  seed: number;
}

const BASE: Omit<Scenario, "label" | "dau" | "farmers" | "handAttackers" | "raidsPerHour" | "finalisePerHour" | "infernoPerHour"> = {
  // Droplet vCPU vs a 9950X3D core at the same core count (clock, cache, steal): ~2x, band 1.5-3x.
  cpuScale: Number(process.env.CPU_SCALE ?? 2),
  dbScale: Number(process.env.DB_SCALE ?? 2),
  mainLoad: 0.5,
  // After the answer: the bar's 5 s minimum (REPEAT_BAR_MIN_MS) is mostly spent waiting on the
  // answer itself, then the result, close, next camp, the confirm sheet: 7-20 s to the next press.
  thinkMs: [7_000, 20_000],
  seconds: 3600,
  seed: 1,
};

// ---------------------------------------------------------------------------------------------

const rngOf = (seed: number) => {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
};

interface Worker {
  left: number; // CPU ms still to do (droplet ms)
  onDone: () => void;
  kind: Kind;
}

interface Waiter {
  since: number;
  nextPoll: number;
  onSlot: () => void;
  onBusy: () => void;
}

export const simulate = (sc: Scenario, fix: Fix) => {
  const rand = rngOf(sc.seed);
  const pick = (xs: number[]) => xs[Math.floor(rand() * xs.length)]!;
  const uni = (a: number, b: number) => a + rand() * (b - a);
  const expo = (mean: number) => -Math.log(1 - rand()) * mean;

  let now = 0;
  let running = 0;
  let reserved = 0;
  const workers: Worker[] = [];
  const waiters: Waiter[] = [];
  const timers: { at: number; fn: () => void }[] = [];
  const at = (delay: number, fn: () => void) => timers.push({ at: now + Math.max(1, Math.round(delay)), fn });

  const stats = {
    repeatAsked: 0,
    repeatBusy: 0,
    repeatOk: 0,
    repeatWait: [] as number[],
    repeatTotal: [] as number[],
    raidAsked: 0,
    raidBusy: 0,
    saves: 0,
    saveTotal: [] as number[],
    workerCpuMs: 0,
    busyCauses: { repeatHeld: 0, saveRunning: 0, raidHeld: 0, finaliseRunning: 0, other: 0 } as Record<string, number>,
    maxWorkers: 0,
  };
  /** Who holds the slot now, for a refusal's cause. */
  const holders: Kind[] = [];

  // FIGHT_SCALE: bigger armies/yards than the bench's (the bench's real army is 30 C14 + 2 champions).
  const fightScale = Number(process.env.FIGHT_SCALE ?? 1);
  const fightMs = (kind: Kind) => (fix.warm ? 0 : pick(STARTUP)) + fightScale * pick((fix.warm ? FIGHT_WARM : FIGHT_COLD)[kind]!);

  const startWorker = (kind: Kind, onDone: () => void) => {
    running++;
    holders.push(kind);
    const cpu = fightMs(kind) * sc.cpuScale;
    stats.workerCpuMs += cpu;
    workers.push({
      left: cpu,
      kind,
      onDone: () => {
        running--;
        holders.splice(holders.indexOf(kind), 1);
        onDone();
      },
    });
  };

  const fifoQueue: Waiter[] = [];
  const slotFree = () => running * (fix.noDoubleCount ? 0 : 1) + reserved < fix.cap || (fix.noDoubleCount && reserved < fix.cap && running < fix.cap);
  const free = () => (fix.noDoubleCount ? Math.max(running, reserved) < fix.cap : running + reserved < fix.cap);

  /** reserveReplaySlot. */
  const reserve = (kind: Kind, onSlot: (release: () => void) => void, onBusy: () => void) => {
    const release = () => {
      reserved--;
      holders.splice(holders.indexOf(kind), 1);
    };
    const take = () => {
      reserved++;
      holders.push(kind);
      onSlot(release);
    };
    if (fix.fifo) {
      if (fifoQueue.length === 0 && free()) return take();
      const w: Waiter = { since: now, nextPoll: 0, onSlot: take, onBusy };
      fifoQueue.push(w);
      return;
    }
    if (free()) return take();
    waiters.push({ since: now, nextPoll: now + 50, onSlot: take, onBusy });
  };

  const causeOf = () => {
    const c = holders[0];
    if (!c) return "other";
    return c === "repeat" ? "repeatHeld" : c === "save" ? "saveRunning" : c === "raid" ? "raidHeld" : c === "finalise" || c === "inferno" ? "finaliseRunning" : "other";
  };

  // ---- Repeat attack (one farmer's loop) ----
  const repeatOnce = (farmer: number) => {
    const asked = now;
    stats.repeatAsked++;
    at(PRE_SLOT_DB * sc.dbScale, () => {
      const slotAsked = now;
      reserve(
        "repeat",
        (release) => {
          stats.repeatWait.push(now - slotAsked);
          const land = () =>
            startWorker("repeat", () => {
              at(pick(REPEAT_LAND_DB) * sc.dbScale, () => {
                release();
                stats.repeatOk++;
                stats.repeatTotal.push(now - asked);
                at(uni(...sc.thinkMs), () => repeatOnce(farmer));
              });
            });
          if (fix.narrow) {
            // The slot as an admission check only: given back at once, so the Repeat's database
            // work blocks no one; its landing replay still counts in `running` (as a save's does).
            release();
            at(pick(REPEAT_LOAD_DB) * sc.dbScale, () =>
              startWorker("repeat", () =>
                at(pick(REPEAT_LAND_DB) * sc.dbScale, () => {
                  stats.repeatOk++;
                  stats.repeatTotal.push(now - asked);
                  at(uni(...sc.thinkMs), () => repeatOnce(farmer));
                })
              )
            );
            return;
          }
          at(pick(REPEAT_LOAD_DB) * sc.dbScale, land);
        },
        () => {
          stats.repeatBusy++;
          stats.busyCauses[causeOf()]!++;
          // The player reads "busy", closes, and tries again a bit later.
          at(uni(...sc.thinkMs), () => repeatOnce(farmer));
        }
      );
    });
  };

  // ---- hand attacks: attack 1-3 min, then the save's replay (no wait) ----
  const handLoop = () => {
    at(uni(60_000, 180_000), () => {
      const t0 = now;
      stats.saves++;
      startWorker("save", () => {
        stats.saveTotal.push(now - t0);
        at(uni(20_000, 90_000), handLoop);
      });
    });
  };

  // ---- raids: open arrivals; slot held across freeze (db) + fight + lock (db) ----
  const raidNext = () => {
    if (sc.raidsPerHour <= 0) return;
    at(expo(3_600_000 / sc.raidsPerHour), () => {
      stats.raidAsked++;
      reserve(
        "raid",
        (release) =>
          at(60 * sc.dbScale, () =>
            startWorker("raid", () => at(40 * sc.dbScale, release))
          ),
        () => stats.raidBusy++
      );
      raidNext();
    });
  };

  // ---- the minute sweep: the hour's abandoned attacks, landed one after another each minute ----
  const sweep = () => {
    at(60_000, () => {
      let n = 0;
      const perMinute = sc.finalisePerHour / 60;
      n = Math.floor(perMinute) + (rand() < perMinute % 1 ? 1 : 0);
      const one = () => {
        if (n-- <= 0) return;
        at(30 * sc.dbScale, () => startWorker("finalise", () => at(30 * sc.dbScale, one)));
      };
      one();
      sweep();
    });
  };

  // ---- Inferno landings: open arrivals, no wait ----
  const infernoNext = () => {
    if (sc.infernoPerHour <= 0) return;
    at(expo(3_600_000 / sc.infernoPerHour), () => {
      startWorker("inferno", () => {});
      infernoNext();
    });
  };

  for (let f = 0; f < sc.farmers; f++) at(uni(0, 20_000), () => repeatOnce(f));
  for (let h = 0; h < sc.handAttackers; h++) at(uni(0, 120_000), handLoop);
  raidNext();
  sweep();
  infernoNext();

  const end = sc.seconds * 1000;
  const workerCores = 2 - (fix.niced ? sc.mainLoad : sc.mainLoad * 0.8);
  for (now = 0; now < end; now++) {
    // timers due now
    if (timers.length) {
      for (let i = 0; i < timers.length; ) {
        if (timers[i]!.at <= now) {
          const t = timers[i]!;
          timers[i] = timers[timers.length - 1]!;
          timers.pop();
          t.fn();
        } else i++;
      }
    }
    // CPU for live workers
    if (workers.length) {
      stats.maxWorkers = Math.max(stats.maxWorkers, workers.length);
      const each = Math.min(1, workerCores / workers.length);
      for (let i = 0; i < workers.length; ) {
        const w = workers[i]!;
        w.left -= each;
        if (w.left <= 0) {
          workers.splice(i, 1);
          w.onDone();
        } else i++;
      }
    }
    // FIFO queue: head takes a free slot; anyone past the wait is refused
    if (fix.fifo) {
      for (let i = 0; i < fifoQueue.length; ) {
        if (now - fifoQueue[i]!.since >= fix.waitMs) {
          const [w] = fifoQueue.splice(i, 1);
          w!.onBusy();
        } else i++;
      }
      while (fifoQueue.length && free()) fifoQueue.shift()!.onSlot();
    } else if (waiters.length) {
      // poll-and-barge: each waiter checks on its own 50 ms timer
      for (let i = 0; i < waiters.length; ) {
        const w = waiters[i]!;
        if (w.nextPoll > now) {
          i++;
          continue;
        }
        if (free()) {
          waiters.splice(i, 1);
          w.onSlot();
          continue;
        }
        if (now - w.since >= fix.waitMs) {
          waiters.splice(i, 1);
          w.onBusy();
          continue;
        }
        w.nextPoll = now + 50;
        i++;
      }
    }
  }
  void slotFree;

  const q = (xs: number[], p: number) => {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]!;
  };
  return {
    repeatsAsked: stats.repeatAsked,
    repeatBusyPct: +((100 * stats.repeatBusy) / Math.max(1, stats.repeatBusy + stats.repeatOk)).toFixed(2),
    repeatBusy: stats.repeatBusy,
    repeatWaitP50: Math.round(q(stats.repeatWait, 0.5)),
    repeatWaitP95: Math.round(q(stats.repeatWait, 0.95)),
    repeatAnswerP50: Math.round(q(stats.repeatTotal, 0.5)),
    repeatAnswerP95: Math.round(q(stats.repeatTotal, 0.95)),
    raidBusyPct: +((100 * stats.raidBusy) / Math.max(1, stats.raidAsked)).toFixed(2),
    saves: stats.saves,
    saveP95: Math.round(q(stats.saveTotal, 0.95)),
    workerCoreSecondsPerHour: Math.round(stats.workerCpuMs / 1000),
    workerCpuShare: +(stats.workerCpuMs / (sc.seconds * 1000 * 2)).toFixed(3),
    maxWorkers: stats.maxWorkers,
    busyCauses: stats.busyCauses,
  };
};

export const FIXES: Record<string, Fix> = {
  today: { name: "today (cap 1, poll, 5 s)", cap: 1, waitMs: 5_000, fifo: false, warm: false, narrow: false, noDoubleCount: false, niced: false },
  a_warm: { name: "a. warm worker pool", cap: 1, waitMs: 5_000, fifo: false, warm: true, narrow: false, noDoubleCount: false, niced: false },
  b_queue20: { name: "b. FIFO queue, 20 s", cap: 1, waitMs: 20_000, fifo: true, warm: false, narrow: false, noDoubleCount: false, niced: false },
  b_queue30: { name: "b. FIFO queue, 30 s", cap: 1, waitMs: 30_000, fifo: true, warm: false, narrow: false, noDoubleCount: false, niced: false },
  c_cap2: { name: "c. cap 2, niced, no double count", cap: 2, waitMs: 5_000, fifo: false, warm: false, narrow: false, noDoubleCount: true, niced: true },
  d_narrow: { name: "d. slot only around the replay", cap: 1, waitMs: 5_000, fifo: false, warm: false, narrow: true, noDoubleCount: false, niced: false },
  combo: { name: "d + a + b(20 s)", cap: 1, waitMs: 20_000, fifo: true, warm: true, narrow: true, noDoubleCount: false, niced: false },
};

// Daily players -> the peak hour. Assumptions (replace with live numbers): at the peak ~15% of
// daily players are online; of those ~20% farm camps with Repeat and ~15% attack by hand at any
// moment. Raids: ~0.5 per online player per hour. Sweep: 10% of hand attacks are left and landed
// by the sweep. Inferno landings: 5% of online players per hour.
export const scenarioFor = (dau: number, extra: Partial<Scenario> = {}): Scenario => {
  const online = dau * 0.15;
  const handAttackers = Math.round(online * 0.15);
  return {
    ...BASE,
    label: `${dau} daily`,
    dau,
    farmers: Math.max(1, Math.round(online * 0.2)),
    handAttackers,
    raidsPerHour: Math.round(online * 0.5),
    finalisePerHour: Math.round(handAttackers * 25 * 0.1),
    infernoPerHour: Math.round(online * 0.05),
    ...extra,
  };
};

if (import.meta.main) {
  const arg = process.argv[2];
  const farmerSweep = (process.env.FARMERS ?? "").split(",").filter(Boolean).map(Number);
  const scenarios: Scenario[] = arg
    ? JSON.parse(readFileSync(arg, "utf8"))
    : farmerSweep.length
    ? farmerSweep.map((farmers) => scenarioFor(400, { label: `400-daily background, ${farmers} players farming at once`, farmers, seconds: Number(process.env.SECONDS_SIM ?? 1800) }))
    : [scenarioFor(400), scenarioFor(400, { label: "400 daily, busy evening (2x farmers)", farmers: 24 }), scenarioFor(4000), scenarioFor(40000, { seconds: 900 })];
  const fixes = (process.env.FIXES ?? Object.keys(FIXES).join(",")).split(",");
  const out: any[] = [];
  for (const sc of scenarios) {
    console.log(`\n== ${sc.label}: farmers ${sc.farmers}, hand attackers ${sc.handAttackers}, raids/h ${sc.raidsPerHour}, sweep/h ${sc.finalisePerHour}, inferno/h ${sc.infernoPerHour}, cpu x${sc.cpuScale}, db x${sc.dbScale}`);
    for (const key of fixes) {
      const r = simulate(sc, FIXES[key]!);
      out.push({ scenario: sc, fix: FIXES[key], result: r });
      console.log(
        `${FIXES[key]!.name.padEnd(36)} repeats ${String(r.repeatsAsked).padStart(6)}  busy ${String(r.repeatBusyPct).padStart(6)}%  wait p50/p95 ${r.repeatWaitP50}/${r.repeatWaitP95} ms  answer p50/p95 ${r.repeatAnswerP50}/${r.repeatAnswerP95} ms  raid busy ${r.raidBusyPct}%  battle CPU ${(r.workerCpuShare * 100).toFixed(1)}% of box  causes ${JSON.stringify(r.busyCauses)}`
      );
    }
  }
  mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
  writeFileSync(new URL(`./results/sim-${process.env.TAG ?? "default"}.json`, import.meta.url), JSON.stringify(out, null, 1));
}
