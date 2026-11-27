/**
 * Starts or stops a Brukkarg attack event on a LOCAL test database
 * (beta 10, bruk-port), until the dashboard's generic event control
 * (`feat/wave-events`) lists them (`services/events/yards/yardEventRun.ts`).
 * Never against the shared `bym` database.
 *
 *   DB_NAME=bruk-port-db REDIS_URL=redis://localhost:6379/10 bun scripts/yardEventRun.ts start carnage [days]
 *   DB_NAME=bruk-port-db REDIS_URL=redis://localhost:6379/10 bun scripts/yardEventRun.ts stop
 *
 * A running server reads the change within a minute (`REFRESH_MS`).
 */
import { SQL } from "bun";

import { readYardRuns, startYardRun, stopYardRun, SETTING_KEY, isYardEventKey } from "../src/services/events/yards/yardEventRun.js";

const dbName = process.env.DB_NAME;
if (!dbName || dbName === "bym") {
  console.error("Set DB_NAME to your own test database (never bym).");
  process.exit(2);
}
const db = new SQL({
  hostname: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER ?? "postgres",
  password: process.env.DB_PASSWORD ?? "",
  database: dbName,
});

const [action, key, days] = process.argv.slice(2);
const now = Math.floor(Date.now() / 1000);
const [row] = await db`SELECT value FROM bym.game_setting WHERE key = ${SETTING_KEY}`;
const runs = row ? readYardRuns(row.value) : [];

let next = null;
if (action === "start" && isYardEventKey(key)) next = startYardRun(runs, key, now, days ? Number(days) : undefined);
else if (action === "stop") next = stopYardRun(runs, now);
else {
  console.error("Usage: start carnage|brukwar [days] | stop");
  process.exit(2);
}
if (!next) {
  console.error(action === "start" ? "An event is already on: stop it first." : "No event is on.");
  process.exit(1);
}
await db`INSERT INTO bym.game_setting (key, value, updated_at) VALUES (${SETTING_KEY}, ${JSON.stringify({ runs: next })}::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
console.log(JSON.stringify(next.at(-1)));
await db.close();
