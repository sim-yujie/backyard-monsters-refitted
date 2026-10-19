import { MapRoomVersion } from "../../../enums/MapRoom.js";

/**
 * The rules for "Move to a random spot" (`POST /worldmapv2/randommove`,
 * issue #366): a Map Room 2 player moves their main yard to a random free
 * land cell in the same world, free, once a week. Every outpost they hold is
 * lost with the move and goes back to the wild monsters.
 *
 * A revamp feature, owner's decisions of 2026-10-19: Flash had no such button
 * (players destroyed and rebuilt the Map Room instead). Pure, so it is tested
 * without a database; `randomMove.ts` loads the rows and applies the answer.
 */

/** A week between moves. */
export const RANDOM_MOVE_COOLDOWN = 7 * 24 * 60 * 60;

/** Why a random move was refused. */
export type RandomMoveRefusal =
  | "notMapRoom2"
  | "noHomeCell"
  | "coolingDown"
  | "underAttack"
  | "outpostUnderAttack"
  | "attacking"
  | "noFreeCell";

export interface RandomMoveInput {
  /** The caller's main save's `mapversion`. */
  mapVersion: number | null | undefined;
  /** Whether the caller's Map Room 2 home cell was found in their world. */
  hasHomeCell: boolean;
  /** The caller's main save's `randommoveat`: when they last moved, unix seconds. */
  randomMoveAt: number | null | undefined;
  /** Unix seconds. */
  now: number;
  /** An attack on the main yard is running. */
  underAttack: boolean;
  /** An attack on one of the caller's outposts is running. */
  outpostUnderAttack: boolean;
  /** The caller is in an attack of their own. */
  attacking: boolean;
}

/**
 * When the next move may be made: a week after the last one, or 0 when the
 * player has never moved.
 */
export const randomMoveAvailableAt = (randomMoveAt: number | null | undefined): number =>
  randomMoveAt ? randomMoveAt + RANDOM_MOVE_COOLDOWN : 0;

/**
 * Whether the caller may move now.
 *
 * An attack running on any of their yards is refused, as `migrateBase.ts`
 * refuses one: its save would land on a yard that has moved, or on an outpost
 * that no longer exists. So is an attack the caller is in, whose result is
 * written back to their main yard.
 *
 * @returns Why not, or null when they may.
 */
export const randomMoveRefusal = ({
  mapVersion,
  hasHomeCell,
  randomMoveAt,
  now,
  underAttack,
  outpostUnderAttack,
  attacking,
}: RandomMoveInput): RandomMoveRefusal | null => {
  if (Number(mapVersion) !== MapRoomVersion.V2) return "notMapRoom2";

  if (!hasHomeCell) return "noHomeCell";

  if (randomMoveAvailableAt(randomMoveAt) > now) return "coolingDown";

  if (underAttack) return "underAttack";

  if (outpostUnderAttack) return "outpostUnderAttack";

  if (attacking) return "attacking";

  return null;
};
