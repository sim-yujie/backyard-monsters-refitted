import { get } from "./http";
import type { ApiEnvelope } from "./types";

/**
 * The leaderboard (beta.4, server `services/leaderboard/empireBoard.ts`):
 * every player ranked by empire points, the original's score (yard points +
 * base value), with their Map Room 2 outposts beside it.
 */

/** One player's place on the board. */
export interface BoardRow {
  readonly rank: number;
  readonly userId: number;
  readonly name: string;
  /** `pic_square`: their avatar's path, or null for their default one. */
  readonly pic: string | null;
  readonly empirePoints: number;
  readonly outposts: number;
}

export interface EmpireBoard extends ApiEnvelope {
  /** The top 100, first place first. */
  readonly top: BoardRow[];
  /** The player's own row; null when they are not on the board. */
  readonly you: BoardRow | null;
  /** Ranked players in all. */
  readonly total: number;
  /** When the server worked this board out, unix seconds (it is kept a few minutes). */
  readonly builtAt: number;
}

/** `GET /api/:apiVersion/leaderboards/empire`: the top 100 and the player's own row. */
export const getEmpireBoard = (): Promise<EmpireBoard> => get<EmpireBoard>("/api/:apiVersion/leaderboards/empire");
