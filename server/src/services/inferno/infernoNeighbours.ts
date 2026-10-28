import { LockMode, type EntityManager } from "@mikro-orm/core";

import { Bot } from "../../database/models/bot.model.js";
import { InfernoMaproom } from "../../database/models/infernomaproom.model.js";
import { Save } from "../../database/models/save.model.js";
import { User } from "../../database/models/user.model.js";
import { BaseType } from "../../enums/Base.js";
import type { AttackPermission } from "../../enums/MapRoom.js";
import type { NeighbourData } from "../../types/NeighbourData.js";
import { ATTACK_TIMEOUT } from "../base/isAttackActive.js";
import { friendsAmong } from "../friends/friendFlags.js";
import { createNeighbourData } from "../maproom/createNeighbourData.js";
import { needsAttackableRetry, needsNewNeighbours } from "../maproom/neighbourCache.js";
import { onlinePlayers } from "../user/online.js";
import { infernoYardLevel } from "./infernoTribes.js";
import {
  INFERNO_NEIGHBOUR_LIMIT,
  INFERNO_NEIGHBOUR_SEARCH,
  inInfernoRange,
  infernoAttackPermission,
  keepRevenge,
  vengeanceLeft,
} from "./infernoPvp.js";

/**
 * The Inferno map's other players (`docs/design/inferno.md` §2.7, WP 3.1):
 * the Inferno yards of real players within 7 levels of the player's, from
 * the 150 most recently changed, at most 25, from every world
 * (`findInfernoNeighbours.ts`). No computer-run neighbours for now (R10,
 * #383): a bot's yard is never listed.
 *
 * Only a yard its owner plays is listed: the one their main save names
 * (`baseid_inferno`). The list is kept in the player's `maproom_inferno` row
 * and searched again by the Map Room 1 rules (`neighbourCache.ts`): after two
 * weeks, or every 30 minutes while it is thin or fewer than 5 can be
 * attacked. A re-search keeps the attack counters, and every neighbour the
 * player still has revenge on (`keepRevenge`).
 *
 * What each one can be done to now is read fresh on every look, never from
 * the kept list: their yard's level, protection, an attack on it, whether
 * its owner is playing, and the friend flag.
 */

/** One neighbour as the Inferno map shows it. */
export interface InfernoNeighbourView {
  userid: number;
  /** Their Inferno yard's base id: what an attack or a view names. */
  baseid: string;
  name: string;
  pic: string;
  level: number;
  /** 1 while the owner is playing (the main yard's rule, #271), when they cannot be attacked. */
  online: 0 | 1;
  friend: 0 | 1;
  /** What the player can do to them now, in Flash's codes ({@link infernoAttackPermission}). */
  attackpermitted: AttackPermission;
  /** When their damage protection ends (unix seconds), 0 without any. */
  protecteduntil: number;
  /** Who is attacking them now, while they are attacked. */
  attacker: string;
  /** Attacks they made on the player, and the player on them. */
  attacksfrom: number;
  attacksto: number;
  /** Revenge left on them ({@link vengeanceLeft}). */
  vengeance: number;
}

/** The fields the search and the live view read off an Inferno yard. */
const YARD_FIELDS = [
  "userid",
  "baseid",
  "type",
  "points",
  "basevalue",
  "buildingdata",
  "protected",
  "attackid",
  "attacks",
  "lastupdateAt",
] as const;

/** An Inferno yard as the search and the live view read it. */
export type InfernoNeighbourYard = Pick<
  Save,
  "userid" | "baseid" | "points" | "basevalue" | "buildingdata" | "protected" | "attackid" | "attacks" | "lastupdateAt"
>;

/**
 * The live Inferno yards of `userids`, by owner: the one each owner's main
 * save names, of the Inferno type and theirs. Owners without one are left out.
 */
export const liveInfernoYards = async (
  em: EntityManager,
  userids: readonly number[]
): Promise<Map<number, InfernoNeighbourYard>> => {
  const yards = new Map<number, InfernoNeighbourYard>();
  if (userids.length === 0) return yards;
  const mains = await em.find(
    Save,
    { type: BaseType.MAIN, userid: { $in: [...userids] } },
    { fields: ["userid", "baseid_inferno"] }
  );
  const named = mains.filter((main) => Number(main.baseid_inferno) > 0);
  if (named.length === 0) return yards;
  const rows = await em.find(
    Save,
    { type: BaseType.INFERNO, baseid: { $in: named.map((main) => String(main.baseid_inferno)) } },
    { fields: [...YARD_FIELDS] }
  );
  for (const main of named) {
    const row = rows.find((one) => one.baseid === String(main.baseid_inferno) && one.userid === main.userid);
    if (row) yards.set(main.userid, row);
  }
  return yards;
};

/** Which of `userids` are computer-run (a `bot` row that is not a seeded dev player). */
const botsAmong = async (em: EntityManager, userids: readonly number[]): Promise<Set<number>> => {
  if (userids.length === 0) return new Set();
  const rows = await em.find(Bot, { userid: { $in: [...userids] } }, { fields: ["userid", "state"] });
  return new Set(rows.filter((row) => row.state !== "seeded").map((row) => Number(row.userid)));
};

/**
 * A fresh search for `userid`, whose Inferno yard is at level `mine` (the
 * rules in the file comment).
 */
export const searchInfernoNeighbours = async (
  em: EntityManager,
  userid: number,
  mine: number
): Promise<NeighbourData[]> => {
  const recent = await em.find(
    Save,
    { type: BaseType.INFERNO, userid: { $ne: userid } },
    { fields: [...YARD_FIELDS], orderBy: { lastupdateAt: "DESC" }, limit: INFERNO_NEIGHBOUR_SEARCH }
  );
  const owners = [...new Set(recent.map((row) => row.userid))];
  const [live, bots] = await Promise.all([liveInfernoYards(em, owners), botsAmong(em, owners)]);

  const picked: Array<{ row: InfernoNeighbourYard; level: number }> = [];
  for (const row of recent) {
    if (picked.length >= INFERNO_NEIGHBOUR_LIMIT) break;
    if (bots.has(row.userid) || live.get(row.userid)?.baseid !== row.baseid) continue;
    if (picked.some((one) => one.row.userid === row.userid)) continue;
    const level = infernoYardLevel(row);
    if (inInfernoRange(mine, level)) picked.push({ row, level });
  }
  if (picked.length === 0) return [];

  const users = await em.find(
    User,
    { userid: { $in: picked.map((one) => one.row.userid) } },
    { fields: ["userid", "username", "pic_square"] }
  );
  return picked.flatMap(({ row, level }) => {
    const owner = users.find((one) => one.userid === row.userid);
    return owner ? [createNeighbourData(row, owner, level)] : [];
  });
};

/**
 * What the player at level `mine` can do now to each neighbour on `list`,
 * read fresh (the file comment). A neighbour whose owner no longer plays an
 * Inferno yard is left out of the view; the kept list keeps them.
 */
export const infernoNeighbourViews = async (
  em: EntityManager,
  viewer: number,
  mine: number,
  list: readonly NeighbourData[],
  now: number
): Promise<InfernoNeighbourView[]> => {
  const ids = list.map((entry) => entry.userid);
  if (ids.length === 0) return [];
  const [yards, users, online, friends] = await Promise.all([
    liveInfernoYards(em, ids),
    em.find(User, { userid: { $in: ids } }, { fields: ["userid", "username", "pic_square"] }),
    onlinePlayers(ids, now),
    friendsAmong(em as never, viewer, ids),
  ]);
  return list.flatMap((entry) => {
    const yard = yards.get(entry.userid);
    if (!yard) return [];
    const owner = users.find((one) => one.userid === entry.userid);
    return [infernoNeighbourView(entry, yard, owner, mine, now, online.has(entry.userid), friends.has(entry.userid))];
  });
};

/** Whether `yard` is being attacked at `now`: `isAttackActive`, on the given clock. */
export const attackedAt = (yard: Pick<Save, "attackid" | "attacks">, now: number): boolean => {
  const last = yard.attacks?.at(-1);
  return Number(yard.attackid) !== 0 && Boolean(last) && now - Number(last!.starttime) < ATTACK_TIMEOUT;
};

/** One neighbour's view from their kept entry and their yard as it is now. */
export const infernoNeighbourView = (
  entry: Pick<NeighbourData, "userid" | "username" | "pic" | "attacksfrom" | "attacksto" | "retaliatecount">,
  yard: InfernoNeighbourYard,
  owner: Pick<User, "username" | "pic_square"> | undefined,
  mine: number,
  now: number,
  online: boolean,
  friend: boolean
): InfernoNeighbourView => {
  const level = infernoYardLevel(yard);
  const protectedUntil = Number(yard.protected) > now ? Number(yard.protected) : 0;
  const underAttack = attackedAt(yard, now);
  const vengeance = vengeanceLeft(entry);
  return {
    userid: entry.userid,
    baseid: yard.baseid,
    name: owner?.username ?? entry.username,
    pic: owner?.pic_square ?? entry.pic ?? "",
    level,
    online: online ? 1 : 0,
    friend: friend ? 1 : 0,
    attackpermitted: infernoAttackPermission({ mine, theirs: level, vengeance, protectedUntil, underAttack, now }),
    protecteduntil: protectedUntil,
    attacker: underAttack ? (yard.attacks.at(-1)?.name ?? "") : "",
    attacksfrom: Math.max(0, Math.floor(Number(entry.attacksfrom ?? 0))),
    attacksto: Math.max(0, Math.floor(Number(entry.attacksto ?? 0))),
    vengeance,
  };
};

/**
 * The player's Inferno neighbours as the map shows them: the kept list,
 * searched again when the rules say (the file comment), each read fresh. The
 * `maproom_inferno` row is made the first time; nothing else is written.
 *
 * @param mine - The player's Inferno yard level.
 * @param now - Unix seconds.
 */
export const loadInfernoNeighbours = async (
  em: EntityManager,
  userid: number,
  mine: number,
  now: number
): Promise<InfernoNeighbourView[]> => {
  const clock = new Date(now * 1000);
  const kept = await em.findOne(InfernoMaproom, { userid });
  const cache = { neighborsLastCalculated: kept?.neighborsLastCalculated, neighbors: kept?.neighbors ?? [] };
  let views = needsNewNeighbours(cache, clock) ? null : await infernoNeighbourViews(em, userid, mine, cache.neighbors, now);
  if (views && !needsAttackableRetry(views as unknown as NeighbourData[], cache.neighborsLastCalculated, clock)) return views;

  const found = await searchInfernoNeighbours(em, userid, mine);
  const neighbors = await em.transactional(async (tx) => {
    const row =
      (await tx.findOne(InfernoMaproom, { userid }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true })) ??
      tx.create(InfernoMaproom, { userid });
    row.neighbors = keepRevenge(row.neighbors ?? [], found);
    row.neighborsLastCalculated = clock;
    tx.persist(row);
    await tx.flush();
    return row.neighbors;
  });
  views = await infernoNeighbourViews(em, userid, mine, neighbors, now);
  return views;
};
