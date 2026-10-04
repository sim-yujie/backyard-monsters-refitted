import z from "zod";
import type { KoaController } from "../../utils/KoaController.js";
import { Status } from "../../enums/StatusCodes.js";
import { User } from "../../database/models/user.model.js";
import { InfernoMaproom } from "../../database/models/infernomaproom.model.js";
import { Maproom } from "../../database/models/maproom.model.js";
import { postgres } from "../../server.js";
import { BaseType } from "../../enums/Base.js";
import { findInfernoNeighbours } from "../../services/maproom/inferno/findInfernoNeighbours.js";
import { findOverworldNeighbours } from "../../services/maproom/v1/findOverworldNeighbours.js";
import { updateNeighbourData } from "../../services/maproom/updateNeighbourData.js";
import {
  carryAttackCounters,
  droppedToday,
  needsAttackableRetry,
  needsNewNeighbours,
} from "../../services/maproom/neighbourCache.js";
import type { Save } from "../../database/models/save.model.js";
import type { NeighbourData } from "../../types/NeighbourData.js";

const GetNeighboursSchema = z.object({ type: z.string().optional() });

/**
 * Controller to get neighbours for PvP matchmaking.
 * Branches on the type request body param:
 * 
 * 1. inferno - Inferno map room neighbours (cached, level-ranged, cross-world)
 * 2. absent/other - MR1 overworld neighbours (cached, level-ranged, global)
 *
 * @param {Context} ctx - Koa context object containing authenticated user and request/response
 * @returns {Promise<void>} - Sets response body with neighbour data or error
 */
export const getNeighbours: KoaController = async (ctx) => {
  const { type } = GetNeighboursSchema.parse(ctx.request.body);

  if (type === BaseType.INFERNO) {
    return getInfernoNeighbours(ctx);
  } else {
    return getOverworldNeighbours(ctx);
  }
};

/**
 * Handles neighbour lookups for the Inferno Map Room.
 *
 * Serves the cached neighbour list if fresh; otherwise re-runs the search.
 * Uses a short 30-minute retry window when fewer than 10 neighbours are cached,
 * and the full 2-week TTL once the list is healthy.
 *
 * @param {Context} ctx - Koa context containing the authenticated user
 * @returns {Promise<void>} - Sets response body with inferno neighbour data
 */
const getInfernoNeighbours: KoaController = async (ctx) => {
  const user: User = ctx.authUser;

  await postgres.em.populate(user, ["infernosave"]);

  const infernoMaproom = await postgres.em.findOne(InfernoMaproom, { userid: user.userid });

  if (!infernoMaproom) throw new Error("Inferno maproom not found.");

  const currentDate = new Date();

  const getNewNeighbours = needsNewNeighbours(infernoMaproom, currentDate);

  if (getNewNeighbours) {
    const foundNeighbours = await findInfernoNeighbours(user);

    // Preserve previous attack data on attackers who may have attacked before defender seeded
    infernoMaproom.neighbors = carryAttackCounters(infernoMaproom.neighbors, foundNeighbours);

    infernoMaproom.neighborsLastCalculated = currentDate;
    postgres.em.persist(infernoMaproom);
    await postgres.em.flush();
  }

  const neighbours = await updateNeighbourData(infernoMaproom.neighbors, BaseType.INFERNO);

  ctx.status = Status.OK;
  ctx.body = { error: 0, wmbases: [], bases: neighbours };
};

/**
 * Handles neighbour lookups for the MR1 Overworld Map Room.
 *
 * Serves the cached neighbour list if fresh; otherwise re-runs the search.
 * Uses a short 30-minute retry window when fewer than 10 neighbours are cached,
 * and the full 2-week TTL once the list is healthy.
 *
 * @param {Context} ctx - Koa context containing the authenticated user
 * @returns {Promise<void>} - Sets response body with overworld neighbour data
 */
const getOverworldNeighbours: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  await postgres.em.populate(user, ["save"], { fields: ["save.points", "save.basevalue"] });

  const save = user.save;

  if (!save) {
    ctx.status = Status.OK;
    ctx.body = { error: 0, bases: [] };
    return;
  }

  const neighbours = await overworldNeighbours(user, save);

  ctx.status = Status.OK;
  ctx.body = { error: 0, wmbases: [], bases: neighbours };
};

/**
 * The player's Map Room 1 neighbours, live fields refreshed: the cached list
 * (re-searched when the cache has run out) run through `updateNeighbourData`.
 * Shared by `bm/neighbours/get` and the Map Room 1 read (`getMapRoom1.ts`).
 *
 * The list is also re-searched, once the 30-minute retry has passed, when
 * fewer than 5 of its neighbours can be attacked now (issue #236,
 * `docs/design/bot-neighbours.md` §4.3). Every re-search keeps the attack
 * counters of neighbours who stay on the list, and leaves out neighbours
 * dropped today by the 10 attacks a day cap (issue #247).
 *
 * @param {User} user - The player.
 * @param {Save} save - Their main save, with at least `points` and `basevalue`.
 * @returns {Promise<NeighbourData[]>} The neighbours.
 */
export const overworldNeighbours = async (user: User, save: Save): Promise<NeighbourData[]> => {
  let maproom = await postgres.em.findOne(Maproom, { userid: user.userid });

  // Initial Map Room 1 creation
  if (!maproom) maproom = await Maproom.setupMapRoomData(postgres.em, user);

  const currentDate = new Date();

  const research = async (cache: Maproom) => {
    const foundNeighbours = await findOverworldNeighbours(postgres.em, user, save, {
      now: currentDate,
      exclude: droppedToday(cache.droppedNeighbours, currentDate),
    });

    cache.neighbors = carryAttackCounters(cache.neighbors, foundNeighbours);
    cache.neighborsLastCalculated = currentDate;
    postgres.em.persist(cache);
    await postgres.em.flush();
  };

  if (needsNewNeighbours(maproom, currentDate)) {
    await research(maproom);
    return updateNeighbourData(maproom.neighbors, BaseType.MAIN, user.userid);
  }

  const neighbours = await updateNeighbourData(maproom.neighbors, BaseType.MAIN, user.userid);

  if (!needsAttackableRetry(neighbours, maproom.neighborsLastCalculated, currentDate)) return neighbours;

  await research(maproom);
  return updateNeighbourData(maproom.neighbors, BaseType.MAIN, user.userid);
};
