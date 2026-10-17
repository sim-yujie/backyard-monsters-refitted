import { postgres } from "../../server.js";
import type { KoaController } from "../../utils/KoaController.js";
import { listAnswer, replayAnswer } from "./defences.js";

/** The Defences routes bound to Koa and `postgres.em` (issue #360); what each does is in `defences.ts`. */
export const getDefences: KoaController = async (ctx) => {
  const result = await listAnswer(postgres.em, ctx.authUser);
  ctx.status = result.status;
  ctx.body = result.body;
};

export const getDefenceReplay: KoaController = async (ctx) => {
  const result = await replayAnswer(postgres.em, ctx.authUser, ctx.params);
  ctx.status = result.status;
  ctx.body = result.body;
};
