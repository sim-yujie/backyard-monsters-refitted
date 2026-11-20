import type { EntityManager } from "@mikro-orm/postgresql";

import type { BuildingDataMap } from "../../../types/BuildingData.js";
import { BOARD_SQL, rankRows, type BoardRow } from "../../leaderboard/empireBoard.js";
import { estimateMainPointsEarned } from "./outpostEarned.js";
import { outpostPoints, tallyOutposts } from "./outpostPoints.js";

/**
 * The one-off seed of `save.mainpointsearned` for outposts built before patch
 * 8.1 tracked it (`database/seeds/seed_outpost_mainpoints.ts` runs it).
 *
 * Each outpost's value becomes the larger of what it holds (what the yard
 * rules booked since the deploy, exact) and the estimate from its stored
 * buildings (`estimateMainPointsEarned`, the read-only diagnosis's rule), so
 * the seed never lowers a booked value. The rows are read under a row lock and
 * written in one transaction, and the column's comment records that the seed
 * ran: a second `apply` is refused unless forced, because by then a takeover
 * or a Starter Kit may have lowered a value on purpose.
 */

/** Every outpost, locked for the write when `lock` is set. */
const rowsSql = (lock: boolean) => `
  SELECT basesaveid, userid, buildingdata, starterkit, mainpointsearned
  FROM bym.save
  WHERE type = 'outpost'
  ORDER BY basesaveid
  ${lock ? "FOR UPDATE" : ""}
`;

const COMMENT_SQL = `
  SELECT col_description('bym.save'::regclass, a.attnum) AS comment
  FROM pg_attribute a
  WHERE a.attrelid = 'bym.save'::regclass AND a.attname = 'mainpointsearned'
`;

/** The column comment's start once the seed has run. */
export const SEEDED_MARK = "seeded";

interface SeedSqlRow {
  basesaveid: number | string;
  userid: number | string;
  buildingdata: BuildingDataMap | string | null;
  starterkit: number | string | null;
  mainpointsearned: number | string | null;
}

/** One outpost's seed. */
export interface SeedRow {
  basesaveid: number;
  userid: number;
  /** Its board formula points (`outpostPoints`), before anything is taken off. */
  points: number;
  /** What it held before the seed. */
  before: number;
  /** The estimate from its buildings. */
  estimate: number;
  /** What it holds after: the larger of the two. */
  after: number;
}

const parse = (data: SeedSqlRow["buildingdata"]): BuildingDataMap | null =>
  typeof data === "string" ? (JSON.parse(data) as BuildingDataMap) : data;

/** Works out every outpost's seed from its row. */
export const planSeed = (rows: readonly SeedSqlRow[]): SeedRow[] =>
  rows.map((row) => {
    const buildingdata = parse(row.buildingdata);
    const before = Math.max(0, Math.floor(Number(row.mainpointsearned)) || 0);
    const estimate = estimateMainPointsEarned(buildingdata, row.starterkit);
    return {
      basesaveid: Number(row.basesaveid),
      userid: Number(row.userid),
      points: outpostPoints(buildingdata),
      before,
      estimate,
      after: Math.max(before, estimate),
    };
  });

/** What a run did, or would do. */
export interface SeedReport {
  applied: boolean;
  /** The column comment before the run (null for none). */
  mark: string | null;
  outposts: number;
  /** Rows whose value goes up. */
  changed: number;
  /** All outposts' formula points. */
  points: number;
  /** All outposts' board points before and after: each outpost's points less its value, never below 0. */
  boardBefore: number;
  boardAfter: number;
  /** The board's top rows before and after (`rankRows`). */
  topBefore: BoardRow[];
  topAfter: BoardRow[];
  rows: SeedRow[];
}

const net = (rows: readonly SeedRow[], key: "before" | "after") =>
  rows.reduce((total, row) => total + Math.max(0, row.points - row[key]), 0);

/**
 * Plans the seed and, with `apply`, writes it.
 *
 * @param em - An entity manager on the database to seed.
 * @param options.apply - Write the values; otherwise a dry run that writes nothing.
 * @param options.force - Write even though the column says the seed ran already.
 * @param options.top - How many board rows to report.
 * @throws When `apply` is asked of a database the seed already ran on, without `force`.
 */
export const seedMainPointsEarned = async (
  em: EntityManager,
  options: { apply?: boolean; force?: boolean; top?: number } = {},
): Promise<SeedReport> => {
  const top = options.top ?? 10;
  return em.transactional(async (tx) => {
    const connection = tx.getConnection();
    const [{ comment = null } = {}] = await connection.execute<{ comment: string | null }[]>(COMMENT_SQL, [], "all", tx.getTransactionContext());
    const seeded = typeof comment === "string" && comment.startsWith(SEEDED_MARK);
    if (options.apply && seeded && !options.force) {
      throw new Error(`The seed already ran on this database (${comment}). Pass --force to run it again.`);
    }

    const sqlRows = await connection.execute<SeedSqlRow[]>(rowsSql(Boolean(options.apply)), [], "all", tx.getTransactionContext());
    const rows = planSeed(sqlRows);

    const players = await connection.execute<Parameters<typeof rankRows>[0][number][]>(BOARD_SQL, [], "all", tx.getTransactionContext());
    const tally = (key: "before" | "after") =>
      tallyOutposts(
        sqlRows.map((row, i) => ({ userid: row.userid, buildingdata: parse(row.buildingdata), mainpointsearned: rows[i]![key] })),
      );
    const topBefore = rankRows(players, tally("before")).slice(0, top);
    const topAfter = rankRows(players, tally("after")).slice(0, top);

    const changed = rows.filter((row) => row.after !== row.before);
    if (options.apply) {
      for (let start = 0; start < changed.length; start += 500) {
        const batch = changed.slice(start, start + 500);
        await connection.execute(
          `UPDATE bym.save s SET mainpointsearned = GREATEST(s.mainpointsearned, v.after)
             FROM (VALUES ${batch.map(() => "(?::bigint, ?::bigint)").join(", ")}) AS v(basesaveid, after)
            WHERE s.basesaveid = v.basesaveid AND s.type = 'outpost'`,
          batch.flatMap((row) => [row.basesaveid, row.after]),
          "run",
          tx.getTransactionContext(),
        );
      }
      const mark = `${SEEDED_MARK} ${new Date().toISOString()}: ${changed.length} of ${rows.length} outposts`;
      await connection.execute(`COMMENT ON COLUMN bym.save.mainpointsearned IS '${mark.replace(/'/g, "")}'`, [], "run", tx.getTransactionContext());
    }

    return {
      applied: Boolean(options.apply),
      mark: comment,
      outposts: rows.length,
      changed: changed.length,
      points: rows.reduce((total, row) => total + row.points, 0),
      boardBefore: net(rows, "before"),
      boardAfter: net(rows, "after"),
      topBefore,
      topAfter,
      rows,
    };
  });
};
