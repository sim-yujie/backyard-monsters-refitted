// Drives real Repeat attacks (POST /worldmapv2/autoattack) against the helper's own server
// (port 3831, battle_load_db), one camp after another, and records each request's time and
// answer. Usage: bun measure/repeatRun.ts <token> <campsJson> <count> [gapMs] [offset]
import { readFileSync, appendFileSync } from "node:fs";
import { RULES_VERSION } from "../src/services/defences/rulesVersion.js";
if (process.env.DB_NAME !== "battle_load_db") throw new Error("set DB_NAME=battle_load_db");
const [token, campsFile, countArg, gapArg, offsetArg] = process.argv.slice(2);
const camps = (JSON.parse(readFileSync(campsFile!, "utf8")) as any[]).filter((c) => c.error === 0 && c.missing === 0);
const count = Number(countArg ?? 10), gap = Number(gapArg ?? 6500), offset = Number(offsetArg ?? 0);
const out = process.env.OUT ?? "measure/results/repeat-http.jsonl";
// TOPUP=<basesaveid>: refill that yard's housed C12/C6 before each attack (own copy only), so a
// long run does not stop at "missing".
import pg from "pg";
const topup = process.env.TOPUP ? Number(process.env.TOPUP) : null;
const db = topup ? new pg.Client({ host: "localhost", port: 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME }) : null;
await db?.connect();
for (let i = 0; i < count; i++) {
  const camp = camps[(offset + i) % camps.length];
  if (db) await db.query(`update bym.save set monsters = jsonb_set(monsters, '{housed}', '{"C12": 90, "C6": 20}'), champion = jsonb_set(champion, '{0,hp}', '40000') where basesaveid = $1 and champion->0->>'t' = '3'`, [topup]);
  const t0 = performance.now();
  const res = await fetch("http://localhost:3831/worldmapv2/autoattack", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ baseid: camp.baseid, rules: RULES_VERSION }),
  });
  const body: any = await res.json();
  const ms = performance.now() - t0;
  const row = { at: Date.now(), baseid: camp.baseid, key: camp.key, ms: +ms.toFixed(1), status: res.status, error: body.error || null, reason: body.errorDetails?.data?.reason ?? null, damage: body.damageAfter };
  appendFileSync(out, JSON.stringify(row) + "\n");
  console.log(JSON.stringify(row));
  if (i < count - 1) await Bun.sleep(gap);
}

await db?.end();
