import { isInfernoMonster, monsterEntry } from "../../game-data/monsterCatalogue.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { housingUsed } from "../monsters/transferRules.js";
import { yardBadRequestErr, yardRefusedErr } from "../yard/yardErrors.js";

/**
 * The Inferno monster transfer (`docs/design/inferno.md` §2.7, WP 2.5): from
 * the cave on the main yard, Inferno monsters come up out of the Inferno
 * yard's Compound into the main yard's Housing (`INFERNOPORTAL.AscendMonsters`,
 * `INFERNO_ASCENSION_POPUP.as`).
 *
 * Flash's rules, kept:
 * - **Inferno monsters only** (`IC…`): the popup listed only `IC` ids
 *   (`INFERNOPORTAL.as:76`).
 * - **Healthy ones only** (`numHealthyCreeps`, `INFERNOPORTAL.as:96-107`).
 *   The server keeps a yard's housed monsters as counts and every one of them
 *   is at full health (a hurt defender is not stored), so every Compound
 *   monster counts as healthy.
 * - **Limited by the main yard's Housing**: what is housed there plus what
 *   comes up must fit its capacity (`QueueMonster`,
 *   `INFERNO_ASCENSION_POPUP.as:132-145`), the capacity `HOUSING.HousingSpace`
 *   measures (Housing above 10 health, the Housing Expansion counted).
 * - **Free**: nothing is charged ("There is no cost for this",
 *   `#ascent_tool_tip#`).
 * - **One way**: up only. Flash had no way down; this route has no other
 *   direction.
 *
 * What Flash left to the client the server now checks: the Compound must hold
 * every monster sent (Flash wrote back whatever counts its popup posted,
 * `PageAscensionData`). The move is a delta onto both rosters as they are
 * after the catch-up, as the map transfer's is
 * (`services/monsters/transferRules.ts`), so nothing else on either yard
 * moves. Flash's write also dropped the Compound's hurt monsters (it posted
 * the healthy counts left); here they could not exist, and nothing is dropped.
 *
 * Pure: the route (`controllers/inferno/transfer.ts`) locks, catches up and
 * writes.
 */

/** Counts keyed by monster id. */
type Counts = Record<string, number>;

/** What {@link planInfernoTransfer} reads. */
export interface InfernoTransferInput {
  /** The counts to bring up, as the request parsed them (whole, at least 1 each). */
  moved: Readonly<Counts>;
  /** The Inferno yard's housed monsters (the Compound), caught up. */
  compound: Readonly<Counts>;
  /** The main yard's housed monsters, caught up. */
  housed: Readonly<Counts>;
  /** The main yard's Housing capacity now. */
  capacity: number;
  /** The player's Academy level per monster id, for `cStorage`. */
  levels?: Readonly<Record<string, number>>;
}

/** What an accepted transfer writes, and what the route answers. */
export interface InfernoTransferPlan {
  /** The Compound after the move. */
  compound: Counts;
  /** The main yard's housing after the move. */
  housed: Counts;
  /** What came up, by id. */
  moved: Counts;
  /** Housing space the main yard uses after the move. */
  used: number;
  capacity: number;
}

/**
 * A `housed` map as counts: whole, positive, anything else left out.
 *
 * @param monsters - A save's `monsters` blob.
 */
export const housedOf = (monsters: JsonObject | null | undefined): Counts => {
  const housed = monsters?.housed;
  const counts: Counts = {};
  if (!housed || typeof housed !== "object" || Array.isArray(housed)) return counts;
  for (const [id, raw] of Object.entries(housed as JsonObject)) {
    const count = Math.floor(Number(raw));
    if (Number.isFinite(count) && count > 0) counts[id] = count;
  }
  return counts;
};

/**
 * Decides a transfer up from the Inferno.
 *
 * Refusals, in order: `400 notInferno { monster }` for an id that is not an
 * Inferno monster; `409 notEnough { monster, have, need }` when the Compound
 * holds fewer; `409 noRoom { used, capacity }` when the main yard's Housing
 * cannot take them all.
 */
export const planInfernoTransfer = ({
  moved,
  compound,
  housed,
  capacity,
  levels,
}: InfernoTransferInput): InfernoTransferPlan => {
  const wanted: Counts = {};
  for (const [id, raw] of Object.entries(moved)) {
    if (!isInfernoMonster(id) || !monsterEntry(id)) {
      throw yardBadRequestErr("Only Inferno monsters can come up through the cavern.", { monster: id }, "notInferno");
    }
    const count = Math.floor(raw);
    if (count > 0) wanted[id] = (wanted[id] ?? 0) + count;
  }
  if (Object.keys(wanted).length === 0) {
    throw yardBadRequestErr("Pick at least one monster to transfer.");
  }

  const nextCompound: Counts = { ...compound };
  const nextHoused: Counts = { ...housed };
  for (const [id, need] of Object.entries(wanted)) {
    const have = nextCompound[id] ?? 0;
    if (need > have) {
      throw yardRefusedErr("notEnough", "Your Compound does not have that many of that monster.", {
        monster: id,
        have,
        need,
      });
    }
    nextCompound[id] = have - need;
    if (nextCompound[id] === 0) delete nextCompound[id];
    nextHoused[id] = (nextHoused[id] ?? 0) + need;
  }

  const used = housingUsed(nextHoused, { ...levels });
  if (used > capacity) {
    throw yardRefusedErr("noRoom", "There is not enough room in your Housing for those monsters.", {
      used,
      capacity,
    });
  }

  return { compound: nextCompound, housed: nextHoused, moved: wanted, used, capacity };
};
