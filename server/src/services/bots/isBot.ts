import type { EntityManager } from "@mikro-orm/postgresql";

import { Bot } from "../../database/models/bot.model.js";
import { postgres } from "../../server.js";

/**
 * Answers already given, per request or job: each request runs in its own
 * forked entity manager (`RequestContext` in `server.ts`), so a cache keyed by
 * it lives exactly as long as the request. The global manager is never cached.
 */
const answers = new WeakMap<EntityManager, Map<number, boolean>>();

/**
 * Whether a user is a computer-run Map Room 1 neighbour (issue #235,
 * `docs/design/bot-neighbours.md` §5): one primary-key lookup in `bym.bot`,
 * remembered for the rest of the request.
 *
 * Server-only. The answer must never reach a client, directly or by a
 * difference in what a bot's responses contain (decision 3): a refusal for a
 * bot reads exactly as the same refusal for a real player would.
 *
 * @param {number} userid - The user to ask about
 * @param {EntityManager} em - The entity manager to read with (the request's by default)
 * @returns {Promise<boolean>} True when the user has a `bot` row
 */
export const isBot = async (userid: number, em: EntityManager = postgres.em): Promise<boolean> => {
  const context = em.getContext(false);
  const cached = context.global ? undefined : answers.get(context);
  const known = cached?.get(userid);
  if (known !== undefined) return known;

  const answer = (await context.findOne(Bot, { userid })) !== null;

  if (!context.global) {
    if (cached) cached.set(userid, answer);
    else answers.set(context, new Map([[userid, answer]]));
  }
  return answer;
};
