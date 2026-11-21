import pg from "../server/node_modules/pg";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync("../server/.env","utf8").split("\n").filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf("=");return [l.slice(0,i), l.slice(i+1).replace(/^["']|["']$/g,"")]}));
const c = new pg.Client({host: env.DB_HOST||"localhost", port:+(env.DB_PORT||5432), user: env.DB_USER, password: env.DB_PASSWORD, database: "b9-screens-db"});
await c.connect();
const r = await c.query(process.argv[2]);
console.log(JSON.stringify(r.rows, null, 0).slice(0, +(process.argv[3]||4000)));
await c.end();
