import { Status } from "../../enums/StatusCodes.js";
import { postgres, redis } from "../../server.js";
import { empireBoard } from "../../services/leaderboard/empireBoard.js";
import type { KoaController } from "../../utils/KoaController.js";

/**
 * `GET /api/:apiVersion/leaderboards/empire`: the leaderboard by empire points,
 * the top 100 and the caller's own row (`services/leaderboard/empireBoard.ts`).
 */
export const getEmpireBoard: KoaController = async (ctx) => {
  const board = await empireBoard(postgres.em, redis, ctx.authUser.userid);
  ctx.status = Status.OK;
  ctx.body = board;
};
