import { createReadStream, readdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

/**
 * Rebuilds two daily numbers for days from before the dashboard's own record
 * (`activity.ts`) from the server's JSON-lines log files (`utils/logger.ts`,
 * `logs/bymr-YYYY-MM-DD.jsonl` plus rotated copies `.1` to `.9`, kept 30
 * days), so the first weeks are not blank:
 *
 * - who played: the `login` records. The web client signs in (with its saved
 *   session or a password) every time the game is opened, so this is every
 *   player who opened the game that day; one who kept a tab open past
 *   midnight is missed for the second day.
 * - wild monster raids landed: the `wild-raid` records, each raid (player and
 *   raid id) once, as a repeated finish logs its landing again.
 *
 * Only files named for one of the wanted days are read, line by line, and a
 * line is parsed only when it mentions one of those two records.
 */

export interface LogDay {
  /** Account numbers that signed in that day (bots never can). */
  readonly logins: Set<number>;
  /** Wild monster raids that landed that day. */
  readonly raids: number;
}

interface MutableLogDay {
  logins: Set<number>;
  raids: Set<string>;
}

const DAY_FILE = /^(.+)-(\d{4}-\d{2}-\d{2})\.jsonl(?:\.\d+)?$/;

/** The days in `days` that have at least one log file in `dir`. */
export const daysWithLogFiles = (dir: string, base: string, days: Iterable<string>): Set<string> => {
  const wanted = new Set(days);
  const found = new Set<string>();
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return found;
  }
  for (const name of names) {
    const match = DAY_FILE.exec(name);
    if (match && match[1] === base && wanted.has(match[2]!)) found.add(match[2]!);
  }
  return found;
};

/**
 * Reads the log files of `days` from `dir` (a missing directory reads as no
 * files). Each record counts on the UTC day of its own timestamp. Days with
 * no file are absent from the answer, so "no file" and "a quiet day" differ.
 */
export const readLogDays = async (dir: string, base: string, days: Iterable<string>): Promise<Map<string, LogDay>> => {
  const wanted = new Set(days);
  const found = daysWithLogFiles(dir, base, wanted);
  const result = new Map<string, MutableLogDay>();
  for (const day of found) result.set(day, { logins: new Set(), raids: new Set() });

  const names = readdirSync(dir).filter((name) => {
    const match = DAY_FILE.exec(name);
    return match !== null && match[1] === base && found.has(match[2]!);
  });

  for (const name of names) {
    const lines = createInterface({ input: createReadStream(join(dir, name), { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.includes('"event":"login"') && !line.includes('"event":"wild-raid"')) continue;
      let record: { "@timestamp"?: unknown; properties?: { event?: unknown; userid?: unknown; id?: unknown } };
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      const day = typeof record["@timestamp"] === "string" ? record["@timestamp"].slice(0, 10) : "";
      const into = result.get(day);
      if (!into) continue;
      const event = record.properties?.event;
      if (event === "login") {
        const userid = Number(record.properties?.userid);
        if (Number.isSafeInteger(userid) && userid > 0) into.logins.add(userid);
      } else if (event === "wild-raid") {
        into.raids.add(`${String(record.properties?.userid)}:${String(record.properties?.id)}`);
      }
    }
  }
  return new Map([...result].map(([day, { logins, raids }]) => [day, { logins, raids: raids.size }]));
};
