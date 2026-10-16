import { gunzipSync, gzipSync } from "node:zlib";

import type { Save } from "../../database/models/save.model.js";
import { BaseType } from "../../enums/Base.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";
import { redis } from "../../server.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { ATTACK_CHECKPOINT_TTL } from "../base/attackCheckpoint.js";

/**
 * The attack load a defence replay is played on (`docs/design/defence-replays.md`
 * §5, issue #359): kept in Redis from the moment the attack load is served
 * until the attack lands, by the attacker's final save or by the finaliser,
 * which may be days later after a server restart. It lives as long as the
 * checkpoint can (`ATTACK_CHECKPOINT_TTL`) and goes when the attack lands.
 *
 * Only {@link DEFENCE_REPLAY_LOAD_FIELDS} are kept: what the attack scene reads
 * to draw the yard and build the battle. Never the defender's credits, chat,
 * store items, quests or notifications, and nothing that could tell a hidden
 * bot from a player.
 */

/** One per defender row: attacks on one yard cannot overlap. */
export const defenceReplayLoadKey = (basesaveid: number): string => `defence-replay-load:${basesaveid}`;

/**
 * The attack load's fields a replay keeps, as the web client reads them:
 * `readYard` (`game/yard/yardModel.ts`) draws the yard from the first group,
 * and `AttackSession.load` builds the battle from the second.
 */
export const DEFENCE_REPLAY_LOAD_FIELDS = [
  // The yard as drawn: its kind, name and level, buildings, health and pool,
  // the caged champion, the mushrooms, and the clock its countdowns run from.
  "type",
  "basename",
  "level",
  "buildingdata",
  "buildinghealthdata",
  "resources",
  "champion",
  "mushrooms",
  "savetime",
  "currenttime",
  // The battle as served (issues #167, #179, #195, #201, #219, #352).
  "cellheight",
  "defenderforces",
  "attpowerups",
  "attackerlevel",
  "attackeracademy",
  "attackerranks",
  "attackerbrains",
] as const;

/**
 * The attack load cut down to {@link DEFENCE_REPLAY_LOAD_FIELDS}, plus the one
 * purchase the yard's drawing reads: its expansion (`storedata.ENL`, the yard's
 * size). The rest of `storedata` is the defender's shop history and stays out.
 *
 * @param response - The attack load as served.
 */
export const defenceReplayLoadOf = (response: Readonly<Record<string, unknown>>): JsonObject => {
  const load: JsonObject = {};
  for (const field of DEFENCE_REPLAY_LOAD_FIELDS) {
    if (response[field] !== undefined) load[field] = response[field] as JsonObject[string];
  }
  const storedata = response.storedata as Record<string, unknown> | null | undefined;
  if (storedata && typeof storedata === "object" && storedata.ENL !== undefined) {
    load.storedata = { ENL: storedata.ENL as JsonObject[string] };
  }
  return load;
};

/**
 * Whether an attack on this yard by this account is one a replay is kept of
 * [owner, decision 1]: another account's Map Room 2 main yard. Nobody is asked
 * whether either side is a bot (§9).
 *
 * @param yard - The defender's row.
 * @param attackerid - The attacking account.
 */
export const isDefenceReplayTarget = (
  yard: Pick<Save, "type" | "mapversion" | "saveuserid">,
  attackerid: number,
): boolean =>
  yard.type === BaseType.MAIN &&
  yard.mapversion === MapRoomVersion.V2 &&
  Boolean(yard.saveuserid) &&
  yard.saveuserid !== attackerid;

/** The stored value: which attack it was served for, and the load, gzipped. */
interface StoredLoad {
  readonly attackid: number;
  readonly load: string;
}

/**
 * Keeps an attack load for its replay. Overwrites the yard's last one: a new
 * attack on the yard is a new battle.
 *
 * @param basesaveid - The defender row.
 * @param attackid - The attack the load was served for.
 * @param load - The load, already cut down ({@link defenceReplayLoadOf}).
 */
export const keepDefenceReplayLoad = async (basesaveid: number, attackid: number, load: JsonObject): Promise<void> => {
  const stored: StoredLoad = { attackid, load: gzipSync(JSON.stringify(load)).toString("base64") };
  await redis.setex(defenceReplayLoadKey(basesaveid), ATTACK_CHECKPOINT_TTL, JSON.stringify(stored));
};

/**
 * The load kept for this attack, or null when there is none: never kept,
 * lost with Redis, or kept for another attack on the same yard.
 *
 * @param basesaveid - The defender row.
 * @param attackid - The attack that landed.
 */
export const readDefenceReplayLoad = async (basesaveid: number, attackid: number): Promise<JsonObject | null> => {
  const raw = await redis.get(defenceReplayLoadKey(basesaveid));
  if (!raw) return null;
  const stored = JSON.parse(raw) as Partial<StoredLoad>;
  if (stored.attackid !== attackid || typeof stored.load !== "string") return null;
  const load = JSON.parse(gunzipSync(Buffer.from(stored.load, "base64")).toString("utf8"));
  return load && typeof load === "object" && !Array.isArray(load) ? (load as JsonObject) : null;
};

/**
 * Forgets the yard's kept load once its attack has landed. Only the landings
 * call it, not every `discardCheckpoint`: a stale checkpoint is dropped when
 * a newer attack may already have kept its own load under the same key.
 *
 * @param basesaveid - The defender row.
 */
export const discardDefenceReplayLoad = async (basesaveid: number): Promise<void> => {
  await redis.del(defenceReplayLoadKey(basesaveid));
};
