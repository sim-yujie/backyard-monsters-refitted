// Lists the camps around a player's home whose tribe and level match one of their saved Repeat
// plans, and asks the server's plan route about each (read-only). Usage:
//   DB_NAME=battle_load_db REDIS_URL=redis://localhost:6379/13 bun measure/findCamps.ts <userid> <token> [radius]
import pg from "pg";
import { Tribes, type Tribe } from "../src/enums/Tribes.js";
import { calculateTribeLevel } from "../src/services/maproom/v2/calculateTribeLevel.js";
import { generateBaseId } from "../src/utils/generateBaseId.js";
if (process.env.DB_NAME !== "battle_load_db") throw new Error("set DB_NAME=battle_load_db");
const [uid, token, radiusArg] = process.argv.slice(2);
const radius = Number(radiusArg ?? 10);
const db = new pg.Client({ host: "localhost", port: 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
await db.connect();
const save = (await db.query("select worldid, homebase from bym.save where userid=$1 and type='main'", [uid])).rows[0];
const plans = (await db.query("select wmid, level from bym.attack_plan where userid=$1", [uid])).rows.map((r) => `${r.wmid}/${r.level}`);
await db.end();
const [hx, hy] = save.homebase.map(Number);
const found: any[] = [];
for (let x = hx - radius; x <= hx + radius; x++)
  for (let y = hy - radius; y <= hy + radius; y++) {
    const t = (x + y) % Tribes.length;
    const key = `${t * 10 + 1}/${calculateTribeLevel(x, y, Tribes[t] as Tribe)}`;
    if (!plans.includes(key)) continue;
    const baseid = generateBaseId(save.worldid, x, y);
    const res = await fetch("http://localhost:3831/worldmapv2/autoattackplan", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ baseid }),
    });
    const body: any = await res.json();
    found.push({ x, y, key, baseid, error: body.error ?? null, missing: body.missing?.length ?? null, fee: body.fee });
  }
console.log(JSON.stringify(found));
