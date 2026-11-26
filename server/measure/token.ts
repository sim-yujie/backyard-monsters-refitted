// Mints a game login token for a user of the helper's copy and stores it in Redis slot 13,
// as login.ts does, so the load scripts need no password. Usage: bun measure/token.ts <userid>
import pg from "pg";
import JWT from "jsonwebtoken";
import { RedisClient } from "bun";
if (process.env.DB_NAME !== "battle_load_db" || !process.env.REDIS_URL?.endsWith("/13")) throw new Error("set DB_NAME=battle_load_db REDIS_URL=.../13");
const db = new pg.Client({ host: "localhost", port: 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
await db.connect();
const ids = process.argv.slice(2).map(Number);
const redis = new RedisClient(process.env.REDIS_URL);
const out: Record<string, string> = {};
for (const id of ids) {
  const { email } = (await db.query("select email from bym.user where userid = $1", [id])).rows[0];
  const token = JWT.sign({ user: { email, discordId: null, sessionType: "game" } }, process.env.SECRET_KEY!, { expiresIn: "12h" });
  await redis.set(`user-token:game:${email}`, token);
  out[id] = token;
}
console.log(JSON.stringify(out));
await db.end();
redis.close();
