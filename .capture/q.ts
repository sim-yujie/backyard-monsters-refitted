// Usage: bun q.ts "<sql>"  (DB tier_build_db, creds from ../server/.env)
import { SQL } from "bun";
const env = Object.fromEntries((await Bun.file(import.meta.dir + "/../server/.env").text()).split("\n").filter(l => /^[A-Z_]+=/.test(l)).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")]; }));
const sql = new SQL({ hostname: "localhost", port: Number(env.DB_PORT || 5432), username: env.DB_USER, password: env.DB_PASSWORD, database: "tier_build_db" });
const rows = await sql.unsafe(process.argv[2]);
for (const r of rows) console.log(JSON.stringify(r));
await sql.close();
