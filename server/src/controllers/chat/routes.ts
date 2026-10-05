import { getHistory } from "../../chat/chatHistory.js";
import { postgres } from "../../server.js";
import type { KoaController } from "../../utils/KoaController.js";
import { reportAnswer, yardAnswer } from "./chat.js";

/**
 * The chat box routes bound to Koa, `postgres.em` and the global channels'
 * Redis history (issue #282); what each does is in `chat.ts`.
 */
export const reportChatMessage: KoaController = async (ctx) => {
  const result = await reportAnswer(postgres.em, ctx.authUser, ctx.request.body, getHistory);
  ctx.status = result.status;
  ctx.body = result.body;
};

export const chatPlayerYard: KoaController = async (ctx) => {
  const result = await yardAnswer(postgres.em, ctx.request.query);
  ctx.status = result.status;
  ctx.body = result.body;
};
