import { postgres } from "../../server.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import type { KoaController } from "../../utils/KoaController.js";
import { playerAchievementsAnswer } from "./player.js";

/** The public achievements route bound to Koa and `postgres.em`; what it does is in `player.ts`. */
export const playerAchievements: KoaController = async (ctx) => {
  const result = await playerAchievementsAnswer(postgres.em, ctx.params, getCurrentDateTime());
  ctx.status = result.status;
  ctx.body = result.body;
};
