import { isSwitchOn } from "./BotConfig.js";
import { MapRoom2 } from "../enums/MapRoom.js";

/**
 * Represents the size of Map Room 2 world map.
 * @constant {number[]}
 */
export const WORLD_SIZE = [MapRoom2.HEIGHT, MapRoom2.WIDTH];

/**
 * The scale factor for noise generation. This value determines the frequency of the noise.
 * A higher value results in larger, more spread-out features, while a lower value results in smaller, more detailed features.
 * @constant {number}
 */
export const NOISE_SCALE = 12;

/**
 * The scale factor for terrain height. This value determines the range of terrain heights.
 * A higher value results in taller terrain features, while a lower value results in flatter terrain.
 * @constant {number}
 */
export const TERRAIN_SCALE = 95;

/**
 * Number of cells near the edge where the transition will start to smooth.
 * @constant {number}
 */
export const EDGE_TRANSITION_WIDTH = 3;

/**
 * The most of any one resource a Map Room 2 player can store
 * @constant {number}
 */
export const MAX_RESOURCE_CAPACITY = 7_046_100_000;

/** Which Map Room 2 cells the neighbour defence bonus covers. */
export type Mr2NeighbourBonusMode = "off" | "all" | "players";

/**
 * Map Room 2's neighbour defence bonus switch (`docs/mr2-neighbours.md`): a
 * cell under attack defends better for each friendly cell around it.
 * `MR2_NEIGHBOUR_BONUS` is `on` (or `true`) for every cell, `players` for
 * players' main yards and outposts only (no wild monster camps), and off for
 * anything else, the default, which serves every attack exactly as before.
 * Read on each attack load, so tests can flip it.
 */
export const mr2NeighbourBonusMode = (
  env: Record<string, string | undefined> = process.env
): Mr2NeighbourBonusMode => {
  if (isSwitchOn(env.MR2_NEIGHBOUR_BONUS)) return "all";
  return env.MR2_NEIGHBOUR_BONUS?.trim().toLowerCase() === "players" ? "players" : "off";
};

/** Whether the neighbour bonus is on for any cell at all. */
export const mr2NeighbourBonusEnabled = (env: Record<string, string | undefined> = process.env): boolean =>
  mr2NeighbourBonusMode(env) !== "off";

/** Who sees Map Room 2's painted look (Modern look plan step 2). */
export type Mr2PaintedMapMode = "off" | "staff" | "on";

/**
 * Map Room 2's painted look switch, `MR2_PAINTED_MAP` (`docs/mr2-modern-look-plan.md` section 4):
 * `on` (or `true`) for every Modern player, `staff` for the accounts in `MR2_STAFF_USER_IDS`
 * (comma separated `user.userid`s; `ADMIN_USER_IDS` when that is unset), off for anything else,
 * the default, which is today's tile map. Classic players never get it (the client decides that).
 * Read on each base load, so tests can flip it.
 */
export const mr2PaintedMapMode = (env: Record<string, string | undefined> = process.env): Mr2PaintedMapMode => {
  if (isSwitchOn(env.MR2_PAINTED_MAP)) return "on";
  return env.MR2_PAINTED_MAP?.trim().toLowerCase() === "staff" ? "staff" : "off";
};

/** Whether this account gets the painted look (sent as `flags.mr2painted` with the base load). */
export const mr2PaintedMapFor = (userid: unknown, env: Record<string, string | undefined> = process.env): boolean => {
  const mode = mr2PaintedMapMode(env);
  if (mode !== "staff") return mode === "on";
  if (typeof userid !== "number") return false;
  const list = env.MR2_STAFF_USER_IDS?.trim() ? env.MR2_STAFF_USER_IDS : env.ADMIN_USER_IDS;
  return (list ?? "")
    .split(",")
    .map((part) => part.trim())
    .some((part) => /^\d+$/.test(part) && Number(part) === userid);
};
