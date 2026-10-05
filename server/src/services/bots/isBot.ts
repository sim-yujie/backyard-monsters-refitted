import type { EntityManager } from "@mikro-orm/postgresql";

import { Bot, type BotState } from "../../database/models/bot.model.js";

/**
 * Answers already given, per request or job: each request runs in its own
 * forked entity manager (`RequestContext` in `server.ts`), so a cache keyed by
 * it lives exactly as long as the request. The global manager is never cached.
 */
const answers = new WeakMap<EntityManager, Map<number, BotState | null>>();

/**
 * The state of a user's `bym.bot` row, or null when there is none: one
 * primary-key lookup, remembered for the rest of the request. A row read
 * without a state counts as `active`.
 */
const botRowState = async (userid: number, em?: EntityManager): Promise<BotState | null> => {
  const context = (em ?? (await import("../../server.js")).postgres.em).getContext(false);
  const cached = context.global ? undefined : answers.get(context);
  const known = cached?.get(userid);
  if (known !== undefined) return known;

  const row = await context.findOne(Bot, { userid });
  const answer = row ? (row.state ?? "active") : null;

  if (!context.global) {
    if (cached) cached.set(userid, answer);
    else answers.set(context, new Map([[userid, answer]]));
  }
  return answer;
};

/**
 * Whether a user is a computer-run Map Room 1 neighbour (issue #235,
 * `docs/design/bot-neighbours.md` §5): a row in `bym.bot` that is not a
 * seeded Map Room 2 dev player's ({@link isSeededPlayer}), remembered for the
 * rest of the request.
 *
 * Server-only. The answer must never reach a client, directly or by a
 * difference in what a bot's responses contain (decision 3): a refusal for a
 * bot reads exactly as the same refusal for a real player would.
 *
 * `server.js` is imported only when no manager is given: importing it boots
 * the whole server, so a script or job passes its own `em`.
 *
 * @param {number} userid - The user to ask about
 * @param {EntityManager} em - The entity manager to read with (the request's by default)
 * @returns {Promise<boolean>} True when the user has a `bot` row that is not `seeded`
 */
export const isBot = async (userid: number, em?: EntityManager): Promise<boolean> => {
  const state = await botRowState(userid, em);
  return state !== null && state !== "seeded";
};

/**
 * Whether a user is one of the `db:seed:mr2` dev players whose yard the bot
 * sweep repairs and grows (issue #233, `seededPlayers.ts`). To everything
 * else they stay ordinary accounts: they can log in, and they get the notices
 * a real player gets.
 *
 * @param {number} userid - The user to ask about
 * @param {EntityManager} em - The entity manager to read with (the request's by default)
 * @returns {Promise<boolean>} True when the user's `bot` row is `seeded`
 */
export const isSeededPlayer = async (userid: number, em?: EntityManager): Promise<boolean> =>
  (await botRowState(userid, em)) === "seeded";
