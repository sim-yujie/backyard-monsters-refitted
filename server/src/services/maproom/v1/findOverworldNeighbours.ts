import type { EntityManager } from "@mikro-orm/postgresql";

import type { Save } from "../../../database/models/save.model.js";
import type { User } from "../../../database/models/user.model.js";
import { BaseType } from "../../../enums/Base.js";
import { MapRoomVersion } from "../../../enums/MapRoom.js";
import { experiencePoints } from "../../../game-data/stats/experiencePoints.js";
import { calculateBaseLevel } from "../../base/calculateBaseLevel.js";
import { shuffle } from "../../../utils/shuffle.js";
import { createNeighbourData } from "../createNeighbourData.js";
import type { NeighbourData } from "../../../types/NeighbourData.js";

/** A player's list holds at most this many neighbours (decision 5). */
export const NEIGHBOUR_LIMIT = 25;

/** Neighbours are within this many levels of the player, either way (decision 5). */
export const NEIGHBOUR_LEVEL_RANGE = 7;

/** Only real players seen within this many days take a place (decision 20). */
export const ACTIVE_PLAYER_DAYS = 30;

export interface LevelWindow {
  min: number;
  max: number;
}

/** The levels a player's neighbours may have, inclusive. */
export const neighbourLevelWindow = (level: number): LevelWindow => ({
  min: Math.max(1, level - NEIGHBOUR_LEVEL_RANGE),
  max: level + NEIGHBOUR_LEVEL_RANGE,
});

/**
 * The empire points (`points + basevalue`) whose `calculateBaseLevel` falls in
 * a level window: at least `low` and below `high`, a `null` bound being open
 * (level 1 takes everything under level 2; the top level has no ceiling).
 */
export const empirePointsRange = ({ min, max }: LevelWindow): { low: number | null; high: number | null } => ({
  low: min > 1 ? experiencePoints[min - 1] : null,
  high: max < experiencePoints.length ? experiencePoints[max] : null,
});

/**
 * A save's empire points in SQL. `points` and `basevalue` are text columns,
 * so anything that is not a whole number reads as no points at all (the row
 * is then outside every range) instead of failing the whole query.
 */
const EMPIRE_POINTS_SQL =
  "(CASE WHEN s.points ~ '^-{0,1}[0-9]+$' AND s.basevalue ~ '^-{0,1}[0-9]+$' " +
  "THEN s.points::numeric + s.basevalue::numeric END)";

interface RealNeighbourRow {
  userid: number;
  baseid: string;
  points: string;
  basevalue: string;
  lastupdate_at: Date | string;
  username: string;
  pic_square: string | null;
}

/**
 * Real players for a neighbour list (`docs/design/bot-neighbours.md` §4.3 step
 * 1): Map Room 1 main yards in the level window whose owners loaded their yard
 * in the last 30 days and are not bots, most recently seen first. The level
 * test runs in SQL, so every real player in range can be found.
 *
 * Cost: the scan starts from `user_last_seen_at_index` (players seen in the
 * last 30 days only), reaches each main save through `save_one_main_per_user`
 * and each bot check through `bot_pkey`; it runs at most once per player per
 * cache period.
 */
const findRealNeighbours = async (
  em: EntityManager,
  forUserid: number,
  levels: LevelWindow,
  seenSince: Date,
  exclude: number[]
): Promise<RealNeighbourRow[]> => {
  const skipped = [forUserid, ...exclude];
  const { low, high } = empirePointsRange(levels);
  const range: string[] = [];
  const rangeParams: number[] = [];

  if (low !== null) {
    range.push(`AND ${EMPIRE_POINTS_SQL} >= ?`);
    rangeParams.push(low);
  }

  if (high !== null) {
    range.push(`AND ${EMPIRE_POINTS_SQL} < ?`);
    rangeParams.push(high);
  }

  // No range test at all (a window from level 1 to the top) must still skip
  // yards whose points are not numbers, as the range tests do.
  if (!range.length) range.push(`AND ${EMPIRE_POINTS_SQL} IS NOT NULL`);

  return em.execute<RealNeighbourRow[]>(
    `
      SELECT s.userid, s.baseid, s.points, s.basevalue, s.lastupdate_at, u.username, u.pic_square
      FROM bym."user" u
      JOIN bym.save s ON s.userid = u.userid AND s.type = ?
      WHERE u.last_seen_at >= ?
        AND u.userid NOT IN (${skipped.map(() => "?").join(", ")})
        AND s.mapversion = ?
        AND NOT EXISTS (SELECT 1 FROM bym.bot b WHERE b.userid = u.userid)
        ${range.join("\n        ")}
      ORDER BY u.last_seen_at DESC, u.userid
      LIMIT ?
    `,
    [BaseType.MAIN, seenSince, ...skipped, MapRoomVersion.V1, ...rangeParams, NEIGHBOUR_LIMIT]
  );
};

export interface FindNeighboursOptions {
  /** The current time; now by default. */
  now?: Date;
  /** A source of numbers in [0, 1) for the order; `Math.random` by default. */
  random?: () => number;
  /** Players to leave out: those dropped today by the attack cap (issue #247). */
  exclude?: number[];
}

/**
 * Find MR1 overworld neighbours for a user and return data suitable for caching
 * (issue #236, `docs/design/bot-neighbours.md` §4.3).
 *
 * Up to 25 real players within 7 levels either way, seen in the last 30 days,
 * shuffled. Bots used to fill the empty places (`BOTS_FILL`); they were
 * retired (owner, 12 Nov 2026) and their code removed in beta 9, so the list
 * is real players only.
 *
 * @param {EntityManager} em - The entity manager to read with
 * @param {User} user - The authenticated user to find neighbours for
 * @param {Save} save - The user's main save, with at least `points` and `basevalue`
 * @param {FindNeighboursOptions} options - Time and randomness, for tests
 * @returns {Promise<NeighbourData[]>} - Array of neighbour data suitable for caching
 */
export const findOverworldNeighbours = async (
  em: EntityManager,
  user: Pick<User, "userid">,
  save: Pick<Save, "points" | "basevalue">,
  options: FindNeighboursOptions = {}
): Promise<NeighbourData[]> => {
  const now = options.now ?? new Date();
  const random = options.random ?? Math.random;
  const exclude = options.exclude ?? [];

  const level = calculateBaseLevel(save.points, save.basevalue);
  const levels = neighbourLevelWindow(level);
  const seenSince = new Date(now.getTime() - ACTIVE_PLAYER_DAYS * 24 * 60 * 60 * 1000);

  const reals = await findRealNeighbours(em, user.userid, levels, seenSince, exclude);

  const neighbours = reals.map((row) =>
    createNeighbourData(
      { userid: row.userid, baseid: row.baseid, lastupdateAt: new Date(row.lastupdate_at) },
      row,
      calculateBaseLevel(row.points, row.basevalue)
    )
  );

  return shuffle(neighbours, random);
};
