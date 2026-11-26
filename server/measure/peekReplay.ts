import pg from "pg";
import { decodeReplay } from "../src/services/defences/defenceReplayStore.js";
if (process.env.DB_NAME !== "battle_load_db") throw new Error("set DB_NAME=battle_load_db");
const c = new pg.Client({ host: "localhost", port: 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
await c.connect();
const r = await c.query("select replay from bym.defence_replay");
const p = decodeReplay(r.rows[0].replay);
console.log(Object.keys(p), p.tick, p.events.length, JSON.stringify(p.events).slice(0, 600), Object.keys(p.load), JSON.stringify(p.levels));
await c.end();
