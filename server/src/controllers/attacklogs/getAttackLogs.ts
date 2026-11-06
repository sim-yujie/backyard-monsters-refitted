import type { FilterQuery } from "@mikro-orm/core";
import { Status } from "../../enums/StatusCodes.js";
import { loadFailureErr } from "../../errors/errors.js";
import { AttackLogs } from "../../database/models/attacklogs.model.js";
import { postgres, redis } from "../../server.js";
import type { KoaController } from "../../utils/KoaController.js";
import { AttackLogFilter } from "../../enums/AttackLogFilter.js";
import { User } from "../../database/models/user.model.js";

/**
 * Time-to-live (TTL) for attack logs cache in Redis.
 * 30 minutes (1800 seconds).
 * @constant {number}
 */
const AL_CACHE_TTL = 1800;

const FILTERS = new Set<string>(Object.values(AttackLogFilter));

/**
 * The attack log filter a request asks for: one of `AttackLogFilter`, and
 * `both` for anything else, an absent or repeated `filter` included.
 *
 * @param {unknown} filter - The raw `filter` query value.
 * @returns {AttackLogFilter} The filter to read and cache by.
 */
export const attackLogFilterOf = (filter: unknown): AttackLogFilter =>
  typeof filter === "string" && FILTERS.has(filter) ? (filter as AttackLogFilter) : AttackLogFilter.BOTH;

/**
 * Controller to handle the retrieval of attack logs based on authenticated user ID and filter type.
 *
 * @param {Koa.Context} ctx - The Koa context object.
 * @returns {Promise<void>} - A promise that resolves when the operation is complete.
 */
export const getAttackLogs: KoaController = async (ctx) => {
  const { filter } = ctx.query;
  const { userid }: User = ctx.authUser;

  // The cache key is built from the checked filter only, one of three values:
  // the raw query made a new key, each holding up to 50 full reports, for
  // every value a player sent (security audit 2026-10-29, M3).
  const filterType = attackLogFilterOf(filter);
  const cacheKey = `attackLogs:${userid}:${filterType}`;

  try {
    const cachedAttackLogs = await redis.get(cacheKey);

    if (cachedAttackLogs) {
      ctx.status = Status.OK;
      ctx.body = { attackLogs: JSON.parse(cachedAttackLogs) };
      return;
    }

    let whereCondition: FilterQuery<AttackLogs>;

    switch (filterType) {
      case AttackLogFilter.MY_ATTACKS:
        whereCondition = { attacker_userid: userid };
        break;

      case AttackLogFilter.MY_DEFENCES:
        whereCondition = { defender_userid: userid };
        break;

      case AttackLogFilter.BOTH:
        whereCondition = {
          $or: [
            { attacker_userid: userid },
            { defender_userid: userid },
          ],
        };
        break;
    }

    const attackLogs = await postgres.em.find(AttackLogs, whereCondition, {
      orderBy: { attacktime: "DESC" },
      limit: 50,
    });

    await redis.setex(cacheKey, AL_CACHE_TTL, JSON.stringify(attackLogs));

    ctx.status = Status.OK;
    ctx.body = { attackLogs };
  } catch (error) {
    throw loadFailureErr();
  }
};
