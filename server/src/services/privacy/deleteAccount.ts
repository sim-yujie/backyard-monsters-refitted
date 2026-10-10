import type { EntityManager } from "@mikro-orm/postgresql";

import { BaseType } from "../../enums/Base.js";
import { EnumYardType } from "../../enums/EnumYardType.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";
import { AllianceRole } from "../../enums/Alliance.js";
import { Save } from "../../database/models/save.model.js";
import { WorldMapCell } from "../../database/models/worldmapcell.model.js";
import { getDefenderCoords } from "../maproom/v3/getDefenderCoords.js";
import {
  allianceSightKey,
  attackLogCachePattern,
  BOT_CHECK_LOG_KEY,
  CHAT_HISTORY_PATTERN,
  CHAT_IGNORE_PATTERN,
  LEADERBOARD_PATTERN,
  playerKeyPatterns,
  playerKeys,
  saveKeys,
} from "./accountRedisKeys.js";

/**
 * Deletes one player's account for good, on request (the Privacy Policy,
 * section 5; `scripts/delete-account.ts`).
 *
 * Gone: the login and email, every save (main yard, outposts, inferno), the
 * player's Map Room land, all mail threads they are in (both sides, since
 * the other side can no longer answer), truces, alliance chat and invites,
 * notifications, attack plans, neighbour lists, the anti-cheat report and
 * every Redis key of theirs, including login sessions, so they are logged out.
 * Their lines are taken out of world chat history and the fair-play log.
 *
 * Kept, without their name: other players' battle records show
 * {@link DELETED_PLAYER_NAME} in their place, and so does a base's "last
 * attacked by". Kept as they are: chat reports, which hold a user id but no
 * name and go with the daily clean-up after `CHAT_REPORT_RETENTION_DAYS`.
 *
 * An alliance they lead passes to another member (the longest-standing by
 * user id); one they are alone in is disbanded.
 *
 * Every database change runs in one transaction; the Redis clean-up runs
 * after it commits. A chat connection already open stays open until it drops,
 * but nothing it sends can reach an account that no longer exists.
 */

/** What other players see in place of a deleted player's name. */
export const DELETED_PLAYER_NAME = "Deleted player";

/** The part of Bun's `RedisClient` this needs: raw commands. */
export interface CommandRedis {
  send(command: string, args: string[]): Promise<unknown>;
}

/** The account to delete. */
export interface AccountRow {
  userid: number;
  username: string;
  email: string;
  alliance_id: number | null;
  alliance_role: string | null;
}

/** What deleting an account removes or changes: rows per step, then Redis. */
export interface DeletionPlan {
  account: AccountRow;
  /** Rows per step, in the order they run, e.g. `"mail messages": 12`. */
  rows: Record<string, number>;
  /** What happens to their alliance, in words; null when they have none. */
  alliance: string | null;
  redis: {
    /** Keys that exist and would be deleted. */
    keys: string[];
    /** Their lines in world chat history. */
    chatLines: number;
    /** Their rows in the fair-play log. */
    botCheckRows: number;
    /** Other players' chat ignore lists that name them. */
    ignoreLists: number;
  };
}

type Sql = <R = Record<string, unknown>>(query: string, params?: unknown[]) => Promise<R[]>;

const sqlOf =
  (em: EntityManager): Sql =>
  (query, params = []) =>
    em.execute(query, params);

/** The thrown error when an account cannot be found or must not be deleted here. */
export class AccountDeletionRefused extends Error {}

/**
 * Finds the account to delete. `id:123` and `name:Bob` say which is meant;
 * anything else is tried as both, and refused if it names two accounts.
 *
 * @param {string} who - A user id or username, as typed.
 * @returns {Promise<AccountRow>} The account.
 * @throws {AccountDeletionRefused} When there is none, two match, or it is a bot.
 */
export const findAccount = async (em: EntityManager, who: string): Promise<AccountRow> => {
  const sql = sqlOf(em.fork());
  const text = who.trim();
  const columns = `userid, username, email, alliance_id, alliance_role`;

  const byId = async (raw: string) =>
    /^\d+$/.test(raw) ? sql<AccountRow>(`SELECT ${columns} FROM bym."user" WHERE userid = ?`, [Number(raw)]) : [];
  const byName = (raw: string) =>
    sql<AccountRow>(`SELECT ${columns} FROM bym."user" WHERE lower(username) = lower(?)`, [raw]);

  let found: AccountRow[];
  if (text.startsWith("id:")) found = await byId(text.slice(3));
  else if (text.startsWith("name:")) found = await byName(text.slice(5));
  else {
    const [ids, names] = await Promise.all([byId(text), byName(text)]);
    const unique = new Map([...ids, ...names].map((row) => [Number(row.userid), row]));
    found = [...unique.values()];
    if (found.length > 1) {
      throw new AccountDeletionRefused(
        `"${text}" is both user id ${ids[0]!.userid} and the username of user id ${names[0]!.userid}: say id:${text} or name:${text}`
      );
    }
  }

  const account = found[0];
  if (!account) throw new AccountDeletionRefused(`No account matches "${text}"`);

  const [bot] = await sql(`SELECT 1 FROM bym.bot WHERE userid = ?`, [account.userid]);
  if (bot) throw new AccountDeletionRefused(`User id ${account.userid} is a bot: use src/scripts/bots.ts instead`);

  return { ...account, userid: Number(account.userid), alliance_id: account.alliance_id === null ? null : Number(account.alliance_id) };
};

/** One table's rows that go, as a WHERE clause on it. */
interface DeleteStep {
  label: string;
  table: string;
  where: string;
  params: unknown[];
}

/** Rows in other players' data that are changed, not deleted. */
interface UpdateStep {
  label: string;
  table: string;
  set: string;
  setParams: unknown[];
  where: string;
  params: unknown[];
}

const deleteSteps = (u: number): DeleteStep[] => [
  {
    label: "mail messages",
    table: "message",
    where: `userid = ? OR targetid = ? OR threadid IN (SELECT threadid FROM bym.thread WHERE userid = ? OR targetid = ?)`,
    params: [u, u, u, u],
  },
  { label: "mail threads", table: "thread", where: `userid = ? OR targetid = ?`, params: [u, u] },
  { label: "truces", table: "truce", where: `initiator_userid = ? OR recipient_userid = ?`, params: [u, u] },
  { label: "alliance chat messages", table: "alliance_message", where: `user_id = ?`, params: [u] },
  { label: "alliance invites", table: "alliance_invite", where: `user_id = ?`, params: [u] },
  { label: "notifications", table: "notification", where: `userid = ?`, params: [u] },
  { label: "attack plans", table: "attack_plan", where: `userid = ?`, params: [u] },
  { label: "Map Room 1 neighbour lists", table: "maproom", where: `userid = ?`, params: [u] },
  { label: "inferno neighbour lists", table: "maproom_inferno", where: `userid = ?`, params: [u] },
  { label: "anti-cheat report", table: "report", where: `userid = ?`, params: [u] },
  { label: "bot jobs aimed at them", table: "bot_job", where: `target_userid = ?`, params: [u] },
  { label: "map cells (home and outposts)", table: "world_map_cell", where: `uid = ?`, params: [u] },
  { label: "account (login and email)", table: `"user"`, where: `userid = ?`, params: [u] },
  { label: "saves (yards, outposts, inferno)", table: "save", where: `userid = ?`, params: [u] },
];

const updateSteps = (u: number, username: string): UpdateStep[] => [
  {
    label: "battle records where they attacked (name replaced)",
    table: "attack_logs",
    set: `attacker_username = ?, attacker_pic_square = NULL`,
    setParams: [DELETED_PLAYER_NAME],
    where: `attacker_userid = ?`,
    params: [u],
  },
  {
    label: "battle records where they defended (name replaced)",
    table: "attack_logs",
    set: `defender_username = ?, defender_pic_square = NULL`,
    setParams: [DELETED_PLAYER_NAME],
    where: `defender_userid = ?`,
    params: [u],
  },
  {
    label: `other bases last attacked by them (name replaced)`,
    table: "save",
    set: `lastattackername = ?`,
    setParams: [DELETED_PLAYER_NAME],
    where: `lastattackername = ? AND userid <> ?`,
    params: [username, u],
  },
  {
    label: "other players' block lists (id removed)",
    table: `"user"`,
    set: `blocked_users = (SELECT coalesce(jsonb_agg(e), '[]'::jsonb) FROM jsonb_array_elements(blocked_users) e WHERE e <> to_jsonb(?::int))`,
    setParams: [u],
    where: `userid <> ? AND blocked_users @> jsonb_build_array(?::int)`,
    params: [u, u],
  },
];

const count = async (sql: Sql, table: string, where: string, params: unknown[]) => {
  const [row] = await sql<{ n: number }>(`SELECT count(*)::int AS n FROM bym.${table} WHERE ${where}`, params);
  return Number(row?.n ?? 0);
};

/** The account's main save's world, if it is in one. */
const mainWorld = async (sql: Sql, u: number): Promise<string | null> => {
  const [row] = await sql<{ worldid: string | null }>(
    `SELECT worldid FROM bym.save WHERE userid = ? AND type = ? LIMIT 1`,
    [u, BaseType.MAIN]
  );
  return row?.worldid ?? null;
};

/**
 * Map Room 3 fortifications other players captured around the account's home
 * cell: they go with it, as when a player leaves a world
 * (`services/maproom/v2/leaveWorld.ts`).
 */
const capturedDefenders = async (tx: EntityManager, u: number, worldid: string | null) => {
  if (!worldid) return { cells: 0, baseids: [] as string[], ownerUids: [] as number[], coords: [] as [number, number][] };

  const homeCell = await tx.findOne(WorldMapCell, {
    uid: u,
    world: worldid,
    map_version: MapRoomVersion.V3,
    base_type: EnumYardType.PLAYER,
  });
  if (!homeCell) return { cells: 0, baseids: [], ownerUids: [], coords: [] };

  const coords = getDefenderCoords(homeCell.x, homeCell.y);
  const atDefenderSpots = { $or: coords.map(([x, y]) => ({ x, y })) };
  const fortifications = await tx.find(WorldMapCell, {
    $and: [atDefenderSpots, { world: worldid }, { map_version: MapRoomVersion.V3 }, { base_type: EnumYardType.FORTIFICATION }],
  });
  const foreign = fortifications.filter((cell) => cell.uid !== u && cell.uid > 0);
  return {
    cells: fortifications.length,
    baseids: foreign.map((cell) => cell.baseid),
    ownerUids: [...new Set(foreign.map((cell) => cell.uid))],
    coords,
  };
};

/** What happens to the account's alliance, and the member who takes over a led one. */
const allianceOutcome = async (sql: Sql, account: AccountRow) => {
  if (account.alliance_id === null) return { text: null, disband: false, successor: null as { userid: number; username: string } | null };

  const [alliance] = await sql<{ name: string }>(`SELECT name FROM bym.alliance WHERE id = ?`, [account.alliance_id]);
  const name = alliance?.name ?? `#${account.alliance_id}`;
  const [next] = await sql<{ userid: number; username: string }>(
    `SELECT userid, username FROM bym."user" WHERE alliance_id = ? AND userid <> ? ORDER BY userid LIMIT 1`,
    [account.alliance_id, account.userid]
  );

  if (!next) return { text: `alliance "${name}" is disbanded (no other members)`, disband: true, successor: null };
  if (account.alliance_role === AllianceRole.LEADER) {
    const successor = { userid: Number(next.userid), username: next.username };
    return { text: `leadership of "${name}" passes to ${successor.username} (#${successor.userid})`, disband: false, successor };
  }
  return { text: `leaves alliance "${name}"`, disband: false, successor: null };
};

/** Every key matching a pattern, by SCAN. */
const scanKeys = async (redis: CommandRedis, pattern: string): Promise<string[]> => {
  const keys = new Set<string>();
  let cursor = "0";
  do {
    const [next, batch] = (await redis.send("SCAN", [cursor, "MATCH", pattern, "COUNT", "500"])) as [string, string[]];
    for (const key of batch) keys.add(key);
    cursor = String(next);
  } while (cursor !== "0");
  return [...keys];
};

const listEntries = async (redis: CommandRedis, key: string) => (await redis.send("LRANGE", [key, "0", "-1"])) as string[];

/** Raw list entries whose JSON `field` is the account's id. */
const entriesFor = (entries: string[], field: string, u: number) =>
  entries.filter((raw) => {
    try {
      return Number((JSON.parse(raw) as Record<string, unknown>)[field]) === u;
    } catch {
      return false;
    }
  });

/** The Redis side: what exists for the account now. */
const redisFootprint = async (redis: CommandRedis, account: AccountRow, basesaveids: number[], others: number[]) => {
  const exact = [
    ...playerKeys(account.userid, account.email),
    ...basesaveids.flatMap(saveKeys),
    ...(account.alliance_id !== null ? [allianceSightKey(account.alliance_id)] : []),
    // Players they fought: their battle log cache shows the name, and their sight reveals the bases.
    ...others.map((other) => `sight:${other}`),
  ];
  const existing: string[] = [];
  for (const key of exact) if (Number(await redis.send("EXISTS", [key])) > 0) existing.push(key);

  const patterns = [...playerKeyPatterns(account.userid), ...others.map(attackLogCachePattern), LEADERBOARD_PATTERN];
  for (const pattern of patterns) existing.push(...(await scanKeys(redis, pattern)));

  const chat: { key: string; lines: string[] }[] = [];
  for (const key of await scanKeys(redis, CHAT_HISTORY_PATTERN)) {
    const lines = entriesFor(await listEntries(redis, key), "userId", account.userid);
    if (lines.length) chat.push({ key, lines });
  }

  const botCheckRows = entriesFor(await listEntries(redis, BOT_CHECK_LOG_KEY), "userid", account.userid);

  const ignoreLists: string[] = [];
  for (const key of await scanKeys(redis, CHAT_IGNORE_PATTERN)) {
    if (key === `chat-ignore:${account.userid}`) continue;
    if (Number(await redis.send("SISMEMBER", [key, String(account.userid)])) === 1) ignoreLists.push(key);
  }

  return { keys: [...new Set(existing)], chat, botCheckRows, ignoreLists };
};

/** The other players in the account's battle records. */
const opponents = async (sql: Sql, u: number): Promise<number[]> => {
  const rows = await sql<{ other: number }>(
    `SELECT DISTINCT CASE WHEN attacker_userid = ? THEN defender_userid ELSE attacker_userid END AS other
       FROM bym.attack_logs WHERE attacker_userid = ? OR defender_userid = ?`,
    [u, u, u]
  );
  return rows.map((row) => Number(row.other)).filter((other) => other > 0 && other !== u);
};

const saveIds = async (sql: Sql, u: number): Promise<number[]> =>
  (await sql<{ basesaveid: number }>(`SELECT basesaveid FROM bym.save WHERE userid = ?`, [u])).map((row) =>
    Number(row.basesaveid)
  );

/**
 * Lists what deleting the account would remove and change, touching nothing
 * (the script's `--dry-run`).
 *
 * @returns {Promise<DeletionPlan>} The plan.
 */
export const planAccountDeletion = async (
  em: EntityManager,
  redis: CommandRedis,
  account: AccountRow
): Promise<DeletionPlan> => {
  const tx = em.fork();
  const sql = sqlOf(tx);
  const u = account.userid;
  const rows: Record<string, number> = {};

  const alliance = await allianceOutcome(sql, account);
  const worldid = await mainWorld(sql, u);
  const defenders = await capturedDefenders(tx, u, worldid);
  if (defenders.cells) rows["captured Map Room 3 defender cells"] = defenders.cells;

  for (const step of deleteSteps(u)) rows[step.label] = await count(sql, step.table, step.where, step.params);
  if (defenders.baseids.length) rows["saves of captured defenders (other players')"] = defenders.baseids.length;
  for (const step of updateSteps(u, account.username)) rows[step.label] = await count(sql, step.table, step.where, step.params);

  const footprint = await redisFootprint(redis, account, await saveIds(sql, u), await opponents(sql, u));
  return {
    account,
    rows,
    alliance: alliance.text,
    redis: {
      keys: footprint.keys,
      chatLines: footprint.chat.reduce((sum, { lines }) => sum + lines.length, 0),
      botCheckRows: footprint.botCheckRows.length,
      ignoreLists: footprint.ignoreLists.length,
    },
  };
};

/**
 * Deletes the account: the database in one transaction, then Redis.
 *
 * @returns {Promise<DeletionPlan>} What was removed and changed, counted as it ran.
 */
export const deleteAccount = async (
  em: EntityManager,
  redis: CommandRedis,
  account: AccountRow
): Promise<DeletionPlan> => {
  const u = account.userid;
  const rows: Record<string, number> = {};

  // Read before the rows they come from go.
  const before = sqlOf(em.fork());
  const basesaveids = await saveIds(before, u);
  const others = await opponents(before, u);

  const allianceText = await em.fork().transactional(async (tx) => {
    const sql = sqlOf(tx);
    const alliance = await allianceOutcome(sql, account);

    if (account.alliance_id !== null) {
      if (alliance.disband) {
        // Cascades to its invites, powerups, relationships and chat.
        await sql(`DELETE FROM bym.alliance WHERE id = ?`, [account.alliance_id]);
      } else if (alliance.successor) {
        await sql(`UPDATE bym."user" SET alliance_role = ? WHERE userid = ?`, [AllianceRole.LEADER, alliance.successor.userid]);
        await sql(`UPDATE bym.alliance SET leader_userid = ?, leader_name = ? WHERE id = ?`, [
          alliance.successor.userid,
          alliance.successor.username,
          account.alliance_id,
        ]);
      }
    }

    const worldid = await mainWorld(sql, u);
    if (worldid) await sql(`UPDATE bym.world SET player_count = GREATEST(player_count - 1, 0) WHERE uuid = ?`, [worldid]);

    const defenders = await capturedDefenders(tx, u, worldid);
    if (defenders.baseids.length) {
      for (const owner of defenders.ownerUids) {
        const ownerSave = await tx.findOne(Save, { userid: owner, type: BaseType.MAIN });
        if (!ownerSave) continue;
        ownerSave.outposts = ownerSave.outposts.filter((outpost) => !defenders.baseids.includes(outpost[2]));
        tx.persist(ownerSave);
      }
      await tx.flush();
      rows["saves of captured defenders (other players')"] = await tx.nativeDelete(Save, {
        baseid: { $in: defenders.baseids },
      });
    }
    if (defenders.coords.length) {
      rows["captured Map Room 3 defender cells"] = await tx.nativeDelete(WorldMapCell, {
        $and: [
          { $or: defenders.coords.map(([x, y]) => ({ x, y })) },
          { world: worldid! },
          { map_version: MapRoomVersion.V3 },
          { base_type: EnumYardType.FORTIFICATION },
        ],
      });
    }

    for (const step of deleteSteps(u)) {
      const gone = await sql(`DELETE FROM bym.${step.table} WHERE ${step.where} RETURNING 1`, step.params);
      rows[step.label] = gone.length;
    }
    for (const step of updateSteps(u, account.username)) {
      const changed = await sql(
        `UPDATE bym.${step.table} SET ${step.set} WHERE ${step.where} RETURNING 1`,
        [...step.setParams, ...step.params]
      );
      rows[step.label] = changed.length;
    }

    return alliance.text;
  });

  // Redis, once the database has let go of the account.
  const footprint = await redisFootprint(redis, account, basesaveids, others);
  if (footprint.keys.length) await redis.send("DEL", footprint.keys);
  for (const { key, lines } of footprint.chat) {
    for (const line of new Set(lines)) await redis.send("LREM", [key, "0", line]);
  }
  for (const row of new Set(footprint.botCheckRows)) await redis.send("LREM", [BOT_CHECK_LOG_KEY, "0", row]);
  for (const key of footprint.ignoreLists) await redis.send("SREM", [key, String(u)]);

  return {
    account,
    rows,
    alliance: allianceText,
    redis: {
      keys: footprint.keys,
      chatLines: footprint.chat.reduce((sum, { lines }) => sum + lines.length, 0),
      botCheckRows: footprint.botCheckRows.length,
      ignoreLists: footprint.ignoreLists.length,
    },
  };
};
