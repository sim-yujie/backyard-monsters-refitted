// Times each replay job in parts: worker start-up (spawn -> "ready"), the job's own transfer,
// the fight, and the hand-back (worker's post -> main thread has the answer), as the game runs it
// (one new worker per job, terminated after), and with one worker kept warm (a pool prototype).
//
//   DB_NAME=battle_load_db REDIS_URL=redis://localhost:6379/13 bun measure/bench.ts [cold|warm|inline] [runs] [kinds]
//
// Writes measure/results/bench-<mode>-<tag>.json and prints median/p95 per kind.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { availableParallelism } from "node:os";
if (process.env.DB_NAME !== "battle_load_db") throw new Error("set DB_NAME=battle_load_db");
const mode = process.argv[2] ?? "cold";
const runs = Number(process.argv[3] ?? 30);
const kinds = (process.argv[4] ?? "repeat,save,raid,inferno").split(",");
const tag = process.env.TAG ?? "pc";
const all = JSON.parse(readFileSync(new URL("./jobs.json", import.meta.url), "utf8")) as { kind: string; label: string; job: any }[];
const jobs = all.filter((j) => kinds.includes(j.kind));
const URL_W = new URL("./benchWorker.ts", import.meta.url);
const now = () => performance.timeOrigin + performance.now();

type Row = { kind: string; label: string; startup: number; transfer: number; fight: number; handback: number; total: number; ticks?: number };

const once = (worker: Worker | null, job: any): Promise<{ row: Omit<Row, "kind" | "label">; worker: Worker }> =>
  new Promise((resolve, reject) => {
    const spawn = now();
    const w = worker ?? new Worker(URL_W);
    let ready = worker ? spawn : 0;
    let posted = 0;
    w.onmessage = (e: MessageEvent<any>) => {
      const m = e.data;
      if (m.ready) {
        ready = now();
        return;
      }
      const back = now();
      if (m.error) return reject(new Error(m.error));
      resolve({
        worker: w,
        row: {
          startup: worker ? 0 : ready - spawn,
          transfer: m.got - Math.max(posted, ready || posted),
          fight: m.fightEnd - m.fightStart,
          handback: back - m.fightEnd,
          total: back - spawn,
          ticks: m.result?.ticks ?? m.result?.tick,
        },
      });
    };
    w.onerror = (e) => reject(new Error(String(e.message)));
    posted = now();
    w.postMessage(job);
  });

const rows: Row[] = [];
if (mode === "inline") {
  const { replayAbandonedAttack } = await import("../src/services/base/combat/abandonedAttack.js");
  const { fightRaid } = await import("../src/services/raids/raidFight.js");
  for (let r = 0; r < runs; r++)
    for (const j of jobs) {
      const a = now();
      j.job.kind === "raid" ? fightRaid(j.job.input) : replayAbandonedAttack(j.job.input);
      const f = now() - a;
      rows.push({ kind: j.kind, label: j.label, startup: 0, transfer: 0, fight: f, handback: 0, total: f });
    }
} else {
  let warm: Worker | null = null;
  if (mode === "warm") {
    warm = new Worker(URL_W);
    await new Promise<void>((res) => (warm!.onmessage = (e: any) => e.data.ready && res()));
  }
  for (let r = 0; r < runs; r++)
    for (const j of jobs) {
      const { row, worker } = await once(warm, j.job);
      if (mode === "cold") {
        const t = now();
        worker.terminate();
        (row as any).terminate = now() - t;
      }
      rows.push({ kind: j.kind, label: j.label, ...row });
    }
  warm?.terminate();
}

const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] ?? NaN;
};
const summary: Record<string, any> = {};
for (const kind of [...new Set(rows.map((r) => r.kind)), "ALL"]) {
  const rs = kind === "ALL" ? rows : rows.filter((r) => r.kind === kind);
  summary[kind] = { n: rs.length };
  for (const part of ["startup", "transfer", "fight", "handback", "total"] as const) {
    const xs = rs.map((r) => r[part]);
    summary[kind][part] = { med: +q(xs, 0.5).toFixed(1), p95: +q(xs, 0.95).toFixed(1), mean: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) };
  }
}
mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
writeFileSync(new URL(`./results/bench-${mode}-${tag}.json`, import.meta.url), JSON.stringify({ mode, runs, tag, parallelism: availableParallelism(), summary, rows }, null, 1));
console.log(`mode=${mode} tag=${tag} runs=${runs} availableParallelism=${availableParallelism()}`);
for (const [kind, s] of Object.entries(summary))
  console.log(kind.padEnd(8), `n=${s.n}`, ["startup", "transfer", "fight", "handback", "total"].map((p) => `${p} ${s[p].med}/${s[p].p95}`).join("  "));
