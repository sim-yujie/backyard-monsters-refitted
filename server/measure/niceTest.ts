// Fix (c) check: with the process pinned to 2 cores (taskset), does a battle worker at nice +10
// leave the main thread (where every HTTP request runs) its speed while 2 battles run?
// The main thread does a "request" of fixed CPU work (a yard-sized JSON parse + stringify, as a
// yard save or getarea does) 50 times a second and records each one's latency.
//
//   taskset -c 0,2 bun measure/niceTest.ts <workers 0|1|2> <nice 0|10|19>
import { readFileSync } from "node:fs";
if (process.env.DB_NAME !== "battle_load_db") throw new Error("set DB_NAME=battle_load_db");
const nWorkers = Number(process.argv[2] ?? 2);
const nice = Number(process.argv[3] ?? 0);
const jobs = (JSON.parse(readFileSync(new URL("./jobs.json", import.meta.url), "utf8")) as any[]).filter((j) => j.kind === "save");
const yard = JSON.stringify(jobs[0].job.input.defender); // ~ a 590-building yard
const seconds = Number(process.env.SECONDS_RUN ?? 15);
const fights: number[] = [];
const workers: Worker[] = [];
let stop = false;
const info: any[] = [];
for (let i = 0; i < nWorkers; i++) {
  const w = new Worker(new URL("./niceWorker.ts", import.meta.url), { env: { ...process.env, NICE: String(nice) } } as any);
  workers.push(w);
  let k = i;
  w.onmessage = (e: MessageEvent<any>) => {
    if (e.data.ready) info.push(e.data);
    if (e.data.done) fights.push(e.data.ms);
    if (stop) return;
    w.postMessage(jobs[k++ % jobs.length].job);
  };
}
await Bun.sleep(1000);
const lat: number[] = [];
const work = () => {
  const t = performance.now();
  for (let r = 0; r < Number(process.env.WORK_REPS ?? 3); r++) JSON.stringify(JSON.parse(yard));
  return performance.now() - t;
};
const solo = Array.from({ length: 20 }, work).sort((a, b) => a - b)[10]!;
const t0 = performance.now();
while (performance.now() - t0 < seconds * 1000) {
  const due = performance.now();
  await Bun.sleep(20);
  const start = performance.now();
  work();
  lat.push(performance.now() - due - 20); // queueing + work, minus the planned gap
}
stop = true;
for (const w of workers) w.terminate();
const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor(p * (xs.length - 1))]!;
console.log(JSON.stringify({ workers: nWorkers, nice, info, requestWorkMs: +solo.toFixed(2), latencyP50: +q(lat, 0.5).toFixed(2), latencyP95: +q(lat, 0.95).toFixed(2), latencyP99: +q(lat, 0.99).toFixed(2), fights: fights.length, fightP50: fights.length ? +q(fights, 0.5).toFixed(1) : null }));
