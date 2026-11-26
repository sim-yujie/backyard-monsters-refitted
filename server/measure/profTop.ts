// Top functions by self time in a .cpuprofile (Chrome format), grouped by function and file.
import { readFileSync } from "node:fs";
const prof = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const byId = new Map<number, any>(prof.nodes.map((n: any) => [n.id, n]));
const self = new Map<number, number>();
const dt: number[] = prof.timeDeltas;
prof.samples.forEach((id: number, i: number) => self.set(id, (self.get(id) ?? 0) + (dt[i] ?? 0)));
const total = [...self.values()].reduce((a, b) => a + b, 0);
const agg = new Map<string, number>();
for (const [id, t] of self) {
  const cf = byId.get(id).callFrame;
  const key = `${cf.functionName || "(anon)"}  ${String(cf.url).replace(/.*\/server\//, "")}:${cf.lineNumber + 1}`;
  agg.set(key, (agg.get(key) ?? 0) + t);
}
const fileAgg = new Map<string, number>();
for (const [id, t] of self) {
  const f = String(byId.get(id).callFrame.url).replace(/.*\/server\//, "") || "(native/gc)";
  fileAgg.set(f, (fileAgg.get(f) ?? 0) + t);
}
console.log("top functions (self time %)");
for (const [k, t] of [...agg].sort((a, b) => b[1] - a[1]).slice(0, Number(process.argv[3] ?? 25))) console.log(((100 * t) / total).toFixed(1).padStart(5), k);
console.log("\ntop files");
for (const [k, t] of [...fileAgg].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(((100 * t) / total).toFixed(1).padStart(5), k);
