import type { EntityManager } from "@mikro-orm/core";
import { Maproom } from "../../../database/models/maproom.model.js";
import type { TribeData } from "../../../types/TribeData.js";
import { readOnboarding, type OnboardingSave } from "../../onboarding/state.js";
import { tutorial } from "../../../game-data/tribes/v1/tutorial.js";
import { mr1TribePool } from "./mr1TribeRules.js";
import { LOOT_GAIN_RATIO, RESOURCE_KEYS } from "../../../game-rules/combat/index.js";

/**
 * The guided start's private practice camp (`docs/design/tutorial.md` §5.5,
 * issue #227): Map Room 1 tribe base `"1"`, Flash's tutorial camp id, laid
 * out by `game-data/tribes/v1/tutorial.ts`.
 *
 * Map Room 1 tribes are already per player: each player's copy of a tribe is
 * an entry in their own `Maproom` row's `tribedata`, and the attack load and
 * save build the tribe from the template plus that entry. The camp is one
 * more such entry, present only while `save.onboarding.camp.state` is
 * `"open"`. So only its owner can see or attack it, and a player has at most
 * one: the state is per account and the id is fixed.
 *
 * The guide routes open, reset and remove it through the request's
 * transaction (`YardActionInput.em`), so the camp and the guide's step change
 * in one commit. The Map Room 1 read and the attack load ask
 * {@link practiceCampOpen}.
 */

/** The camp's tribe base id. */
export const PRACTICE_CAMP_BASEID = "1";

/** What the Map Room 1 read shows for it. */
export const PRACTICE_CAMP_NAME = "Practice camp";

/** Whether this player's camp is open: the attack load and the map read ask. */
export const practiceCampOpen = (save: OnboardingSave | null | undefined): boolean =>
  !!save && readOnboarding(save).camp.state === "open";

/** A fresh camp entry: full health, nothing looted. */
const freshCamp = (): TribeData => ({ baseid: PRACTICE_CAMP_BASEID, tribeHealthData: {} });

/** The player's `Maproom` row, made if they have none yet. */
const maproomOf = async (em: EntityManager, userid: number): Promise<Maproom> => {
  const found = await em.findOne(Maproom, { userid });
  if (found) return found;
  const made = em.create(Maproom, { userid, tribedata: [] } as never) as Maproom;
  em.persist(made);
  return made;
};

/**
 * Opens the camp (after the guide's free Flinger finish): a fresh entry
 * replaces any left over. Persisted through `em`; the caller flushes.
 */
export const openPracticeCamp = async (em: EntityManager, userid: number): Promise<void> => {
  const maproom = await maproomOf(em, userid);
  maproom.tribedata = [
    ...(maproom.tribedata ?? []).filter((tribe) => tribe.baseid !== PRACTICE_CAMP_BASEID),
    freshCamp(),
  ];
  em.persist(maproom);
};

/**
 * The free retry (§5.6): the camp stands back up at full health. `looted` is
 * kept, so losing on purpose cannot farm its loot twice.
 */
export const resetPracticeCamp = async (em: EntityManager, userid: number): Promise<void> => {
  const maproom = await maproomOf(em, userid);
  const old = (maproom.tribedata ?? []).find((tribe) => tribe.baseid === PRACTICE_CAMP_BASEID);
  const camp: TribeData = { ...freshCamp(), ...(old?.looted && { looted: { ...old.looted } }) };
  maproom.tribedata = [
    ...(maproom.tribedata ?? []).filter((tribe) => tribe.baseid !== PRACTICE_CAMP_BASEID),
    camp,
  ];
  em.persist(maproom);
};

/** Removes the camp (a win, or a skip). */
export const removePracticeCamp = async (em: EntityManager, userid: number): Promise<void> => {
  const maproom = await em.findOne(Maproom, { userid });
  if (!maproom) return;
  const left = (maproom.tribedata ?? []).filter((tribe) => tribe.baseid !== PRACTICE_CAMP_BASEID);
  if (left.length === (maproom.tribedata ?? []).length) return;
  maproom.tribedata = left;
  em.persist(maproom);
};

/**
 * The camp of an attack that `guide/skip` removed mid-fight (owner, 4 Nov
 * 2026: new players skipping the guide during the practice attack had every
 * save of it refused). A stand-in at full health, as the attack load served
 * the camp (it opens and resets at full health), so the attack lands as
 * fought: the army spent, the battle replayed. It counts as looted up to
 * its loot cap (`creditableMR1Loot`), so it gives nothing: a skip grants
 * nothing more, and the camp's real `looted` went with its entry. It is
 * never added to the player's `tribedata`, so the camp stays gone.
 * Undefined for any other base.
 */
export const removedCampStandIn = (baseid: string): TribeData | undefined => {
  if (baseid !== PRACTICE_CAMP_BASEID) return undefined;
  const pool = mr1TribePool(tutorial);
  const looted = Object.fromEntries(RESOURCE_KEYS.map((key) => [key, Math.ceil(pool[key] * LOOT_GAIN_RATIO)]));
  return { ...freshCamp(), looted };
};

/** Whether the server's battle destroyed the camp (`scaledMR1Tribes` writes `destroyed`). */
export const practiceCampDestroyed = async (em: EntityManager, userid: number): Promise<boolean> => {
  const maproom = await em.findOne(Maproom, { userid });
  const camp = maproom?.tribedata?.find((tribe) => tribe.baseid === PRACTICE_CAMP_BASEID);
  return Boolean(camp?.destroyed);
};
