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
 *   (reject): disagrees with the replay on damage, attackloot".
 * - **economy** — the yard save broke an economy rule
 *   (`economy/recordVerdict.ts`): "ECONOMY SAVE REJECTED (mode=reject): base
 *   1200, 30s since the last save — overCap [12] {...}; capMismatch".
 * - **attack** — the attack load's payload was tampered with
 *   (`maproom/validateAttack.ts`, `logAttackViolation`): "ATTACK VIOLATION:
 *   ...". These also ban the player and are what `attack_violations` counts.
 *
 * Anything else is listed as it is, as "other". "refused" is a save the
 * server did not take (the player got nothing from it); "flagged" is one it
 * took and only recorded (log mode).
 *
 * Read-only: nothing here changes a player or a report.
 */

export type FlagKind = "fight" | "economy" | "attack" | "other";
export type FlagOutcome = "refused" | "flagged";

/** A yard an entry names, with whose it is. */
export interface FlagYard {
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

const FIGHT = /^Attack save on base (\S+) (rejected|flagged) \(([a-z]+)\): disagrees with the replay on (.+)$/s;
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
    return {
      time,
      kind: "fight",
      outcome: outcomeOf(fight[2]!),
      fields: fight[4]!.split(",").map((field) => field.trim()).filter(Boolean),
      baseid: fight[1]!,
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
      message,
    };
  }
  if (ATTACK.test(message)) return { time, kind: "attack", outcome: null, fields: [], baseid: null, message };
  return { time, kind: "other", outcome: null, fields: [], baseid: null, message };
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
  const baseids = entries.map((entry) => entry.baseid).filter((id): id is string => id !== null);
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
    yards: tally(baseids).map(({ name, count }) => ({ ...(yards.get(name) ?? { baseid: name, owner: null, type: null }), count })),
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
  baseid: string;
  type: string;
  userid: number | string | null;
  username: string | null;
  bot: boolean | null;
}

/** The yards these base ids are, with their owners now and whether each is a bot. */
const yardsById = async (em: EntityManager, baseids: readonly string[]): Promise<Map<string, FlagYard>> => {
  const ids = [...new Set(baseids)].filter((id) => /^\d+$/.test(id));
  if (ids.length === 0) return new Map();
  const rows = await em.execute<YardRow[]>(
    `SELECT s.baseid, s.type, u.userid, u.username, (b.userid IS NOT NULL AND b.state <> 'seeded') AS bot
       FROM bym.save s
       LEFT JOIN bym."user" u ON u.userid = s.saveuserid
       LEFT JOIN bym.bot b ON b.userid = s.saveuserid
      WHERE s.baseid = ANY(?::text[])`,
    [`{${ids.join(",")}}`],
  );
  return new Map(
    rows.map((row) => [
      String(row.baseid),
      {
        baseid: String(row.baseid),
        type: row.type,
        owner:
          row.userid === null || row.username === null
            ? null
            : { userid: Number(row.userid), username: row.username, bot: row.bot === true },
      },
    ]),
  );
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
  const yards = await yardsById(
    em,
    read.flatMap(({ entries }) => entries.map((entry) => entry.baseid).filter((id): id is string => id !== null)),
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
  const yards = await yardsById(
    em,
    entries.map((entry) => entry.baseid).filter((id): id is string => id !== null),
  );
  return {
    player: summarise(row, entries, yards),
    history: entries.map((entry) => ({
      ...entry,
      yard: entry.baseid === null ? null : (yards.get(entry.baseid) ?? { baseid: entry.baseid, owner: null, type: null }),
    })),
  };
};
