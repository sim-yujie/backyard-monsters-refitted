// Summarises a Repeat run: HTTP answers (repeatRun.ts) and the server's BLMEASURE marks.
import { readFileSync } from "node:fs";
const [httpFile, marksFile] = process.argv.slice(2);
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]! : NaN; };
const f = (xs: number[]) => `n=${xs.length} med ${q(xs, 0.5).toFixed(0)} p95 ${q(xs, 0.95).toFixed(0)} max ${Math.max(...xs).toFixed(0)}`;
const http = readFileSync(httpFile!, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const g: Record<string, number[]> = {};
for (const r of http) (g[r.reason ?? "ok"] ??= []).push(r.ms);
for (const [k, xs] of Object.entries(g)) console.log("http", k.padEnd(15), f(xs));
const rows = readFileSync(marksFile!, "utf8").trim().split("\n").map((l) => JSON.parse(l));
console.log("slot held (all)  ", f(rows.filter((r) => r.ev === "slot-held").map((r) => r.held)));
const rep = rows.filter((r) => r.ev === "replay");
for (const k of ["startup", "afterReady", "total"]) console.log("replay", k.padEnd(11), f(rep.map((r) => r[k])));
const m = rows.filter((r) => r.ev === "repeat-marks");
console.log("landed repeats", m.length);
console.log("  hold total      ", f(m.map((r) => r.keepReplay)));
console.log("  attack load+ckpt", f(m.map((r) => r.attackLoadAndCheckpoint - r.planCheck)));
console.log("  landing         ", f(m.map((r) => r.landing - r.attackLoadAndCheckpoint)));
console.log("  keepReplay      ", f(m.map((r) => r.keepReplay - r.landing)));
