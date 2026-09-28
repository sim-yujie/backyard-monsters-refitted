import { BaseType } from "../../../enums/Base.js";
import { MapRoomCell, MapRoomVersion } from "../../../enums/MapRoom.js";
import type { JsonObject } from "../../../types/JsonObject.js";
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

/**
 * Charges the relocation at the server's price, whatever the client posted.
 *
 * @param {RelocatePurse} purse - The caller's credits and main resource pool.
 * @param {RelocatePayment} payment - Shiny or resources.
 * @returns {RelocateCharge} The purse after paying, or why it cannot pay.
 */
export const chargeRelocation = (purse: RelocatePurse, payment: RelocatePayment): RelocateCharge => {
  const resources: JsonObject = { ...(purse.resources ?? {}) };

  if (payment === "shiny") {
    if (!(purse.credits >= RELOCATE_SHINY_COST)) return { ok: false, reason: "notEnoughShiny" };

    return { ok: true, credits: purse.credits - RELOCATE_SHINY_COST, resources };
  }

  if (RESOURCE_KEYS.some((key) => !(Number(resources[key] ?? 0) >= RELOCATE_RESOURCE_COST)))
    return { ok: false, reason: "notEnoughResources" };

  for (const key of RESOURCE_KEYS) resources[key] = Number(resources[key]) - RELOCATE_RESOURCE_COST;

  return { ok: true, credits: purse.credits, resources };
};
