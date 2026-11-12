import type { EntityManager } from "@mikro-orm/postgresql";

/**
 * The dashboard's Flagged list (owner, 11 Nov 2026): the players the cheat
 * checks caught, one row per player, newest first, from `bym.report`.
 *
 * A `report` row holds a player's entries as `{ message, timestamp }`, written
 * by three checks, each with its own message (`reportManager.ts`):
 *
 * - **fight** — the attack save disagreed with the server's replay of the
 *   battle (`combat/saveBattle.ts`): "Attack save on base 201 rejected
 *   (reject): disagrees with the replay on damage, attackloot". An attack
 *   with a fling fuller than the Flinger holds (`combat/recordFlingRoom.ts`)
 *   is one too, its one field `flingOverRoom`: "Attack save on base 201
 *   rejected (reject): fling over Flinger room, 2830 of 2250 in fling 1".
 * - **economy** — the yard save broke an economy rule
 *   (`economy/recordVerdict.ts`): "ECONOMY SAVE REJECTED (mode=reject): base
 *   1200, 30s since the last save — overCap [12] {...}; capMismatch".
 * - **attack** — the attack load's payload was tampered with
 *   (`maproom/validateAttack.ts`, `logAttackViolation`): "ATTACK VIOLATION:
 *   ...". These also ban the player and are what `attack_violations` counts.
 *
 * A fight entry ends with what its yard is (`saveBattle.ts`, `yardTag`, from
 * 11 Nov 2026): "[save 1200]" for a yard with a row, whose owner this page
 * looks up by that save id, or "[descent]", "[inferno-tribe]", "[mr1-tribe]"
 * for one without. An older fight entry has no tag and its base id alone can
 * name a Descent yard and some player's save at once ("201"), so it is shown
 * as "base 201", with no owner guessed. An economy entry is always the
 * player's own yard save, looked up by its base id.
 *
 * Anything else is listed as it is, as "other". "refused" is a save the
 * server did not take (the player got nothing from it); "flagged" is one it
 * took and only recorded (log mode).
 *
 * Read-only: nothing here changes a player or a report.
 */

export type FlagKind = "fight" | "economy" | "attack" | "other";
export type FlagOutcome = "refused" | "flagged";

/**
 * What a yard is: one with a save row ("yard", its owner looked up), a yard
 * with none (an Inferno Descent yard, a Moloch tribe, a Map Room 1 tribe), or
 * "unknown" for an old fight entry that did not say.
 */
export type FlagYardKind = "yard" | "descent" | "inferno-tribe" | "mr1-tribe" | "unknown";

/** A yard an entry names, with whose it is. */
export interface FlagYard {
  /** Tells yards apart in the tallies: "save:1200", "descent:201", "base:201"... */
  key: string;
  kind: FlagYardKind;
  /** The base id; "" for a save id no row has any more. */
  baseid: string;
  /** The yard's owner now; null when no yard has that base id any more. */
  owner: { userid: number; username: string; bot: boolean } | null;
  /** `main`, `outpost`, `inferno`... as stored; null with no yard. */
  type: string | null;
}

/** One report entry, read. */
export interface FlagEntry {
  time: string;
  kind: FlagKind;
  /** Null for an attack violation or an entry this page cannot read. */
  outcome: FlagOutcome | null;
  /** What did not match: the fight's fields or the economy's rules. */
  fields: string[];
  /** The base the save was for; null when the message names none. */
  baseid: string | null;
  /** Its yard's {@link FlagYard.key}; null with no base. */
  yardKey: string | null;
  message: string;
}

export interface FlagCounts {
  fight: Record<FlagOutcome, number>;
  economy: Record<FlagOutcome, number>;
  attack: number;
  other: number;
}

export interface FlaggedPlayer {
  userid: number;
  /** Their name now; the name on the report when the account is gone. */
  username: string;
  banned: boolean;
  gone: boolean;
  /** The row's own counters, as the checks kept them. */
  violations: number;
  attackViolations: number;
  counts: FlagCounts;
  /** Every field or rule that did not match, most often first. */
  fields: { name: string; count: number }[];
  /** Every yard the entries name, most often first. */
  yards: (FlagYard & { count: number })[];
  first: string | null;
  last: string | null;
  /** How many entries the row holds. */
  entries: number;
  banReason: { message: string; time: string | null } | null;
}

export interface FlaggedDetail {
  player: FlaggedPlayer;
  /** Every entry, newest first, each with its yard. */
  history: (FlagEntry & { yard: FlagYard | null })[];
}

/** Players on one page of the list, newest first; enough for the whole table today. */
export const FLAGGED_PAGE = 200;

const FIGHT =
  /^Attack save on base (\S+) (rejected|flagged) \(([a-z]+)\): disagrees with the replay on (.+?)(?: \[(save \d+|descent|inferno-tribe|mr1-tribe)\])?$/s;
/** An over-full fling (`combat/recordFlingRoom.ts`): a fight entry whose one field is `flingOverRoom`. */
const FLING =
  /^Attack save on base (\S+) (rejected|flagged) \(([a-z]+)\): fling over Flinger room(?:, [^[]*)?(?: \[(save \d+|descent|inferno-tribe|mr1-tribe)\])?$/s;
const ECONOMY = /^ECONOMY SAVE (REJECTED|FLAGGED) \(mode=([a-z]+)\): base (\S+), \d+s since the last save — (.*)$/s;
const ATTACK = /^ATTACK VIOLATION: /;
const RULE = /^([A-Za-z][\w-]*)/;

const outcomeOf = (word: string): FlagOutcome => (word.toLowerCase() === "rejected" ? "refused" : "flagged");

/** The rule names of an economy entry's list ("overCap [12] {...}; capMismatch; and 3 more"). */
const economyRules = (listed: string): string[] => {
  const rules: string[] = [];
  for (const part of listed.split("; ")) {
    if (/^and \d+ more$/.test(part.trim())) continue;
    const rule = RULE.exec(part.trim())?.[1];
    if (rule && !rules.includes(rule)) rules.push(rule);
  }
  return rules;
};

/** One stored entry as the page shows it. Never throws: anything unreadable is "other". */
export const readEntry = (raw: unknown): FlagEntry | null => {
  if (!raw || typeof raw !== "object") return null;
  const { message, timestamp } = raw as { message?: unknown; timestamp?: unknown };
  if (typeof message !== "string") return null;
  const time = typeof timestamp === "string" && !Number.isNaN(Date.parse(timestamp)) ? new Date(timestamp).toISOString() : "";

  const fight = FIGHT.exec(message);
  if (fight) {
    const baseid = fight[1]!;
    const tag = fight[5];
    return {
      time,
      kind: "fight",
      outcome: outcomeOf(fight[2]!),
      fields: fight[4]!.split(",").map((field) => field.trim()).filter(Boolean),
      baseid,
      yardKey: tag === undefined ? `base:${baseid}` : tag.startsWith("save ") ? `save:${tag.slice(5)}` : `${tag}:${baseid}`,
      message,
    };
  }
  const fling = FLING.exec(message);
  if (fling) {
    const baseid = fling[1]!;
    const tag = fling[4];
    return {
      time,
      kind: "fight",
      outcome: outcomeOf(fling[2]!),
      fields: ["flingOverRoom"],
      baseid,
      yardKey: tag === undefined ? `base:${baseid}` : tag.startsWith("save ") ? `save:${tag.slice(5)}` : `${tag}:${baseid}`,
      message,
    };
  }
  const economy = ECONOMY.exec(message);
  if (economy) {
    return {
      time,
      kind: "economy",
      outcome: outcomeOf(economy[1]!),
      fields: economyRules(economy[4]!),
      baseid: economy[3]!,
      yardKey: `own:${economy[3]!}`,
      message,
    };
  }
  if (ATTACK.test(message)) return { time, kind: "attack", outcome: null, fields: [], baseid: null, yardKey: null, message };
  return { time, kind: "other", outcome: null, fields: [], baseid: null, yardKey: null, message };
};

/** A report row's entries, read, newest first. */
export const readEntries = (report: unknown): FlagEntry[] =>
  (Array.isArray(report) ? report : [])
    .map(readEntry)
    .filter((entry): entry is FlagEntry => entry !== null)
    .sort((one, other) => other.time.localeCompare(one.time));

const tally = (names: readonly string[]): { name: string; count: number }[] => {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((one, other) => other.count - one.count || one.name.localeCompare(other.name));
};

interface ReportRow {
  userid: number | string;
  report_username: string;
  username: string | null;
  banned: boolean | null;
  report: unknown;
  ban_reason: unknown;
  violations: number | string | null;
  attack_violations: number | string | null;
  lastupdate_at: Date | string | null;
}

/** The summary of one report row, its entries read, with the yards it names. */
export const summarise = (row: ReportRow, entries: readonly FlagEntry[], yards: ReadonlyMap<string, FlagYard>): FlaggedPlayer => {
  const counts: FlagCounts = {
    fight: { refused: 0, flagged: 0 },
    economy: { refused: 0, flagged: 0 },
    attack: 0,
    other: 0,
  };
  for (const entry of entries) {
    if (entry.kind === "fight" || entry.kind === "economy") counts[entry.kind][entry.outcome!] += 1;
    else counts[entry.kind] += 1;
  }
  const timed = entries.map((entry) => entry.time).filter(Boolean).sort();
  const keys = entries.map((entry) => entry.yardKey).filter((key): key is string => key !== null);
  const ban = row.ban_reason as { message?: unknown; timestamp?: unknown } | null;
  return {
    userid: Number(row.userid),
    username: row.username ?? row.report_username,
    banned: row.banned === true,
    gone: row.username === null,
    violations: Number(row.violations ?? 0),
    attackViolations: Number(row.attack_violations ?? 0),
    counts,
    fields: tally(entries.flatMap((entry) => entry.fields)),
    yards: tally(keys).map(({ name, count }) => ({ ...yardOf(name, yards), count })),
    first: timed[0] ?? null,
    last: timed.at(-1) ?? null,
    entries: entries.length,
    banReason:
      ban && typeof ban.message === "string"
        ? { message: ban.message, time: typeof ban.timestamp === "string" ? ban.timestamp : null }
        : null,
  };
};

interface YardRow {
  basesaveid: number | string;
  baseid: string;
  type: string;
  userid: number | string | null;
  username: string | null;
  bot: boolean | null;
}

const ROWLESS: ReadonlySet<string> = new Set(["descent", "inferno-tribe", "mr1-tribe"]);

const splitKey = (key: string): [string, string] => {
  const colon = key.indexOf(":");
  return [key.slice(0, colon), key.slice(colon + 1)];
};

/**
 * The yard a key names: the row {@link yardsByKey} found, else a yard with no
 * save row by its kind, else (a save gone, or an old untagged fight entry)
 * plainly its base id, owner null. Never guesses an owner.
 */
export const yardOf = (key: string, found: ReadonlyMap<string, FlagYard>): FlagYard => {
  const known = found.get(key);
  if (known) return known;
  const [prefix, rest] = splitKey(key);
  if (ROWLESS.has(prefix)) return { key, kind: prefix as FlagYardKind, baseid: rest, owner: null, type: null };
  if (prefix === "save") return { key, kind: "yard", baseid: "", owner: null, type: null };
  return { key, kind: prefix === "own" ? "yard" : "unknown", baseid: rest, owner: null, type: null };
};

/**
 * The yards with a row these keys name, with their owners now and whether
 * each is a bot: "save:N" by save id, "own:B" (an economy entry's own yard)
 * by base id. Yards with no row are left to {@link yardOf}.
 */
const yardsByKey = async (em: EntityManager, keys: readonly string[]): Promise<Map<string, FlagYard>> => {
  const saveids = new Set<string>();
  const baseids = new Set<string>();
  for (const key of keys) {
    const [prefix, id] = splitKey(key);
    if (!/^\d+$/.test(id)) continue;
    if (prefix === "save") saveids.add(id);
    if (prefix === "own") baseids.add(id);
  }
  if (saveids.size === 0 && baseids.size === 0) return new Map();
  const rows = await em.execute<YardRow[]>(
    `SELECT s.basesaveid, s.baseid, s.type, u.userid, u.username, (b.userid IS NOT NULL AND b.state <> 'seeded') AS bot
       FROM bym.save s
       LEFT JOIN bym."user" u ON u.userid = s.saveuserid
       LEFT JOIN bym.bot b ON b.userid = s.saveuserid
      WHERE s.basesaveid = ANY(?::bigint[]) OR s.baseid = ANY(?::text[])`,
    [`{${[...saveids].join(",")}}`, `{${[...baseids].join(",")}}`],
  );
  const out = new Map<string, FlagYard>();
  for (const row of rows) {
    const yard = (key: string): FlagYard => ({
      key,
      kind: "yard",
      baseid: String(row.baseid),
      type: row.type,
      owner:
        row.userid === null || row.username === null
          ? null
          : { userid: Number(row.userid), username: row.username, bot: row.bot === true },
    });
    if (saveids.has(String(row.basesaveid))) out.set(`save:${row.basesaveid}`, yard(`save:${row.basesaveid}`));
    if (baseids.has(String(row.baseid))) out.set(`own:${row.baseid}`, yard(`own:${row.baseid}`));
  }
  return out;
};

const REPORT_COLUMNS = `r.userid, r.username AS report_username, u.username, u.banned, r.report, r.ban_reason,
       r.violations, r.attack_violations, r.lastupdate_at`;

const lastTime = (player: FlaggedPlayer, row: ReportRow): number =>
  player.last ? Date.parse(player.last) : row.lastupdate_at ? new Date(row.lastupdate_at).getTime() : 0;

/** Every flagged player, newest entry first. */
export const listFlaggedPlayers = async (em: EntityManager, limit: number = FLAGGED_PAGE): Promise<FlaggedPlayer[]> => {
  const rows = await em.execute<ReportRow[]>(
    `SELECT ${REPORT_COLUMNS}
       FROM bym.report r
       LEFT JOIN bym."user" u ON u.userid = r.userid
      ORDER BY r.lastupdate_at DESC NULLS LAST, r.userid
      LIMIT ?`,
    [limit],
  );
  const read = rows.map((row) => ({ row, entries: readEntries(row.report) }));
  const yards = await yardsByKey(
    em,
    read.flatMap(({ entries }) => entries.map((entry) => entry.yardKey).filter((key): key is string => key !== null)),
  );
  return read
    .map(({ row, entries }) => ({ row, player: summarise(row, entries, yards) }))
    .sort((one, other) => lastTime(other.player, other.row) - lastTime(one.player, one.row) || one.player.userid - other.player.userid)
    .map(({ player }) => player);
};

/** One flagged player with every entry, or null when they have no report row. */
export const flaggedPlayer = async (em: EntityManager, userid: number): Promise<FlaggedDetail | null> => {
  const [row] = await em.execute<ReportRow[]>(
    `SELECT ${REPORT_COLUMNS}
       FROM bym.report r
       LEFT JOIN bym."user" u ON u.userid = r.userid
      WHERE r.userid = ?`,
    [userid],
  );
  if (!row) return null;
  const entries = readEntries(row.report);
  const yards = await yardsByKey(
    em,
    entries.map((entry) => entry.yardKey).filter((key): key is string => key !== null),
  );
  return {
    player: summarise(row, entries, yards),
    history: entries.map((entry) => ({
      ...entry,
      yard: entry.yardKey === null ? null : yardOf(entry.yardKey, yards),
    })),
  };
};
