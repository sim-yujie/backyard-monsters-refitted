import { AlliancePowerupType } from "../../../enums/Alliance.js";
import { BaseType } from "../../../enums/Base.js";
import { AttackLogs } from "../../../database/models/attacklogs.model.js";
import { Save } from "../../../database/models/save.model.js";
import { User } from "../../../database/models/user.model.js";
import { WorldMapCell } from "../../../database/models/worldmapcell.model.js";
import { postgres, redis } from "../../../server.js";
import { getCurrentDateTime } from "../../../utils/getCurrentDateTime.js";
import { runningPowerups } from "../../alliance/powerups.js";
import type { RevealedCell, SightSource } from "../../../game-rules/maproom/sight.js";
import {
  attackerRevealedCells,
  ownRevealedCells,
  ownSources,
  sightVersionOf,
  type OwnBaseSave,
} from "./sightBuilder.js";

/**
 * The Map Room 2 fog of war sight service (issue #329,
 * `docs/design/fog-of-war.md` §4, §9): a player's whole sight — their own
 * circles and always-visible cells, their alliance's union of the same, and
 * the bases of anyone who has ever attacked them — loaded from Postgres and
 * cached in Redis.
 *
 * Nobody reads {@link getPlayerSight} yet: WP2 wires it into `getarea`'s
 * redaction, the new `/worldmapv2/sight` route and the view gate. This WP
 * only has to get the rule right and keep it cheap to ask twice.
 *
 * `sightBuilder.ts` holds the database-free half: given a save's own fields
 * and its outposts' flinger levels, what circles and cells it contributes.
 */

/** Per-player sight: `sight:<uid>`. Own sources and revealed cells only — the alliance union is cached separately. */
export const playerSightKey = (userid: number): string => `sight:${userid}`;

/** Per-alliance sight: `sight:ally:<allianceId>`. Every member's own sources and own cells, unioned. */
export const allianceSightKey = (allianceId: number): string => `sight:ally:${allianceId}`;

/** The cache's normal life (`fog-of-war.md` §9): never longer than this, and never past Declare War's end. */
export const SIGHT_CACHE_TTL_SECONDS = 30;

/** A player's complete sight, ready for `isVisible` (`game-rules/maproom/sight.ts`) to test a cell against. */
export interface PlayerSight {
  /** A short fingerprint of `sources` and `revealed`, so a caller can tell when either has changed. */
  sv: string;
  sources: SightSource[];
  revealed: RevealedCell[];
}

/** One cached half: a player's own, or an alliance's unioned members'. */
interface CachedHalf {
  sources: SightSource[];
  revealed: RevealedCell[];
}

const EMPTY_HALF: CachedHalf = { sources: [], revealed: [] };

/** Whether the alliance's Declare War is running, and when it ends, for the cache's TTL cap. */
interface DeclareWarStatus {
  active: boolean;
  /** Unix seconds; present only while {@link active}. */
  endsAt?: number;
}

const declareWarStatus = async (allianceId: User["alliance_id"]): Promise<DeclareWarStatus> => {
  if (!allianceId) return { active: false };

  const running = await runningPowerups(allianceId);
  const war = running.find(({ id }) => id === AlliancePowerupType.DECLARE_WAR);

  return war ? { active: true, endsAt: war.endtime } : { active: false };
};

/**
 * The cache life to use: the normal {@link SIGHT_CACHE_TTL_SECONDS}, or
 * however long is left of a running Declare War if that is sooner, so a
 * cached sight can never outlive the extra reach it was built with
 * (`fog-of-war.md` §9). At least a second, so an about-to-expire war never
 * caches as already gone.
 */
const cacheTtl = (war: DeclareWarStatus): number => {
  if (!war.active || war.endsAt === undefined) return SIGHT_CACHE_TTL_SECONDS;

  return Math.max(1, Math.min(SIGHT_CACHE_TTL_SECONDS, war.endsAt - getCurrentDateTime()));
};

/**
 * Flinger level per outpost `baseid`, for whichever outposts the caller asks
 * about (one player's own, or every member of an alliance's combined).
 *
 * @param baseids - The outposts whose flinger levels decide their reach.
 */
const outpostFlingerLevels = async (
  baseids: readonly string[],
): Promise<Map<string, number | undefined>> => {
  const unique = [...new Set(baseids)];
  if (!unique.length) return new Map();

  const rows = await postgres.em.find(Save, { baseid: { $in: unique } }, { fields: ["baseid", "flinger"] });

  return new Map(rows.map(({ baseid, flinger }) => [baseid, flinger]));
};

/**
 * Every base, on `worldid`, owned by someone who has ever attacked `userid`
 * (`bym.attack_logs`, `defender_userid = userid`; an outpost attack logs the
 * same `defender_userid` as the owner's main yard, so those count too).
 * Never expires and is never pruned by date.
 *
 * @param userid - The player being asked about.
 * @param worldid - Their Map Room 2 world.
 */
const attackerBasesOn = async (
  userid: number,
  worldid: string,
): Promise<{ x: number; y: number }[]> => {
  const logs = await postgres.em.find(AttackLogs, { defender_userid: userid }, { fields: ["attacker_userid"] });
  const attackerIds = [...new Set(logs.map(({ attacker_userid }) => attacker_userid))];
  if (!attackerIds.length) return [];

  const bases = await postgres.em.find(
    WorldMapCell,
    { world: worldid, uid: { $in: attackerIds } },
    { fields: ["x", "y"] },
  );

  return bases.map(({ x, y }) => ({ x, y }));
};

/** The fields `loadOwnSight` and `loadAllianceSight` need off a main save. */
const SIGHT_SAVE_FIELDS = ["homebase", "flinger", "outposts", "worldid"] as const;

const asOwnBaseSave = (save: Pick<Save, "homebase" | "flinger" | "outposts">): OwnBaseSave => ({
  homebase: save.homebase,
  flinger: save.flinger,
  outposts: save.outposts ?? [],
});

/**
 * `user`'s own sight, uncached: their main yard and outposts' circles, plus
 * their own cells and every attacker's base as revealed cells.
 *
 * @param user - The player, with `user.save` already populated
 *   ({@link SIGHT_SAVE_FIELDS}).
 * @param declareWar - Whether the player's alliance has Declare War running.
 */
const loadOwnSight = async (user: User, declareWar: boolean): Promise<CachedHalf> => {
  const save = user.save;
  if (!save?.worldid) return EMPTY_HALF;

  const baseSave = asOwnBaseSave(save);
  const outpostIds = (save.outposts ?? []).map(([, , baseid]) => baseid);

  const [flingerLevels, attackerBases] = await Promise.all([
    outpostFlingerLevels(outpostIds),
    attackerBasesOn(user.userid, save.worldid),
  ]);

  return {
    sources: ownSources(baseSave, flingerLevels, declareWar),
    revealed: [...ownRevealedCells(baseSave), ...attackerRevealedCells(attackerBases)],
  };
};

/**
 * An alliance's unioned sight, uncached: every member on `worldid`'s own
 * circles and own cells (`fog-of-war.md` §3 rule 3 — rules 1 and 2 shared,
 * not rule 4: each player keeps their own attacker history private).
 *
 * @param allianceId - The alliance.
 * @param worldid - Only members on this world contribute (`fog-of-war.md` §8).
 * @param declareWar - Whether the alliance has Declare War running.
 */
const loadAllianceSight = async (
  allianceId: number,
  worldid: string,
  declareWar: boolean,
): Promise<CachedHalf> => {
  const members = await postgres.em.find(User, { alliance_id: allianceId }, { fields: ["userid"] });
  const memberIds = members.map(({ userid }) => userid);
  if (!memberIds.length) return EMPTY_HALF;

  const saves = await postgres.em.find(
    Save,
    { type: BaseType.MAIN, userid: { $in: memberIds }, worldid },
    { fields: SIGHT_SAVE_FIELDS },
  );

  const outpostIds = saves.flatMap((save) => (save.outposts ?? []).map(([, , baseid]) => baseid));
  const flingerLevels = await outpostFlingerLevels(outpostIds);

  const sources: SightSource[] = [];
  const revealed: RevealedCell[] = [];

  for (const save of saves) {
    const baseSave = asOwnBaseSave(save);
    sources.push(...ownSources(baseSave, flingerLevels, declareWar));
    revealed.push(...ownRevealedCells(baseSave));
  }

  return { sources, revealed };
};

/** Reads a cached half, or null on a miss or a value Redis can no longer parse. */
const readCached = async (key: string): Promise<CachedHalf | null> => {
  const raw = await redis.get(key);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as CachedHalf;
  } catch {
    return null;
  }
};

const cachedOwnSight = async (user: User, war: DeclareWarStatus): Promise<CachedHalf> => {
  const key = playerSightKey(user.userid);
  const cached = await readCached(key);
  if (cached) return cached;

  const fresh = await loadOwnSight(user, war.active);
  await redis.setex(key, cacheTtl(war), JSON.stringify(fresh));
  return fresh;
};

const cachedAllianceSight = async (
  allianceId: number,
  worldid: string,
  war: DeclareWarStatus,
): Promise<CachedHalf> => {
  const key = allianceSightKey(allianceId);
  const cached = await readCached(key);
  if (cached) return cached;

  const fresh = await loadAllianceSight(allianceId, worldid, war.active);
  await redis.setex(key, cacheTtl(war), JSON.stringify(fresh));
  return fresh;
};

/**
 * A player's complete sight: their own circles and cells, their alliance's
 * union of the same, and every attacker's base — cached in Redis, 30 seconds
 * at most and never past a running Declare War's end (`fog-of-war.md` §9).
 *
 * A player with no save yet, or a save never placed on a Map Room 2 world,
 * sees nothing: an empty sight, not an error (`emptyAreaResponse.ts` already
 * treats that the same way).
 *
 * @param user - The player. `user.save` is populated here if it is not
 *   already (`user.alliance_id` is a plain column, always loaded).
 */
export const getPlayerSight = async (user: User): Promise<PlayerSight> => {
  await postgres.em.populate(user, ["save"], {
    fields: ["save.basesaveid", ...SIGHT_SAVE_FIELDS.map((field) => `save.${field}` as const)],
  });

  const save = user.save;
  if (!save?.worldid) return { sv: sightVersionOf([], []), sources: [], revealed: [] };

  const war = await declareWarStatus(user.alliance_id);

  const own = await cachedOwnSight(user, war);
  const ally = user.alliance_id
    ? await cachedAllianceSight(user.alliance_id, save.worldid, war)
    : EMPTY_HALF;

  const sources = [...own.sources, ...ally.sources];
  const revealed = [...own.revealed, ...ally.revealed];

  return { sv: sightVersionOf(sources, revealed), sources, revealed };
};

/**
 * Drops a player's cached own sight: their flinger level changed, they won,
 * lost or relocated a base, or a new attack log just named them as defender
 * (`fog-of-war.md` §9). Never touches their alliance's cache.
 *
 * @param userid - The player whose sight changed.
 */
export const invalidatePlayerSight = (userid: number): Promise<number> =>
  redis.del(playerSightKey(userid));

/**
 * Drops an alliance's cached unioned sight: a member joined or left
 * (`fog-of-war.md` §9). Declare War starting also invalidates it, so the
 * alliance's extra reach is not served stale for up to 30 seconds.
 *
 * @param allianceId - The alliance whose membership or Declare War changed.
 */
export const invalidateAllianceSight = (allianceId: number): Promise<number> =>
  redis.del(allianceSightKey(allianceId));

/** A player's alliance, read fresh for a caller holding only their id. */
const allianceIdOf = async (userid: number): Promise<Pick<User, "userid" | "alliance_id">> => {
  const row = await postgres.em.findOne(User, { userid }, { fields: ["userid", "alliance_id"] });
  return { userid, alliance_id: row?.alliance_id ?? null };
};

/**
 * Drops a player's own cached sight and, when they have one, their
 * alliance's cached union too: a player's own sources or revealed cells
 * changed (a flinger level, a won, lost or relocated base), so whatever the
 * alliance cache combined them into is stale as well (`fog-of-war.md` §9).
 * `invalidatePlayerSight`/`invalidateAllianceSight` stay the right call on
 * their own where only one side moved (an attacker's revealed base is never
 * shared into the alliance union; a Declare War start touches no member's
 * own sources).
 *
 * @param who - The affected player, already loaded (`alliance_id` read
 *   straight off it), or just their id for a caller holding only the other
 *   side's `Save` (a takeover's previous owner, a relocate invite's
 *   inviter).
 */
export const invalidateSight = async (who: number | Pick<User, "userid" | "alliance_id">): Promise<void> => {
  const { userid, alliance_id } = typeof who === "number" ? await allianceIdOf(who) : who;

  await invalidatePlayerSight(userid);
  if (alliance_id) await invalidateAllianceSight(alliance_id);
};

/**
 * {@link invalidateSight}, but only when a save's `flinger` actually moved —
 * `syncDerivedLevels` runs on every yard write regardless, and most leave it
 * unchanged (`derivedLevels.ts`).
 *
 * @param user - The save's owner (an outpost's own flinger level is cached
 *   under its main yard owner's sight, the same key `playerSightKey` uses).
 * @param before - `save.flinger` read before the write that might have
 *   changed it.
 * @param after - `save.flinger` read after.
 */
export const invalidateSightIfFlingerChanged = async (
  user: Pick<User, "userid" | "alliance_id">,
  before: number | undefined,
  after: number | undefined,
): Promise<void> => {
  if (before === after) return;
  await invalidateSight(user);
};
