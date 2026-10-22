import type { EntityManager } from "@mikro-orm/postgresql";

/**
 * The leaderboard (beta.4): one board for every player, ordered by empire
 * points, the Flash score (`points` + `basevalue`, `client/scripts/BASE.as:4835-4877`).
 * Only the main yard counts: Flash kept an outpost's value apart and never
 * added it in (`BASE.as:4853-4855`). Each row also shows how many Map Room 2
 * outposts the player holds.
 *
 * Owner decisions (2026-10-20):
 *
 * - Ties go to whoever reached the score first: `save.empirepointsat`, the
 *   time the score last changed, earliest first, then the lower user id, so
 *   the order never shuffles between two reads of the same data.
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
  readonly empirePoints: number;
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
  outposts: number | string;
}

/**
 * Every ranked player, in board order. Bots (any `bym.bot` row) and banned
 * accounts are left out; a player with no main yard has no row.
 */
export const BOARD_SQL = `
  SELECT
    u.userid,
    u.username,
    u.pic_square,
    s.empirepoints,
    (SELECT count(*) FROM bym.save o WHERE o.userid = s.userid AND o.type = 'outpost')::int AS outposts
  FROM bym.save s
  JOIN bym."user" u ON u.save_basesaveid = s.basesaveid
  WHERE s.type = 'main'
    AND u.banned = false
    AND NOT EXISTS (SELECT 1 FROM bym.bot b WHERE b.userid = u.userid)
  ORDER BY s.empirepoints DESC, s.empirepointsat ASC, s.userid ASC
`;

/** The rows a query gave, ranked 1, 2, 3... in the order they came. */
export const rankRows = (rows: readonly BoardSqlRow[]): BoardRow[] =>
  rows.map((row, index) => ({
    rank: index + 1,
    userId: Number(row.userid),
    name: row.username,
    pic: row.pic_square ?? null,
    empirePoints: Number(row.empirepoints),
    outposts: Number(row.outposts),
  }));

/** Works the board out from the database and stores it; returns the stored build. */
const buildBoard = async (em: EntityManager, redis: BoardRedis, now: number): Promise<StoredBoard> => {
  const ranked = rankRows(await em.getConnection().execute<BoardSqlRow[]>(BOARD_SQL));
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

  return { top: board.top, you, total: board.total, builtAt: board.builtAt };
};
