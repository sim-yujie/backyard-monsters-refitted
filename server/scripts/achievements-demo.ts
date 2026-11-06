/**
 * Test helper for the hidden achievements (#392) and gift wishes (#391).
 * NOT shipped to players: it only edits a throwaway database copy, never `bym`.
 *
 * Run from the server folder (bun loads server/.env for the database login):
 *
 *   DB_NAME=achievements_db bun scripts/achievements-demo.ts <mode> [--user 2503] [--friend 2505] [--password X]
 *
 * Each mode puts one achievement one step short, so ONE action in the game earns it:
 *   regular      login run 29 days, last login yesterday     -> reload your own yard
 *   neighbourly  29 other yards visited today (fake ids)      -> open any other player's yard (map: View)
 *   popular      friendships added up to 80, login yesterday  -> reload your own yard (day's first load counts friends)
 *   kozu         99 Kozu attacks                              -> attack a Kozu camp and do some damage
 *   landlord     outposts stat 100, login yesterday           -> reload your own yard (shortcut: see below)
 *   friend       makes --friend a 2-day-old friend wishing for Pebbles + Goo (gift picker stars)
 *   password     sets the user's password to --password
 *   status       prints the stats, trackers and which of 23-27 are earned
 *   reset        un-earns 23-27, zeroes their stats, clears the trackers, removes the `popular` friendships
 *
 * Landlord counts outposts actually held (main row's list), so a real 100th
 * takeover needs 99 outposts; the mode instead writes the stat at 100 and lets
 * the next achievement check (the day's first own-yard load) pay it.
 */
import pg from "pg";
import { calculateBaseLevel } from "../src/services/base/calculateBaseLevel";

const DAY = 86_400;
const HIDDEN = ["23", "24", "25", "26", "27"];
const POPULAR_MARK = "2020-01-02T00:00:00Z";

const args = process.argv.slice(2);
const mode = args[0] ?? "status";
const flag = (name: string, fallback?: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const userid = Number(flag("user", "2503"));
const friendid = Number(flag("friend", "2505"));

const dbName = process.env.DB_NAME;
if (!dbName || dbName === "bym" || dbName === "bym_sound") {
  console.error("Set DB_NAME to your own throwaway copy (not bym or bym_sound).");
  process.exit(1);
}

const db = new pg.Client({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? "postgres",
  password: process.env.DB_PASSWORD,
  database: dbName,
});

interface Record {
  v: 1;
  s: { [stat: string]: number };
  c: { [id: string]: unknown };
  d?: { login?: number; streak?: number; visitDay?: number; visits?: string[] };
  [key: string]: unknown;
}

const today = Math.floor(Date.now() / 1000 / DAY);

const readRecord = async (): Promise<Record> => {
  const { rows } = await db.query(`SELECT achievements FROM bym.save WHERE userid = $1 AND type = 'main'`, [userid]);
  if (rows.length === 0) throw new Error(`user ${userid} has no main yard in ${dbName}`);
  const raw = rows[0].achievements;
  const record = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record | null;
  return record ?? { v: 1, s: {}, c: {} };
};

const writeRecord = (record: Record) =>
  db.query(`UPDATE bym.save SET achievements = $2 WHERE userid = $1 AND type = 'main'`, [userid, JSON.stringify(record)]);

const friendCount = async (who: number): Promise<number> =>
  Number((await db.query(`SELECT count(*)::int AS n FROM bym.friend WHERE userid = $1`, [who])).rows[0].n);

const makeFriends = async (a: number, b: number, since: string) => {
  await db.query(
    `INSERT INTO bym.friend (userid, friend_userid, created_at) VALUES ($1, $2, $3), ($2, $1, $3) ON CONFLICT DO NOTHING`,
    [a, b, since],
  );
  await db.query(
    `UPDATE bym."user" u SET friendcount = (SELECT count(*) FROM bym.friend f WHERE f.userid = u.userid) WHERE u.userid IN ($1, $2)`,
    [a, b],
  );
};

const loginYesterday = (record: Record, streak?: number) => {
  record.d = { ...record.d, login: today - 1, streak: streak ?? record.d?.streak ?? 1 };
};

await db.connect();
try {
  const record = await readRecord();
  record.s ??= {};
  record.c ??= {};
  switch (mode) {
    case "regular":
      loginYesterday(record, 29);
      record.s["loginstreak"] = Math.max(record.s["loginstreak"] ?? 0, 29);
      await writeRecord(record);
      console.log("Regular: 29 days in a row, last yesterday. Reload your own yard to earn it.");
      break;
    case "neighbourly":
      record.d = { ...record.d, visitDay: today, visits: Array.from({ length: 29 }, (_, i) => `demo-${i + 1}`) };
      record.s["neighbourly"] = Math.max(record.s["neighbourly"] ?? 0, 29);
      await writeRecord(record);
      console.log("Neighbourly: 29 yards visited today. Open any other player's yard to earn it (same UTC day).");
      break;
    case "popular": {
      const need = 80 - (await friendCount(userid));
      if (need > 0) {
        const { rows } = await db.query(
          `SELECT userid FROM bym."user" WHERE userid <> $1 AND userid <> $3
             AND userid NOT IN (SELECT friend_userid FROM bym.friend WHERE userid = $1)
             AND (SELECT count(*) FROM bym.friend f WHERE f.userid = bym."user".userid) < 99
           ORDER BY userid LIMIT $2`,
          [userid, need, friendid],
        );
        for (const row of rows) await makeFriends(userid, Number(row.userid), POPULAR_MARK);
      }
      loginYesterday(record);
      await writeRecord(record);
      console.log(`Popular: ${await friendCount(userid)} friends, login yesterday. Reload your own yard to earn it.`);
      break;
    }
    case "kozu":
      record.s["kozuattacks"] = Math.max(record.s["kozuattacks"] ?? 0, 99);
      await writeRecord(record);
      console.log("Kozu Hunter: 99 Kozu attacks. Attack a Kozu camp and do some damage to earn it.");
      break;
    case "landlord":
      record.s["outposts"] = Math.max(record.s["outposts"] ?? 0, 100);
      loginYesterday(record);
      await writeRecord(record);
      console.log("Landlord: outposts stat 100, login yesterday. Reload your own yard to earn it.");
      break;
    case "friend": {
      await makeFriends(userid, friendid, new Date(Date.now() - 2 * DAY * 1000).toISOString());
      await db.query(`UPDATE bym."user" SET gift_wishes = 'r2,r4' WHERE userid = $1`, [friendid]);
      // So "Send gift" is on again today.
      await db.query(`DELETE FROM bym.friend_gift WHERE from_userid = $1 AND to_userid = $2 AND gift_day = (now() AT TIME ZONE 'UTC')::date`, [
        userid,
        friendid,
      ]);
      const { rows } = await db.query(
        `SELECT u.username, s.points, s.basevalue FROM bym."user" u LEFT JOIN bym.save s ON s.basesaveid = u.save_basesaveid WHERE u.userid = $1`,
        [friendid],
      );
      const row = rows[0];
      const level = row ? calculateBaseLevel(String(row.points ?? "0"), String(row.basevalue ?? "0")) : 0;
      console.log(`Friend ${friendid} (${row?.username}, level ${level}) now wishes for Pebbles + Goo.`);
      if (level < 5) console.log("Note: gifts need level 5 on both sides; pass --friend <a level 5+ userid> to pick another.");
      break;
    }
    case "password": {
      const password = flag("password");
      if (!password) throw new Error("--password is required");
      const { default: bcrypt } = await import("bcrypt");
      await db.query(`UPDATE bym."user" SET password = $2 WHERE userid = $1`, [userid, await bcrypt.hash(password, 10)]);
      console.log(`Password set for user ${userid}.`);
      break;
    }
    case "reset": {
      for (const id of HIDDEN) delete record.c[id];
      for (const stat of ["neighbourly", "loginstreak", "friends", "kozuattacks", "outposts"]) record.s[stat] = 0;
      delete record.d;
      await writeRecord(record);
      const { rows } = await db.query(
        `DELETE FROM bym.friend WHERE (userid = $1 OR friend_userid = $1) AND created_at = $2 RETURNING userid, friend_userid`,
        [userid, POPULAR_MARK],
      );
      const others = [...new Set(rows.map((row) => Number(row.userid === userid ? row.friend_userid : row.userid)))];
      await db.query(
        `UPDATE bym."user" u SET friendcount = (SELECT count(*) FROM bym.friend f WHERE f.userid = u.userid) WHERE u.userid = ANY($1::int[])`,
        [[userid, ...others]],
      );
      console.log(`Reset 23-27 for user ${userid}; removed ${others.length} demo friendships.`);
      break;
    }
    case "status":
      break;
    default:
      throw new Error(`unknown mode ${mode}`);
  }
  const after = await readRecord();
  const pick = (keys: string[]) => Object.fromEntries(keys.map((key) => [key, after.s?.[key] ?? 0]));
  console.log("stats", pick(["neighbourly", "loginstreak", "friends", "kozuattacks", "outposts"]));
  console.log("daily", { ...after.d, visits: after.d?.visits?.length }, "today", today);
  console.log("earned", HIDDEN.filter((id) => after.c?.[id] !== undefined).join(",") || "none", "friends", await friendCount(userid));
} finally {
  await db.end();
}
