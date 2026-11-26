// Runs the same mixed stream of real jobs (measure/jobs.json) through (1) today's one-worker-a-job
// runner shape and (2) the prototype pool, at a fixed arrival rate, on whatever cores taskset
// gives, and prints answer times. Shows fix a (and c with REPLAY_NICE) on real code.
//
//   DB_NAME=battle_load_db REDIS_URL=redis://localhost:6379/13 taskset -c 0,2 bun measure/proto/poolTest.ts <fresh|pool> <jobsPerSecond> <seconds> [size] [nice]
import { readFileSync, appendFileSync } from "node:fs";
import { ReplayPool } from "./replayPool.js";
if (process.env.DB_NAME !== "battle_load_db") throw new Error("set DB_NAME=battle_load_db");
const [mode = "pool", rateArg = "4", secondsArg = "30", sizeArg = "1", niceArg = "0"] = process.argv.slice(2);
const jobs = JSON.parse(readFileSync(new URL("../jobs.json", import.meta.url), "utf8")) as any[];
const rate = Number(rateArg), seconds = Number(secondsArg), size = Number(sizeArg), nice = Number(niceArg);
const W = new URL("./poolWorker.ts", import.meta.url);
const fresh = (job: any) =>
  new Promise<void>((resolve, reject) => {
    const w = new Worker(W, { env: { ...process.env, REPLAY_NICE: String(nice) } } as any);
    w.onmessage = (e: MessageEvent<any>) => {
      if (e.data?.ready) return;
      w.terminate();
      e.data.ok ? resolve() : reject(new Error(e.data.error));
    };
    w.postMessage({ id: 1, job });
  });
const pool = mode === "pool" ? new ReplayPool({ size, nice, maxJobs: 500, workerUrl: W }) : null;
await Bun.sleep(500);
const times: number[] = [];
let inFlight = 0, maxInFlight = 0, k = 0;
const start = performance.now();
const all: Promise<void>[] = [];
// The main thread's own "request" latency while this runs (a small fixed job every 20 ms).
const lat: number[] = [];
let stop = false;
const probe = (async () => {
  while (!stop) {
    const due = performance.now();
    await Bun.sleep(20);
    lat.push(performance.now() - due - 20);
  }
})();
while (performance.now() - start < seconds * 1000) {
  const job = jobs[k++ % jobs.length].job;
  const t = performance.now();
  inFlight++;
  maxInFlight = Math.max(maxInFlight, inFlight);
  const p = (pool ? pool.run(job, 20_000, null) : fresh(job)).then(() => {
    times.push(performance.now() - t);
    inFlight--;
  });
  all.push(p as Promise<void>);
  await Bun.sleep(-Math.log(1 - Math.random()) * (1000 / rate));
}
await Promise.all(all);
stop = true;
await probe;
pool?.close();
const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor(p * (xs.length - 1))]!;
const row = { mode, rate, seconds, size, nice, jobs: times.length, answerP50: Math.round(q(times, 0.5)), answerP95: Math.round(q(times, 0.95)), answerMax: Math.round(Math.max(...times)), maxInFlight, mainLagP95: +q(lat, 0.95).toFixed(1), mainLagP99: +q(lat, 0.99).toFixed(1), spawned: pool?.spawned ?? times.length };
console.log(JSON.stringify(row));
appendFileSync(new URL("../results/pool-test.jsonl", import.meta.url), JSON.stringify(row) + "\n");
