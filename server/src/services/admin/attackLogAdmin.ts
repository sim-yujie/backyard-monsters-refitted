import type { EntityManager } from "@mikro-orm/postgresql";

import { retentionConfig } from "../../config/RetentionConfig.js";

/**
 * The dashboard's Attack log (owner, 8 Nov 2026: "a tool to check a player's
 * attack/attacked log"): every attack one player made and every attack made
 * on them, newest first, with who they attack most and who attacks them
 * most, to look into bullying, farming the same player, or cheating.
 *
 * Read-only. Every query names the player's side of the attack
 * (`attacker_userid` or `defender_userid`) and a time range, so it stays on
 * the two `attack_logs` indexes, (attacker_userid, attacktime) and
 * (defender_userid, attacktime); nothing reads the whole table. "Both" is the
 * two index reads joined, never an OR.
 *
 * A row is written when an attack starts (`services/base/createAttackLog.ts`),
 * on a player's main yard, outpost or Inferno yard; attacks on wild monster
 * yards are not logged. Rows older than `ATTACK_LOG_RETENTION_DAYS` are
 * deleted each day (`services/privacy/retention.ts`).
 */

export type AttackSide = "made" | "received" | "both";
export type AttackRange = "24h" | "7d" | "30d" | "all";

export const ATTACK_SIDES: readonly AttackSide[] = ["made", "received", "both"];
export const ATTACK_RANGES: readonly AttackRange[] = ["24h", "7d", "30d", "all"];

/** Rows per page unless the page asks for fewer; never more than {@link MAX_ATTACK_PAGE}. */
export const ATTACK_PAGE = 50;
export const MAX_ATTACK_PAGE = 100;
/** Players in each "most attacked" list. */
export const TOP_PLAYERS = 5;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const RANGE_MS: Record<Exclude<AttackRange, "all">, number> = { "24h": DAY_MS, "7d": 7 * DAY_MS, "30d": 30 * DAY_MS };

export interface AttackLogQuery {
  userid: number;
  side: AttackSide;
  range: AttackRange;
  limit: number;
  /** The previous page's last row (its time to the microsecond, as `next` gave it): only rows older than it. */
  before: { time: string; id: number } | null;
}

/** One player as the page shows them: the name they have now, and whether the computer runs them. */
export interface AttackPlayer {
  userid: number;
  /** Their name now; the name in the log when the account is gone. */
  username: string;
  /** A computer-run Map Room neighbour (`bym.bot`, not seeded dev players). */
  bot: boolean;
  /** The account no longer exists. */
  gone: boolean;
}

export interface AttackRow {
  id: number;
  time: string;
  /** "made": the player attacked `other`; "received": `other` attacked the player. */
  direction: "made" | "received";
  other: AttackPlayer;
  /** The other player's name in the log, when it differs from their name now. */
  otherLoggedName: string | null;
  /** The yard attacked: `main`, `outpost`, `inferno`... as stored. */
  type: string;
  x: number | null;
  y: number | null;
  loot: unknown;
  report: unknown;
}

export interface TopPlayer extends AttackPlayer {
  count: number;
}

export interface AttackSummary {
  /** Attacks the player made in the range. */
  made: number;
  /** Attacks made on the player in the range. */
  received: number;
  /** Different players they attacked, and who attacked them. */
  targets: number;
  attackers: number;
  /** Who they attacked most. */
  topTargets: TopPlayer[];
  /** Who attacked them most. */
  topAttackers: TopPlayer[];
}

export interface AttackLogView {
  player: AttackPlayer;
  side: AttackSide;
  range: AttackRange;
  /** The start of the range; for "all", how far back logs are kept. */
  since: string;
  retentionDays: number;
  summary: AttackSummary;
  attacks: AttackRow[];
  /** The cursor for the next (older) page, or null on the last. */
  next: { time: string; id: number } | null;
}

/** A cursor time as `next` gives it: `2026-11-08T10:00:00.123456Z`. */
const EXACT_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const first = (raw: unknown): unknown => (Array.isArray(raw) ? raw[0] : raw);

const wholeNumber = (raw: unknown): number | undefined => {
  const text = first(raw);
  if (text === undefined || text === "") return undefined;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : undefined;
};

/**
 * Reads the page's query (`side`, `range`, `limit`, `beforeTime`, `beforeId`)
 * for player `rawId`. Unknown side or range fall back to "both" / "7d"; the
 * limit is capped at {@link MAX_ATTACK_PAGE}.
 */
export const parseAttackLogQuery = (rawId: unknown, query: Record<string, unknown>): Parsed<AttackLogQuery> => {
  const userid = wholeNumber(rawId);
  if (userid === undefined || userid < 1) return { ok: false, message: "There is no such player." };
  const sideText = first(query.side);
  const rangeText = first(query.range);
  const side = ATTACK_SIDES.find((s) => s === sideText) ?? "both";
  const range = ATTACK_RANGES.find((r) => r === rangeText) ?? "7d";
  const asked = wholeNumber(query.limit);
  const limit = Math.min(MAX_ATTACK_PAGE, Math.max(1, asked ?? ATTACK_PAGE));
  const beforeId = wholeNumber(query.beforeId);
  const beforeText = first(query.beforeTime);
  let before: AttackLogQuery["before"] = null;
  if (beforeId !== undefined || beforeText !== undefined) {
    const time = typeof beforeText === "string" && EXACT_TIME.test(beforeText) ? beforeText : null;
    if (beforeId === undefined || beforeId < 1 || time === null || Number.isNaN(Date.parse(time))) {
      return { ok: false, message: "That page is not in the log." };
    }
    before = { time, id: beforeId };
  }
  return { ok: true, value: { userid, side, range, limit, before } };
};

/** The start of a range: "all" is as far back as logs are kept. */
export const rangeStart = (range: AttackRange, now: Date, retentionDays: number): Date =>
  new Date(now.getTime() - (range === "all" ? retentionDays * DAY_MS : RANGE_MS[range]));

interface LogRow {
  id: string | number;
  attacktime: Date | string;
  /** `attacktime` to the microsecond, for the next page's cursor (a JS date keeps only milliseconds). */
  exact_time: string;
  attacker_userid: number;
  attacker_username: string;
  defender_userid: number;
  defender_username: string;
  type: string;
  x: number | null;
  y: number | null;
  loot: unknown;
  attackreport: unknown;
}

const iso = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();

const LOG_COLUMNS = `id, attacktime,
       to_char(attacktime AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS exact_time, attacker_userid, attacker_username, defender_userid, defender_username,
       type, x, y, loot, attackreport`;

/**
 * One side's page: `column` is `attacker_userid` or `defender_userid`, so the
 * read is a range on that index. `notSelf` leaves out attacks on themselves
 * (for "both", where the other side already has them).
 */
const readSide = async (
  em: EntityManager,
  column: "attacker_userid" | "defender_userid",
  q: AttackLogQuery,
  since: Date,
  notSelf: boolean,
): Promise<LogRow[]> => {
  const params: unknown[] = [q.userid, since];
  let page = "";
  if (q.before) {
    // `attacktime <= ?` keeps it an index range; the id breaks ties in the same instant.
    page = "AND attacktime <= ?::timestamptz AND (attacktime < ?::timestamptz OR id < ?)";
    params.push(q.before.time, q.before.time, q.before.id);
  }
  const other = column === "attacker_userid" ? "defender_userid" : "attacker_userid";
  const self = notSelf ? `AND ${other} <> ${column}` : "";
  params.push(q.limit + 1);
  return em.execute<LogRow[]>(
    `SELECT ${LOG_COLUMNS}
       FROM bym.attack_logs
      WHERE ${column} = ? AND attacktime >= ? ${page} ${self}
      ORDER BY attacktime DESC, id DESC
      LIMIT ?`,
    params,
  );
};

interface NameRow {
  userid: number;
  username: string;
  bot: boolean;
}

/** The players' names now and whether each is a bot, by account number. */
const playersById = async (em: EntityManager, ids: readonly number[]): Promise<Map<number, NameRow>> => {
  if (ids.length === 0) return new Map();
  const rows = await em.execute<NameRow[]>(
    `SELECT u.userid, u.username, (b.userid IS NOT NULL AND b.state <> 'seeded') AS bot
       FROM bym."user" u
       LEFT JOIN bym.bot b ON b.userid = u.userid
      WHERE u.userid = ANY(?::int[])`,
    [`{${[...new Set(ids)].join(",")}}`],
  );
  return new Map(rows.map((row) => [Number(row.userid), { ...row, userid: Number(row.userid), bot: row.bot === true }]));
};

const asPlayer = (userid: number, loggedName: string, names: Map<number, NameRow>): AttackPlayer => {
  const found = names.get(userid);
  return found
    ? { userid, username: found.username, bot: found.bot, gone: false }
    : { userid, username: loggedName, bot: false, gone: true };
};

interface TopRow {
  other: number;
  name: string;
  n: string | number;
  total: string | number;
  players: string | number;
}

/**
 * One side's totals and its most attacked (or attacking) players, grouped on
 * the index: `column` is the player's side, the other side is grouped.
 */
const readTop = async (
  em: EntityManager,
  column: "attacker_userid" | "defender_userid",
  userid: number,
  since: Date,
): Promise<{ total: number; players: number; top: { other: number; name: string; count: number }[] }> => {
  const other = column === "attacker_userid" ? "defender" : "attacker";
  const rows = await em.execute<TopRow[]>(
    `SELECT other, name, n, sum(n) OVER () AS total, count(*) OVER () AS players
       FROM (SELECT ${other}_userid AS other, max(${other}_username) AS name, count(*) AS n
               FROM bym.attack_logs
              WHERE ${column} = ? AND attacktime >= ?
              GROUP BY ${other}_userid) per_player
      ORDER BY n DESC, other
      LIMIT ${TOP_PLAYERS}`,
    [userid, since],
  );
  return {
    total: rows.length ? Number(rows[0]!.total) : 0,
    players: rows.length ? Number(rows[0]!.players) : 0,
    top: rows.map((row) => ({ other: Number(row.other), name: row.name, count: Number(row.n) })),
  };
};

/**
 * A player's attack log: the summary for the whole range and one page of
 * attacks, newest first. Null when there is no such account and nothing in
 * the log under that number.
 */
export const playerAttackLog = async (
  em: EntityManager,
  q: AttackLogQuery,
  now: Date = new Date(),
  retentionDays: number = retentionConfig().attackLogDays,
): Promise<AttackLogView | null> => {
  const since = rangeStart(q.range, now, retentionDays);

  const [made, received] = await Promise.all([
    readTop(em, "attacker_userid", q.userid, since),
    readTop(em, "defender_userid", q.userid, since),
  ]);

  let rows: LogRow[];
  if (q.side === "made") rows = await readSide(em, "attacker_userid", q, since, false);
  else if (q.side === "received") rows = await readSide(em, "defender_userid", q, since, false);
  else {
    const [out, into] = await Promise.all([
      readSide(em, "attacker_userid", q, since, false),
      readSide(em, "defender_userid", q, since, true),
    ]);
    rows = [...out, ...into].sort(
      (a, b) => new Date(b.attacktime).getTime() - new Date(a.attacktime).getTime() || Number(b.id) - Number(a.id),
    );
  }
  const more = rows.length > q.limit;
  rows = rows.slice(0, q.limit);

  const otherIds = rows.map((row) => (row.attacker_userid === q.userid ? row.defender_userid : row.attacker_userid));
  const names = await playersById(em, [
    q.userid,
    ...otherIds.map(Number),
    ...made.top.map((t) => t.other),
    ...received.top.map((t) => t.other),
  ]);

  let player: AttackPlayer;
  if (names.has(q.userid)) player = asPlayer(q.userid, "", names);
  else {
    // The account is gone: its name from the log, if the log has it at all.
    const logged = await em.execute<{ name: string }[]>(
      `(SELECT attacker_username AS name FROM bym.attack_logs WHERE attacker_userid = ? ORDER BY attacktime DESC LIMIT 1)
       UNION ALL
       (SELECT defender_username AS name FROM bym.attack_logs WHERE defender_userid = ? ORDER BY attacktime DESC LIMIT 1)`,
      [q.userid, q.userid],
    );
    if (!logged.length) return null;
    player = { userid: q.userid, username: logged[0]!.name, bot: false, gone: true };
  }

  const attacks: AttackRow[] = rows.map((row) => {
    // An attack on their own yard is "made", unless only attacks on them were asked for.
    const madeIt = q.side === "received" ? false : Number(row.attacker_userid) === q.userid;
    const otherId = Number(madeIt ? row.defender_userid : row.attacker_userid);
    const loggedName = madeIt ? row.defender_username : row.attacker_username;
    const other = asPlayer(otherId, loggedName, names);
    return {
      id: Number(row.id),
      time: iso(row.attacktime),
      direction: madeIt ? "made" : "received",
      other,
      otherLoggedName: !other.gone && loggedName && loggedName !== other.username ? loggedName : null,
      type: row.type,
      x: row.x ?? null,
      y: row.y ?? null,
      loot: row.loot ?? null,
      report: row.attackreport ?? null,
    };
  });

  const last = rows[rows.length - 1];
  const top = (list: { other: number; name: string; count: number }[]): TopPlayer[] =>
    list.map((t) => ({ ...asPlayer(t.other, t.name, names), count: t.count }));

  return {
    player,
    side: q.side,
    range: q.range,
    since: since.toISOString(),
    retentionDays,
    summary: {
      made: made.total,
      received: received.total,
      targets: made.players,
      attackers: received.players,
      topTargets: top(made.top),
      topAttackers: top(received.top),
    },
    attacks,
    next: more && last ? { time: last.exact_time, id: Number(last.id) } : null,
  };
};
