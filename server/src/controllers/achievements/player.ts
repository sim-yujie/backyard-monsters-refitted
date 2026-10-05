import type { EntityManager } from "@mikro-orm/core";
import z from "zod";
import { User } from "../../database/models/user.model.js";
import { Status } from "../../enums/StatusCodes.js";
import { VIEW_SAVE_FIELDS } from "../../services/achievements/record.js";
import { publicAchievements, readPublicRecord } from "../../services/achievements/view.js";

/**
 * `GET /api/:apiVersion/bm/achievements/player/:userid`: another player's
 * achievements, as the Map Room panels and the read-only screen show them
 * (`docs/design/achievements.md` §9.2, issue #204, WP4). A function of an
 * entity manager so it runs under test; `routes.ts` binds it to Koa.
 *
 * Only what is earned and when: no progress, no Shiny. Read-only: a record
 * never worked out (a bot, a seeded player, anyone not loaded since) gets the
 * backfill worked out on the fly and nothing is stored. A banned or unknown
 * player, or one with no yard, is `404`.
 */

export interface PlayerAchievementsAnswer {
  status: number;
  body: Record<string, unknown>;
}

const ParamsSchema = z.object({ userid: z.coerce.number().int().positive() });

/** The player's name and ban, and the save columns the record reads. */
const PLAYER_FIELDS = [
  "userid",
  "username",
  "banned",
  ...VIEW_SAVE_FIELDS.map((field) => `save.${field}` as const),
] as const;

const notFound = (): PlayerAchievementsAnswer => ({
  status: Status.NOT_FOUND,
  body: { error: "That player could not be found.", reason: "notFound" },
});

/**
 * @param em - Any entity manager; only reads.
 * @param rawParams - The route params (`userid`).
 * @param now - Unix seconds, for a backfill worked out on the fly.
 */
export const playerAchievementsAnswer = async (
  em: EntityManager,
  rawParams: unknown,
  now: number
): Promise<PlayerAchievementsAnswer> => {
  const parsed = ParamsSchema.safeParse(rawParams ?? {});
  if (!parsed.success) return notFound();

  // Only the columns the record and its backfill read, not the whole yard.
  const player = await em.findOne(
    User,
    { userid: parsed.data.userid },
    { populate: ["save"], fields: PLAYER_FIELDS }
  );
  const main = player?.save;
  if (!player || player.banned || !main) return notFound();

  const record = await readPublicRecord(em, main, now);
  return {
    status: Status.OK,
    body: { error: 0, userid: player.userid, name: player.username, ...publicAchievements(record) },
  };
};
