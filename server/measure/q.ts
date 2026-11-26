// Tiny read-only SQL runner for the helper's own copy (battle_load_db). Usage: bun measure/q.ts "select ..."
import pg from "pg";
if (process.env.DB_NAME !== "battle_load_db") throw new Error("set DB_NAME=battle_load_db");
const c = new pg.Client({ host: "localhost", port: 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
await c.connect();
const r = await c.query(process.argv[2]!);
console.table(r.rows);
await c.end();
