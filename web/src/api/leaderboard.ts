import { get } from "./http";
import type { ApiEnvelope } from "./types";

/**
 * The leaderboard (beta.4, server `services/leaderboard/empireBoard.ts`):
 * every player ranked by empire points: since beta 8 their main yard's score
 * (the original's yard points + base value) plus the points of every Map Room
 * 2 outpost they hold (server `services/maproom/v2/outpostPoints.ts`).
 */

/** One player's place on the board. */
export interface BoardRow {
  readonly rank: number;
  readonly userId: number;
  readonly name: string;
  /** `pic_square`: their avatar's path, or null for their default one. */
  readonly pic: string | null;
  /** Their uploaded photo's upload number; null or absent for the critter (`game/playerPicture.ts`). */
  readonly photo?: number | null;
  /** The board score: main yard points + outpost points. */
  readonly empirePoints: number;
  /** The main yard's empire points. Absent from a board built before beta 8. */
  readonly yardPoints?: number;
  /** The outposts' points added up. Absent from a board built before beta 8. */
  readonly outpostPoints?: number;
  /** Map Room 2 outposts they hold. */
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
