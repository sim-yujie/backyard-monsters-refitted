import type { EntityManager } from "@mikro-orm/postgresql";

import { LOOK_FONTS, LOOK_MUSIC, LOOK_QUALITIES, LOOK_STYLES } from "../user/lookReport.js";
import { realPlayerSql } from "./realPlayers.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far back the dashboard counts looks: players whose game sent one in the last week. */
export const LOOK_DAYS = 7;

/** Players per choice; every choice is listed, with 0 when nobody picked it. */
type Tally<T extends string> = { readonly [K in T]: number };

export interface LookTotals {
  /** The window counted, in days. */
  readonly days: number;
  /** Real players whose game sent its look in the window. */
  readonly reported: number;
  readonly style: Tally<(typeof LOOK_STYLES)[number]>;
  readonly music: Tally<(typeof LOOK_MUSIC)[number]>;
  readonly quality: Tally<(typeof LOOK_QUALITIES)[number]>;
  readonly font: Tally<(typeof LOOK_FONTS)[number]>;
}

export interface LookRow {
  look_style: string | null;
  look_music: string | null;
  look_quality: string | null;
  look_font: string | null;
  n: number | string;
}

const tally = <T extends string>(choices: readonly T[], rows: readonly LookRow[], pick: (row: LookRow) => string | null): Tally<T> => {
  const counts = Object.fromEntries(choices.map((choice) => [choice, 0])) as Record<T, number>;
  for (const row of rows) {
    const value = pick(row);
    if (value !== null && (choices as readonly string[]).includes(value)) counts[value as T] += Number(row.n);
  }
  return counts;
};

/** Adds up grouped rows into the dashboard's counts. A value the game no longer offers is left out. */
export const tallyLooks = (rows: readonly LookRow[], days = LOOK_DAYS): LookTotals => ({
  days,
  reported: rows.reduce((sum, row) => sum + Number(row.n), 0),
  style: tally(LOOK_STYLES, rows, (row) => row.look_style),
  music: tally(LOOK_MUSIC, rows, (row) => row.look_music),
  quality: tally(LOOK_QUALITIES, rows, (row) => row.look_quality),
  font: tally(LOOK_FONTS, rows, (row) => row.look_font),
});

/**
 * How real players split between the looks (owner, 4 Nov 2026: "which players
 * are using modern vs classic"): everyone whose game sent its Look and sound
 * choices in the last {@link LOOK_DAYS} days, as of `now`.
 */
export const lookTotals = async (em: EntityManager, now: number = Date.now()): Promise<LookTotals> => {
  const rows = await em.execute<LookRow[]>(
    `SELECT u.look_style, u.look_music, u.look_quality, u.look_font, count(*) AS n
       FROM bym."user" u
      WHERE u.look_seen_at >= ? AND u.look_style IS NOT NULL AND ${realPlayerSql("u")}
      GROUP BY 1, 2, 3, 4`,
    [new Date(now - LOOK_DAYS * DAY_MS)],
  );
  return tallyLooks(rows);
};
