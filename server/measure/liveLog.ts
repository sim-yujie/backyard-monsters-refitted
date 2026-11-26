// Reads a LOCAL copy of lines from the live server's JSON log files (server/logs/bymr-*.jsonl on
// the droplet, copied down by the lead with the grep in the report), and prints per hour (SGT):
// Repeat requests, their answer time (median/p95/max), how many took 5 s or more (a "busy"
// refusal waits 5 s: refusals answer HTTP 200, so the status cannot tell them), Repeat attacks
// that landed ("auto-attack" event), attack saves and their answer times, and raid starts.
//
//   bun measure/liveLog.ts <file.jsonl> [more files...]
//
// No database, no network.
import { readFileSync } from "node:fs";

type Row = Record<string, any>;
/** Every timed request and event kept, for the "what overlapped a slow Repeat" list. */
const spans: { start: number; end: number; what: string }[] = [];
const events: { at: number; what: string }[] = [];
const hours = new Map<string, { repeat: number[]; landed: number; saves: number[]; raids: number[]; slow: number }>();
const sgtHour = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  return d.toISOString().slice(0, 13).replace("T", " ") + ":00 SGT";
};
const slot = (h: string) => {
  let s = hours.get(h);
  if (!s) hours.set(h, (s = { repeat: [], landed: 0, saves: [], raids: [], slow: 0 }));
  return s;
};
for (const file of process.argv.slice(2)) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let r: Row;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    const p = r.properties ?? {};
    const at = r["@timestamp"] ?? r.timestamp;
    if (!at) continue;
    const s = slot(sgtHour(at));
    const endMs = new Date(at).getTime();
    if (typeof p.event === "string" && /replay|auto-attack|wild-raid|finalis|landed|descent|inferno/i.test(p.event))
      events.push({ at: endMs, what: `${p.event}${p.username ? " " + p.username : ""}${p.deadlineMs ? " deadline " + p.deadlineMs : ""}` });
    const path: string = p.path ?? p.url ?? "";
    const ms = Number(p.responseTime);
    if (p.event === "auto-attack") s.landed++;
    if (!Number.isFinite(ms)) continue;
    if (/autoattack|\/base\/save|\/raid\/(start|trojan)|inferno|descent|baiter/.test(path))
      spans.push({ start: endMs - ms, end: endMs, what: `${path.replace(/^\/api\/[^/]+\/bm/, "")} ${Math.round(ms)} ms` });
    if (path.endsWith("/worldmapv2/autoattack")) {
      s.repeat.push(ms);
      if (ms >= 5000) s.slow++;
    } else if (path.endsWith("/base/save")) s.saves.push(ms);
    else if (path.endsWith("/raid/start") || path.endsWith("/raid/trojan")) s.raids.push(ms);
  }
}
const q = (xs: number[], p: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(p * (xs.length - 1))]! : 0);
console.log("hour (SGT)            repeats  >=5s  landed  repeat ms p50/p95/max   saves  save ms p50/p95/max   raid starts");
for (const [h, s] of [...hours].sort()) {
  if (!s.repeat.length && !s.saves.length) continue;
  console.log(
    `${h}  ${String(s.repeat.length).padStart(7)} ${String(s.slow).padStart(5)} ${String(s.landed).padStart(7)}   ${q(s.repeat, 0.5).toFixed(0)}/${q(s.repeat, 0.95).toFixed(0)}/${q(s.repeat, 1).toFixed(0)}`.padEnd(70) +
      `${String(s.saves.length).padStart(6)}  ${q(s.saves, 0.5).toFixed(0)}/${q(s.saves, 0.95).toFixed(0)}/${q(s.saves, 1).toFixed(0)}`.padEnd(30) +
      `${s.raids.length}`
  );
}

// Each Repeat that took 5 s or more (likely a "busy" refusal, or a Repeat that waited almost that
// long): what else was being answered while it waited, what replay events fell in that window,
// and the second of the minute it started at (the finaliser sweep runs once a minute).
const slow = spans.filter((x) => x.what.includes("autoattack") && x.end - x.start >= 5000);
if (slow.length) console.log(`\nRepeats taking 5 s or more: ${slow.length}`);
for (const x of slow.slice(0, Number(process.env.MAX_SLOW ?? 40))) {
  const during = spans.filter((o) => o !== x && o.start < x.end && o.end > x.start).map((o) => o.what);
  const ev = events.filter((e) => e.at >= x.start - 1000 && e.at <= x.end + 1000).map((e) => e.what);
  const startedAt = new Date(x.start + 8 * 3600_000).toISOString().slice(5, 19).replace("T", " ");
  console.log(`- ${startedAt} SGT (second ${new Date(x.start).getUTCSeconds()}) ${x.what}`);
  console.log(`    overlapping: ${during.length ? during.join("; ") : "nothing logged"}`);
  if (ev.length) console.log(`    events: ${ev.join("; ")}`);
}
