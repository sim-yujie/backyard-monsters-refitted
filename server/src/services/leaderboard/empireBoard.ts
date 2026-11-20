import type { EntityManager } from "@mikro-orm/postgresql";

import { tallyOutposts, type OutpostTally } from "../maproom/v2/outpostPoints.js";
import { visiblePhotos } from "../profile/visiblePhoto.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";

/**
 * The leaderboard (beta.4): one board for every player, ordered by empire
 * points. Since beta 8 (owner 17 Nov 2026, the "outpost race") a player's
 * board score is their main yard's empire points, the Flash score (`points` +
 * `basevalue`, `client/scripts/BASE.as:4835-4877`), plus the outpost points
 * (`services/maproom/v2/outpostPoints.ts`) of every Map Room 2 outpost they
 * hold when the board is built, less the main points each outpost already
 * paid them (`mainpointsearned`, patch 8.1), so no level counts twice. The outpost part is never stored: a lost or
 * abandoned outpost stops counting at the next build, the new owner of a
 * taken-over one gains it, and the save's `points`, `basevalue` and
 * `empirepoints` stay the main yard's alone (player level, raids and attack
 * ranges never see the outposts). Each row also says how many outposts the
 * player holds.
 *
 * Owner decisions (2026-10-20):
 *
 * - Ties go to whoever reached the score first: `save.empirepointsat`, the
 *   time the main yard's score last changed, earliest first, then the lower
 *   user id, so the order never shuffles between two reads of the same data.
 * - Left out: every account with a `bym.bot` row, whatever its state (the
 *   Map Room 1 neighbours, and the `seeded` Map Room 2 dev players, which the
 *   seed scripts refuse to make on production), and banned accounts.
 * - No Discord tags.
 *
 * The whole board is worked out at most once per {@link BOARD_TTL}: the top
 * {@link TOP_SIZE} rows go into one Redis key, and every ranked player's own
 * row into a hash under a name unique to that build, so a reader never sees
 * half of one build and half of the next. The ordered scan walks the partial
 * index `save_main_empire_board_index` (migration `AddEmpirePointsToSave`).
 */

export const TOP_SIZE = 100;

/** Seconds a build of the board is served before the next read builds it again. */
export const BOARD_TTL = 10 * 60;

/** Under `leaderboards_`, so deleting an account clears it (`LEADERBOARD_PATTERN`). */
export const BOARD_KEY = "leaderboards_empire_board";
const RANKS_KEY_PREFIX = "leaderboards_empire_ranks_";

/** One player's place on the board, as the client gets it. */
export interface BoardRow {
  readonly rank: number;
  readonly userId: number;
  readonly name: string;
  /** `user.pic_square`: their avatar's path, or null for the default one. */
  readonly pic: string | null;
  /**
   * Their visible photo's upload number, null for the critter
   * (`services/profile/visiblePhoto.ts`). Not kept with the stored board:
   * looked up for each answer, so a new or hidden photo shows at once.
   */
  readonly photo?: number | null;
  /** The board score: {@link yardPoints} + {@link outpostPoints}. */
  readonly empirePoints: number;
  /** The main yard's empire points (`save.empirepoints`). */
  readonly yardPoints: number;
  /** Every outpost they hold, its points less what it already paid main, added up (`outpostPoints.ts`). */
  readonly outpostPoints: number;
  /** Map Room 2 outposts they hold. */
  readonly outposts: number;
}

export interface BoardAnswer {
  /** The top {@link TOP_SIZE}, first place first. */
  readonly top: BoardRow[];
  /** The asking player's own row, or null when they are not on the board. */
  readonly you: BoardRow | null;
  /** Ranked players in all. */
  readonly total: number;
  /** When this build was worked out, unix seconds. */
  readonly builtAt: number;
}

/** What the store keeps for a build. */
interface StoredBoard {
  readonly top: BoardRow[];
  readonly total: number;
  readonly builtAt: number;
  readonly ranksKey: string;
}

/** The part of Bun's `RedisClient` the board uses. */
export interface BoardRedis {
  get(key: string): Promise<string | null>;
  setex(key: string, ttlSeconds: number, value: string): Promise<unknown>;
  send(command: string, args: string[]): Promise<unknown>;
}

interface BoardSqlRow {
  userid: number | string;
  username: string;
  pic_square: string | null;
  empirepoints: number | string;
  /** When the main yard's score last changed, unix seconds; absent sorts last. */
  empirepointsat?: number | string | null;
}

interface OutpostSqlRow {
  userid: number | string;
  buildingdata: BuildingDataMap | string | null;
  /** Main points the outpost already paid its owner, taken off its points (patch 8.1). */
  mainpointsearned: number | string | null;
}

/**
 * Every ranked player, by main yard points (outposts are added in {@link rankRows}). Bots (any `bym.bot` row) and banned
 * accounts are left out; a player with no main yard has no row.
 */
export const BOARD_SQL = `
  SELECT
    u.userid,
    u.username,
    u.pic_square,
    s.empirepoints,
    s.empirepointsat
  FROM bym.save s
  JOIN bym."user" u ON u.save_basesaveid = s.basesaveid
  WHERE s.type = 'main'
    AND u.banned = false
    AND NOT EXISTS (SELECT 1 FROM bym.bot b WHERE b.userid = u.userid)
  ORDER BY s.empirepoints DESC, s.empirepointsat ASC, s.userid ASC
`;

/**
 * Every Map Room 2 outpost, who holds it and the main points it already paid
 * them, in one query for the whole board (not one per player). Inferno yards
 * are `inferno`, never `outpost`, so they stay out.
 */
export const OUTPOSTS_SQL = `
  SELECT o.userid, o.buildingdata, o.mainpointsearned
  FROM bym.save o
  WHERE o.type = 'outpost'
`;

/**
 * The board: each player's main yard points plus their outposts' points,
 * most first, ranked 1, 2, 3... Players on the same total go by who reached
 * their main yard's score first (`empirepointsat`), then the lower user id.
 */
export const rankRows = (
  rows: readonly BoardSqlRow[],
  outposts: ReadonlyMap<number, OutpostTally> = new Map(),
): BoardRow[] =>
  rows
    .map((row) => {
      const at = Number(row.empirepointsat);
      const userId = Number(row.userid);
      const yardPoints = Number(row.empirepoints);
      const held = outposts.get(userId);
      const outpostPoints = held?.points ?? 0;
      return {
        userId,
        name: row.username,
        pic: row.pic_square ?? null,
        empirePoints: yardPoints + outpostPoints,
        yardPoints,
        outpostPoints,
        outposts: held?.count ?? 0,
        at: Number.isFinite(at) && row.empirepointsat !== null && row.empirepointsat !== undefined ? at : Infinity,
      };
    })
    .sort((a, b) => b.empirePoints - a.empirePoints || a.at - b.at || a.userId - b.userId)
    .map(({ at: _at, ...row }, index) => ({ rank: index + 1, ...row }));

/** Works the board out from the database and stores it; returns the stored build. */
const buildBoard = async (em: EntityManager, redis: BoardRedis, now: number): Promise<StoredBoard> => {
  const connection = em.getConnection();
  const players = await connection.execute<BoardSqlRow[]>(BOARD_SQL);
  const outposts = tallyOutposts(await connection.execute<OutpostSqlRow[]>(OUTPOSTS_SQL));
  const ranked = rankRows(players, outposts);
  const ranksKey = `${RANKS_KEY_PREFIX}${now}`;

  // The hash first, so a board in the store always has its ranks.
  for (let start = 0; start < ranked.length; start += 500) {
    const fields = ranked.slice(start, start + 500).flatMap((row) => [String(row.userId), JSON.stringify(row)]);
    await redis.send("HSET", [ranksKey, ...fields]);
  }
  // A minute longer than the board, so the board never outlives its hash.
  if (ranked.length > 0) await redis.send("EXPIRE", [ranksKey, String(BOARD_TTL + 60)]);

  const board: StoredBoard = { top: ranked.slice(0, TOP_SIZE), total: ranked.length, builtAt: now, ranksKey };
  await redis.setex(BOARD_KEY, BOARD_TTL, JSON.stringify(board));
  return board;
};

/**
 * The board for one player: the top {@link TOP_SIZE} and their own row.
 *
 * @param em - The entity manager to read with.
 * @param redis - Where the board is kept between builds.
 * @param userid - The asking player.
 * @param now - Unix seconds; the clock by default.
 */
export const empireBoard = async (
  em: EntityManager,
  redis: BoardRedis,
  userid: number,
  now: number = Math.floor(Date.now() / 1000),
): Promise<BoardAnswer> => {
  const cached = await redis.get(BOARD_KEY);
  const board: StoredBoard = cached ? (JSON.parse(cached) as StoredBoard) : await buildBoard(em, redis, now);

  const inTop = board.top.find((row) => row.userId === userid);
  let you: BoardRow | null = inTop ?? null;
  if (!you) {
    const stored = await redis.send("HGET", [board.ranksKey, String(userid)]);
    you = typeof stored === "string" ? (JSON.parse(stored) as BoardRow) : null;
  }

  const photos = await visiblePhotos(em, [...board.top.map((row) => row.userId), ...(you ? [you.userId] : [])]);
  const withPhoto = (row: BoardRow): BoardRow => ({ ...row, photo: photos.get(row.userId) ?? null });
  return { top: board.top.map(withPhoto), you: you && withPhoto(you), total: board.total, builtAt: board.builtAt };
};
