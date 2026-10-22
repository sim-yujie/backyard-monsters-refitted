import { BaseType } from "../../enums/Base.js";
import { Save } from "../../database/models/save.model.js";
import { User } from "../../database/models/user.model.js";
import { FilterFrontendKeys } from "../../utils/FrontendKey.js";
import { getOutpostOwnerSave } from "./getOutpostOwnerSave.js";
import { isShinyLocked, visibleCredits } from "../user/shinyLock.js";
import { maskYardForViewer, masksFor } from "./viewMask.js";

type OwnerSave = Pick<Save, "resources">;

export interface SaveDataOptions {
  /**
   * The yard is served to its attacker once the attack is committed
   * (`baseModeAttack`, or an attack save past its binding check): the battle
   * runs in their game and needs every trap and level. Anyone else who is not
   * the owner gets the masked yard (`viewMask.ts`).
   */
  readonly attack?: boolean;
}

/**
 * State that belongs to the player rather than to any one of their yards. Served from
 * the main save whenever a player looks at a base they own, so an outpost reports the
 * same credits, resources and progress as the main yard rather than a stale copy.
 *
 * @param {User} user - The viewer, whose no-shiny setting decides what credits reads
 * @param {Save} userSave - The viewer's main yard save
 */
const mapOwnerState = (user: User, userSave: Save) => ({
  credits: visibleCredits(user, userSave.credits),
  fan: userSave.fan,
  resources: userSave.resources,
  lockerdata: userSave.lockerdata,
  academy: userSave.academy,
  outposts: userSave.outposts,
  quests: userSave.quests,
  stats: userSave.stats,
  points: userSave.points,
  basevalue: userSave.basevalue,
  buildingresources: userSave.buildingresources,
  rewards: userSave.rewards,
  homebase: userSave.homebase,
});

/**
 * Resolves the outpost owner, then shapes the save for the client.
 *
 * @param {Save} save - The save being sent
 * @param {User} user - The requesting user, who may or may not own it
 * @param {SaveDataOptions} options - Whether this is a committed attack's load
 * @returns {Promise<Partial<Save>>} The frontend-visible fields
 */
export const mapSaveData = async (save: Save, user: User, options: SaveDataOptions = {}): Promise<Partial<Save>> => {
  const ownerSave = await getOutpostOwnerSave(save, user);

  return buildSaveData(save, user, ownerSave, options);
};

/**
 * Shapes a save for the client.
 *
 * The single place a Save is shaped for the wire, so every rule about who sees what
 * lives here instead of being spread across the endpoints. The two branches are the
 * same rule seen from either side: player-level state lives on the main save, and an
 * outpost reports it rather than owning a copy. Owners read it off their own save,
 * everyone else reads it off the owner's.
 *
 * Call this directly only when the owner save is already in hand; otherwise use
 * mapSaveData, which resolves it first.
 *
 * @param {Save} save - The save being sent
 * @param {User} user - The requesting user, who may or may not own it
 * @param {OwnerSave | null} ownerSave - The owner's main save when `save` is an outpost, null otherwise
 * @param {SaveDataOptions} options - Whether this is a committed attack's load
 * @returns {Partial<Save>} The frontend-visible fields
 */
export const buildSaveData = (
  save: Save,
  user: User,
  ownerSave: OwnerSave | null,
  options: SaveDataOptions = {}
): Partial<Save> => {
  const filteredSave = FilterFrontendKeys(save);

  const isOwner = save.type !== BaseType.INFERNO && save.userid === user.userid;

  if (isOwner && user.save) return Object.assign(filteredSave, mapOwnerState(user, user.save));

  if (ownerSave) filteredSave.resources = ownerSave.resources;

  // The wild monster raid schedule is the owner's alone (#302): only their own
  // yard loads fill it, so a bot, which never loads its yard, would show an
  // empty one where a real player shows theirs (#245).
  if (!isOwner) filteredSave.aiattacks = {};

  // The list of traps that fired is the account's own: only the owner's
  // planner reads it (to offer putting them back), and it says where traps
  // stood. Anyone viewing, helping or attacking the yard gets none. Nor is
  // the owner's Shiny count anyone else's business.
  if (save.userid !== user.userid) {
    filteredSave.firedtraps = [];
    filteredSave.credits = 0;
  }

  // Someone only looking at a player's yard gets no traps and no levels
  // (owner report 2026-10-22, `viewMask.ts`); its committed attacker gets all.
  if (!options.attack && masksFor(save, user.userid)) maskYardForViewer(filteredSave, save);

  const shinyLocked = isShinyLocked(user);
  
  if (shinyLocked) filteredSave.credits = 0;

  return filteredSave;
};
