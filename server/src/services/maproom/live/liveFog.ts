import type { RevealedCell, SightSource } from "../../../game-rules/maproom/sight.js";
import type { HexShape } from "../../../game-rules/maproom/range.js";
import { sightNear, zoneCellKey, zoneVisibility } from "../sight/zoneVisibility.js";
import { ZONE_SIZE } from "./liveZones.js";

/**
 * The fog of war on the live socket (beta 9, stage 2): which cells of a
 * watched zone a watcher may be sent, decided on the server with the same
 * rule and the same sight `getarea` uses (`zoneVisibility`,
 * `getPlayerSight`). Sight is all or nothing per cell: a visible cell's
 * answer is its whole payload, a hidden one is only `{fog: 1}`, so a push
 * either carries a cell or leaves it out (the map already holds `{fog: 1}`
 * there).
 */

/** A watcher's sight as `getPlayerSight` gives it; null when the fog is switched off. */
export interface LiveSight {
  sv: string;
  sources: readonly SightSource[];
  revealed: readonly RevealedCell[];
}

/**
 * One zone's mask: 0 nothing visible (the zone is not the watcher's to know), 1 every cell
 * visible, else one byte per cell of the zone's 11 x 11 answer (`(x - originX) * 11 + (y - originY)`).
 */
export type ZoneMask = 0 | 1 | Uint8Array;

const SPAN = ZONE_SIZE + 1;

export const zoneOrigin = (id: number): { x: number; y: number } => ({
  x: Math.floor(id / 10000) * ZONE_SIZE,
  y: (id % 10000) * ZONE_SIZE,
});

/** The mask of zone `id` under `sight` (null: no fog). */
export const zoneMask = (sight: LiveSight | null, id: number, shape: HexShape): ZoneMask => {
  if (!sight) return 1;
  const { x, y } = zoneOrigin(id);
  // Nothing of the sight can reach the zone: all fog, without testing a cell.
  const near = sightNear(sight.sources, sight.revealed, x, y, ZONE_SIZE, ZONE_SIZE);
  if (!near.sources.length && !near.revealed.length) return 0;
  const visibility = zoneVisibility(near, x, y, ZONE_SIZE, ZONE_SIZE, shape);
  const bytes = new Uint8Array(SPAN * SPAN);
  let seen = 0;
  for (let dx = 0; dx < SPAN; dx++) {
    for (let dy = 0; dy < SPAN; dy++) {
      if (!visibility.get(zoneCellKey(x + dx, y + dy))) continue;
      bytes[dx * SPAN + dy] = 1;
      seen += 1;
    }
  }
  if (seen === 0) return 0;
  if (seen === SPAN * SPAN) return 1;
  return bytes;
};

/** Whether cell `x,y` of zone `id`'s answer is visible under its mask (false when not in that answer). */
export const maskShows = (mask: ZoneMask, id: number, x: number, y: number): boolean => {
  const origin = zoneOrigin(id);
  const dx = x - origin.x;
  const dy = y - origin.y;
  if (dx < 0 || dy < 0 || dx >= SPAN || dy >= SPAN) return false;
  if (mask === 0) return false;
  if (mask === 1) return true;
  return mask[dx * SPAN + dy] === 1;
};

/** Whether cell `x,y` is part of zone `id`'s 11 x 11 answer. */
export const inZoneAnswer = (id: number, x: number, y: number): boolean => {
  const origin = zoneOrigin(id);
  return x >= origin.x && y >= origin.y && x <= origin.x + ZONE_SIZE && y <= origin.y + ZONE_SIZE;
};
