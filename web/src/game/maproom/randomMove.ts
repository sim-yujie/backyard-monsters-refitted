import type { BaseLoadResponse } from "@/api/types";

/**
 * "Move to a random spot" on the Map Room (issue #366): a Map Room 2 player
 * moves their main yard to a random free spot in the same world, free, once
 * every 7 days, and loses every outpost they hold. Pure: the texts, the
 * cooldown, and the warning the confirm dialog shows. The server checks all
 * of it again (`server/src/services/maproom/v2/randomMoveRules.ts`).
 *
 * A revamp feature (owner, 2026-10-19): Flash had no such button.
 */

/** A week between moves, as the server holds it (`RANDOM_MOVE_COOLDOWN`). */
export const RANDOM_MOVE_COOLDOWN_SECONDS = 7 * 24 * 60 * 60;

export const RANDOM_MOVE_TEXT = {
  button: "Move to a random spot",
  buttonTitle: "Move your main yard to a random free spot in this world. Free, once every 7 days.",
  title: "Move to a Random Spot",
  lead: "Your main yard moves to a random free spot in this world, with all its buildings, monsters and resources.",
  free: "It's free, and you stay in your alliance. You can do this once every 7 days.",
  noOutposts: "You have no outposts, so nothing else is lost.",
  confirm: "Move my yard",
  cancel: "Cancel",
  busy: "Moving your yard...",
  problem: "Your yard could not be moved: ",
  openMap: "Open map",
  close: "Close",
} as const;

const DAY = 24 * 60 * 60;
const HOUR = 60 * 60;

/** When the next move may be made, unix seconds; 0 when the player has never moved. */
export const randomMoveAvailableAt = (save: Pick<BaseLoadResponse, "randommoveat">): number => {
  const last = Number(save.randommoveat ?? 0);
  return Number.isFinite(last) && last > 0 ? last + RANDOM_MOVE_COOLDOWN_SECONDS : 0;
};

/** Seconds until the next move may be made; 0 when it may be made now. */
export const randomMoveWait = (save: Pick<BaseLoadResponse, "randommoveat">, now: number): number =>
  Math.max(0, randomMoveAvailableAt(save) - now);

/**
 * "Available again in 3 days": whole days rounded up while a day or more is
 * left, then hours, then minutes.
 */
export const availableAgainText = (wait: number): string => {
  const unit = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  if (wait >= DAY) return `Available again in ${unit(Math.ceil(wait / DAY), "day")}.`;
  if (wait >= HOUR) return `Available again in ${unit(Math.ceil(wait / HOUR), "hour")}.`;
  return `Available again in ${unit(Math.max(1, Math.ceil(wait / 60)), "minute")}.`;
};

/** How many outposts the player holds, as the main yard lists them. */
export const outpostCountOf = (save: Pick<BaseLoadResponse, "outposts">): number =>
  Array.isArray(save.outposts) ? save.outposts.length : 0;

/**
 * The warning about the outposts, in plain words, or null when there are
 * none. What really happens to them (`randomMove.ts` on the server): their
 * rows are deleted, so each cell is a wild monster camp again that anyone can
 * attack and take over; their buildings, the monsters living on them, their
 * income and any Starter Kit bought for them are gone for good.
 */
export const outpostWarning = (count: number): readonly string[] | null => {
  if (count <= 0) return null;
  const them = count === 1 ? "it" : "them";
  return [
    count === 1
      ? "Your outpost will be lost. It goes back to the wild monsters, and anyone can attack it and take it over."
      : `All ${count} of your outposts will be lost. They go back to the wild monsters, and anyone can attack them and take them over.`,
    `Everything on ${them} is lost too: the buildings, the monsters living there, and any Starter Kit you bought for ${them}. Their income stops.`,
    "This cannot be undone.",
  ];
};

/** The question on the confirm button's dialog, naming the count. */
export const confirmQuestion = (count: number): string =>
  count === 0
    ? "Move your main yard to a random spot?"
    : `Move your main yard and lose ${count === 1 ? "your outpost" : `all ${count} outposts`}?`;

/** After the move: where the yard is now. */
export const movedText = (coords: readonly [number, number] | null): string =>
  coords ? `Your main yard has moved to ${coords[0]}, ${coords[1]}.` : "Your main yard has moved.";
