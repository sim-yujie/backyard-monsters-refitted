import z from "zod";
import type { KoaController } from "../../../utils/KoaController.js";
import type { User } from "../../../database/models/user.model.js";
import { postgres } from "../../../server.js";
import { Status } from "../../../enums/StatusCodes.js";
import { discordAgeErr } from "../../../errors/errors.js";
import {
  autoAttackPlanFor,
  lastAutoAttackReplay,
  runAutoAttack,
} from "../../../services/base/autoAttack/autoAttack.js";

const AutoAttackSchema = z.object({
  /** The camp's base id, as the map carries it (`bid`). */
  baseid: z.string().regex(/^\d{1,20}$/),
});

/**
 * `POST /worldmapv2/autoattackplan { baseid }` (issue #221): the attack a
 * camp's Repeat attack would repeat, and what the player lacks for it.
 */
export const autoAttackPlan: KoaController = async (ctx) => {
  const { baseid } = AutoAttackSchema.parse(ctx.request.body);
  const user: User = ctx.authUser;
  await postgres.em.populate(user, ["save"]);

  ctx.status = Status.OK;
  ctx.body = { error: 0, ...(await autoAttackPlanFor(user, baseid)) };
};

/**
 * `POST /worldmapv2/autoattack { baseid }` (issue #221): repeats the player's
 * last hand-played attack on a camp of the same tribe and level, resolved by
 * the server at once. Rate-limited per player by the route
 * (`autoAttackLimiter`), and held to the Discord age rule an attack load is.
 */
export const autoAttack: KoaController = async (ctx) => {
  if (!ctx.meetsDiscordAgeCheck) throw discordAgeErr();
  const { baseid } = AutoAttackSchema.parse(ctx.request.body);

  ctx.status = Status.OK;
  ctx.body = { error: 0, ...(await runAutoAttack(ctx.authUser, baseid)) };
};

/**
 * `GET /worldmapv2/autoattackreplay` (issue #221): the player's last
 * auto-attack's battle, for Watch; `replay: null` once it has gone.
 */
export const autoAttackReplay: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  ctx.status = Status.OK;
  ctx.body = { error: 0, replay: await lastAutoAttackReplay(user.userid) };
};
