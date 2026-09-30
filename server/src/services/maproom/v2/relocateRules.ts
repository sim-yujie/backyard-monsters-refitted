import { BaseType } from "../../../enums/Base.js";
import { MapRoomCell, MapRoomVersion } from "../../../enums/MapRoom.js";
import type { JsonObject } from "../../../types/JsonObject.js";
import type { BuildingDataMap, BuildingHealthData } from "../../../types/BuildingData.js";
import { isTrap, isWall } from "../../../game-rules/combat/damagePercent.js";
import { toCombatYard, type BuildingHealthMap } from "../../../game-rules/combat/types.js";
import { RESOURCE_KEYS } from "../../base/updateResources.js";

/**
 * The rules for moving a main yard onto one of the player's own Map Room 2
 * outposts (`POST /base/migrate`, `type=outpost`, issue #181).
 *
 * Flash decides all of this in the client and posts only the outcome: the
 * relocate button exists only on the player's own outposts (`PopupInfoMine.as:163-168`
 * shows `bRelocate` for `_base == 3`, and PopupInfoMine only ever opens on a
 * cell that is `_mine`, `MapRoomCell.as:1006-1012`), and the price is the
 * popup's own constant (`PopupRelocateMe.as:65-66`). The server used to trust
 * the posted `baseid` and price outright, so these rules are the server's copy
 * of those client checks. They are pure so they can be tested without a
 * database; `migrateBase.ts` loads the rows and applies the answer.
 */

/**
 * The resource price, charged in full for each of r1..r4
 * (`PopupRelocateMe.as:65`, `:76` shows it on all four, `:143-146` takes it
 * from all four, `:186` refuses if any one is short).
 */
export const RELOCATE_RESOURCE_COST = 30_000_000;

/** The Shiny price instead (`PopupRelocateMe.as:66`, `:140`, `:178`). */
export const RELOCATE_SHINY_COST = 1500;

/**
 * Seconds before a player may move their main yard again. The server's own
 * figure: Flash only reports what the server answers
 * (`PopupRelocateMe.as:121-122`, `movebase_warning`).
 */
export const RELOCATE_COOLDOWN = 24 * 60 * 60;

/** Why a relocation was refused. */
export type RelocateRefusal =
  | "notMapRoom2"
  | "inAlliance"
  | "hasOutposts"
  | "yardStanding"
  | "noHomeCell"
  | "notFound"
  | "wrongWorld"
  | "notAnOutpost"
  | "notYours"
  | "underAttack"
  | "notEnoughShiny"
  | "notEnoughResources";

/** The target cell and its save, as far as the rules need them. */
export interface RelocateTarget {
  cell: {
    uid: number;
    base_type: number;
    map_version: number;
    /** The uuid of the world the cell is in. */
    worldid: string;
  } | null;
  save: {
    baseid: string;
    userid: number;
    saveuserid: number;
    type: string;
  } | null;
}

export interface RelocateTargetInput extends RelocateTarget {
  /** The caller's userid. */
  userid: number;
  /** The world the caller's main yard is in. */
  worldid: string | null | undefined;
  /** The caller's `Save.outposts`, `[x, y, baseid]` each. */
  outposts: readonly (readonly [number, number, string])[];
  /** Whether an attack on the target outpost is running right now. */
  underAttack: boolean;
}

/**
 * Whether the named cell may be the new home: one of the caller's own Map
 * Room 2 outposts, in the caller's world, with nobody attacking it.
 *
 * The attack check is the server's, not Flash's: the popup does not look, but
 * a relocation deletes the outpost's save row, and an attack running on it
 * would then have nowhere to land.
 *
 * @param {RelocateTargetInput} input - The caller and the target.
 * @returns {RelocateRefusal | null} Why not, or null when it may be.
 */
export const relocateTargetRefusal = ({
  userid,
  worldid,
  outposts,
  cell,
  save,
  underAttack,
}: RelocateTargetInput): RelocateRefusal | null => {
  if (!cell || !save) return "notFound";

  if (!worldid || cell.worldid !== worldid) return "wrongWorld";

  if (
    cell.map_version !== MapRoomVersion.V2 ||
    cell.base_type !== MapRoomCell.OUTPOST ||
    save.type !== BaseType.OUTPOST
  )
    return "notAnOutpost";

  const listed = outposts.some(([, , id]) => String(id) === String(save.baseid));

  if (cell.uid !== userid || save.userid !== userid || save.saveuserid !== userid || !listed)
    return "notYours";

  if (underAttack) return "underAttack";

  return null;
};

/** How the player chose to pay: the popup's two buttons (`PopupRelocateMe.as:61-64`, `:91-93`). */
export type RelocatePayment = "shiny" | "resources";

/** What the caller's main save holds, as far as paying goes. */
export interface RelocatePurse {
  credits: number;
  resources: JsonObject | null | undefined;
}

/** A relocation paid for: the purse after the charge, to write back. */
export type RelocateCharge =
  | { ok: true; credits: number; resources: JsonObject }
  | { ok: false; reason: "notEnoughShiny" | "notEnoughResources" };

/** What a move costs: this much Shiny, or this much of each resource. */
export interface RelocatePrice {
  shiny: number;
  resources: number;
}

/** Moving onto one's own outpost (`PopupRelocateMe.as:65-66`). */
export const RELOCATE_PRICE: RelocatePrice = { shiny: RELOCATE_SHINY_COST, resources: RELOCATE_RESOURCE_COST };

/**
 * Charges the relocation at the server's price, whatever the client posted.
 *
 * @param {RelocatePurse} purse - The caller's credits and main resource pool.
 * @param {RelocatePayment} payment - Shiny or resources.
 * @param {RelocatePrice} price - Moving onto one's own outpost unless given; an
 *   invitation to move has its own (`inviteRules.ts`, #205).
 * @returns {RelocateCharge} The purse after paying, or why it cannot pay.
 */
export const chargeRelocation = (
  purse: RelocatePurse,
  payment: RelocatePayment,
  price: RelocatePrice = RELOCATE_PRICE
): RelocateCharge => {
  const resources: JsonObject = { ...(purse.resources ?? {}) };

  if (payment === "shiny") {
    if (!(purse.credits >= price.shiny)) return { ok: false, reason: "notEnoughShiny" };

    return { ok: true, credits: purse.credits - price.shiny, resources };
  }

  if (RESOURCE_KEYS.some((key) => !(Number(resources[key] ?? 0) >= price.resources)))
    return { ok: false, reason: "notEnoughResources" };

  for (const key of RESOURCE_KEYS) resources[key] = Number(resources[key]) - price.resources;

  return { ok: true, credits: purse.credits, resources };
};

/* ── type=random: the "empire overrun" move ─────────────────────────────── */

/**
 * The main yard must be below this share of its health for the free random
 * move (`BASE.as:2340-2341`, `hp < hpMax * 0.1`).
 */
export const RANDOM_RELOCATE_HEALTH_SHARE = 0.1;

/**
 * The main yard's health and its full health, summed the way Flash sums them
 * for the lost-main-base popup: every building but traps and walls
 * (`BASE.as:2333-2338`). Health is read the way the combat rules read it
 * (`toCombatYard`): the health map first, then the building's `hp`, else full.
 *
 * @param save - The main yard's two building maps.
 * @returns `{ hp, max }`.
 */
export const mainYardHealth = (save: {
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
}): { hp: number; max: number } => {
  const yard = toCombatYard({
    buildingdata: save.buildingdata as Parameters<typeof toCombatYard>[0]["buildingdata"],
    buildinghealthdata: save.buildinghealthdata as BuildingHealthMap | null | undefined,
  });

  let hp = 0;
  let max = 0;

  for (const building of yard.buildings) {
    if (isTrap(building.type) || isWall(building.type)) continue;
    hp += building.hp;
    max += building.maxHp;
  }

  return { hp, max };
};

export interface RandomRelocateInput {
  /** The caller's main save's `mapversion`: the move is Map Room 2's alone. */
  mapVersion: number | null | undefined;
  /** The caller's `alliance_id`. */
  allianceId: number | null | undefined;
  /** How many outposts the caller holds. */
  outpostCount: number;
  /** {@link mainYardHealth} of the caller's main yard, caught up to now. */
  health: { hp: number; max: number };
  /** Whether an attack on the main yard is running right now. */
  underAttack: boolean;
}

/**
 * Whether the caller may take the free random move (`type=random`), which
 * Flash offers only through PopupLostMainBase, on this gate
 * (`BASE.as:2340-2341`): no alliance, no outposts (the server keeps no
 * `empiredestroyed` override), and the main yard below 10% of its health. The
 * server also refuses while an attack on the main yard is running: leaving
 * the world deletes the rows that attack would save to, and to anyone not on
 * Map Room 2: the move leaves one Map Room 2 world for another, and would
 * otherwise drop a Map Room 1 or 3 player into Map Room 2.
 *
 * @param {RandomRelocateInput} input - The caller and their main yard.
 * @returns {RelocateRefusal | null} Why not, or null when they may.
 */
export const randomRelocateRefusal = ({
  mapVersion,
  allianceId,
  outpostCount,
  health,
  underAttack,
}: RandomRelocateInput): RelocateRefusal | null => {
  if (mapVersion !== MapRoomVersion.V2) return "notMapRoom2";

  if (allianceId) return "inAlliance";

  if (outpostCount > 0) return "hasOutposts";

  if (!(health.hp < health.max * RANDOM_RELOCATE_HEALTH_SHARE)) return "yardStanding";

  if (underAttack) return "underAttack";

  return null;
};
