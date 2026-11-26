// Sets yardtester's tower levels in tier_build_db so every tiered tower shows tiers 1, 2 and 3.
import { SQL } from "bun";
const env = Object.fromEntries((await Bun.file(import.meta.dir + "/../server/.env").text()).split("\n").filter(l => /^[A-Z_]+=/.test(l)).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")]; }));
const sql = new SQL({ hostname: "localhost", port: 5432, username: env.DB_USER, password: env.DB_PASSWORD, database: "tier_build_db" });
const main: Record<string, number> = { 32: 1, 33: 4, 34: 7, 35: 10, 36: 2, 37: 5, 9001: 1, 9002: 4, 9003: 7, 9004: 10,
  28: 7, 29: 1, 30: 4, 31: 8, 41: 4, 42: 1, 9005: 10, 83: 1, 84: 3, 85: 5, 86: 2, 38: 1, 39: 4, 40: 7,
  48: 1, 49: 4, 50: 7, 9006: 8, 46: 1, 47: 7, 43: 1, 44: 4, 45: 7, 612: 5 };
const mainNew = { 9101: { t: 115, l: 4, X: 260, Y: 500 }, 9102: { t: 132, l: 1, X: 340, Y: 500 }, 9103: { t: 132, l: 3, X: 420, Y: 500 } };
const inferno: Record<string, number> = { 10: 1, 12: 4, 14: 7, 181: 1, 11: 1, 13: 4 };
const infernoNew = { 9201: { t: 130, l: 7, X: 280, Y: 5 } };
for (const [save, levels, extra] of [[2503, main, mainNew], [3401, inferno, infernoNew]] as const) {
  const [row] = await sql`select buildingdata from bym.save where basesaveid=${save}`;
  const data = row.buildingdata;
  for (const [id, l] of Object.entries(levels)) { if (!data[id]) throw new Error(`no ${id}`); data[id].l = l; }
  for (const [id, b] of Object.entries(extra)) data[id] = { id: Number(id), ...b };
  await sql`update bym.save set buildingdata=${data} where basesaveid=${save}`;
  console.log(save, Object.keys(levels).length, "levels set,", Object.keys(extra).length, "added");
}
await sql.close();
