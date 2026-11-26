import z from "zod";
import type { KoaController } from "../../../utils/KoaController.js";
import type { User } from "../../../database/models/user.model.js";
import { postgres } from "../../../server.js";
import { Status } from "../../../enums/StatusCodes.js";
import { discordAgeErr } from "../../../errors/errors.js";
import { requirePageRules, stampOf } from "../../../services/base/combat/rulesStamp.js";
import {
  autoAttackPlanFor,
  lastAutoAttackReplay,
  runAutoAttack,
} from "../../../services/base/autoAttack/autoAttack.js";
import { smartMoveFor } from "../../../services/base/autoAttack/smartMove.js";
import { replayQueuePlace } from "../../../services/base/combat/replayRunner.js";

const AutoAttackSchema = z.object({
  /** The camp's base id, as the map carries it (`bid`). */
  baseid: z.string().regex(/^\d{1,20}$/),
});

const RunAutoAttackSchema = AutoAttackSchema.extend({
  /**
   * Smart Repeat attack: the `movesKey` of the moves the player agreed to.
   * Only compared with the server's own plan, never moved from.
   */
  moves: z.string().max(4_000).optional(),
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
 * `POST /worldmapv2/smartmove { baseid }` (smart moving, beta 9): what the
 * web offers when the player taps Attack on a camp: nothing (setting off, no
 * saved plan, army already in range), the moves that bring the saved plan's
 * army into range, or what cannot be gathered. Reads only; the moves are
 * made by the attack load itself (`smartmoves`, `baseLoad.ts`).
 */
export const smartMove: KoaController = async (ctx) => {
  const { baseid } = AutoAttackSchema.parse(ctx.request.body);
  const user: User = ctx.authUser;
  await postgres.em.populate(user, ["save"]);

  ctx.status = Status.OK;
  ctx.body = { error: 0, ...(await smartMoveFor(user, baseid)) };
};

/**
 * `POST /worldmapv2/autoattack { baseid }` (issue #221): repeats the player's
 * last hand-played attack on a camp of the same tribe and level, resolved by
 * the server at once. Rate-limited per player by the route
 * (`autoAttackLimiter`), and held to the Discord age rule an attack load is.
 */
export const autoAttack: KoaController = async (ctx) => {
  if (!ctx.meetsDiscordAgeCheck) throw discordAgeErr();
  const { baseid, moves } = RunAutoAttackSchema.parse(ctx.request.body);
  // The server fights a Repeat attack itself, so an old page cannot change its
  // result; it is refused all the same, as every attack start is, so Watch
  // never plays the server's battle on older rules (owner's fix 1, 23 Nov 2026).
  requirePageRules(ctx, ctx.authUser, stampOf(ctx.request.body), "worldmapv2/autoattack");

  // A player who closes the game while in the battle line gives up their place.
  const gone = new AbortController();
  const onClose = () => {
    if (!ctx.res.writableEnded) gone.abort();
  };
  // (A test's bare context has no response stream.)
  const res = ctx.res as typeof ctx.res | undefined;
  res?.once?.("close", onClose);
  try {
    const result = await runAutoAttack(ctx.authUser, baseid, moves, gone.signal);
    ctx.status = Status.OK;
    ctx.body = { error: 0, ...result };
  } finally {
    res?.off?.("close", onClose);
  }
};

/**
 * `GET /worldmapv2/autoattackqueue` (patch 9.1): the player's place in the
 * battle line while their Repeat attack waits (1 = next), or null. The
 * working bar asks about once a second while the Repeat is out; it reads
 * memory only.
 */
export const autoAttackQueue: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  ctx.status = Status.OK;
  ctx.body = { error: 0, place: replayQueuePlace(user.userid) };
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
