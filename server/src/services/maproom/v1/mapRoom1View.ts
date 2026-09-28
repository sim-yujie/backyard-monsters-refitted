import type { TribeScale } from "../../../enums/Tribes.js";
import type { NeighbourData } from "../../../types/NeighbourData.js";
import type { TribeData } from "../../../types/TribeData.js";
import { mr1TribeRespawnAt, type MR1TribeSlot } from "./mr1TribeRules.js";

/**
 * What `GET /api/:apiVersion/bm/maproom1` answers (`docs/server-api.md`
 * "Map Room 1 read"): everything the web client's Map Room 1 screen shows, in
 * one call. Pure; the controller (`controllers/maproom/getMapRoom1.ts`) reads
 * and refreshes the rows.
 */

/** One of the player's four tribes, as the screen shows it. */
export interface MapRoom1Tribe {
  /** The tribe base id, for `wmview` / `wmattack` with `mapversion: 1`. */
  baseid: string;
  tribe: MR1TribeSlot["name"];
  /** The difficulty tier, by Town Hall: 1-2, 3, 4, 5, 6 and up. */
  tier: TribeScale;
  /** The level shown on the pin: the player's own level −1, 0, +1, +2. */
  level: number;
  destroyed: 0 | 1;
  /** The last attack's damage percentage this tribe life, 0 when fresh. */
  damage: number;
  /** Unix seconds when a wrecked tribe is back; 0 when it is standing. */
  respawnAt: number;
}

export interface MapRoom1View {
  /** Server seconds, so the client can count down `respawnAt` and protection. */
  now: number;
  /** The player's base level. */
  level: number;
  /** When the player's own damage protection ends (unix seconds); 0 without any. */
  protectedUntil: number;
  tribes: MapRoom1Tribe[];
  neighbours: NeighbourData[];
}

interface ViewInput {
  now: number;
  level: number;
  protectedUntil: number;
  slots: readonly MR1TribeSlot[];
  /** `createMR1Tribes`' `[baseid, level, destroyed]`, in slot order. */
  statuses: readonly number[][];
  tribedata: readonly TribeData[];
  neighbours: NeighbourData[];
}

export const mapRoom1View = ({
  now,
  level,
  protectedUntil,
  slots,
  statuses,
  tribedata,
  neighbours,
}: ViewInput): MapRoom1View => ({
  now,
  level,
  protectedUntil: protectedUntil > now ? protectedUntil : 0,
  tribes: slots.map((slot, index) => {
    const baseid = String(slot.template.baseid);
    const record = tribedata.find((tribe) => tribe.baseid === baseid);
    const status = statuses[index];
    const destroyed = record ? (record.destroyed ? 1 : 0) : status?.[2] ? 1 : 0;
    return {
      baseid,
      tribe: slot.name,
      tier: slot.scale,
      level: status?.[1] ?? level,
      destroyed,
      damage: record?.damage ?? 0,
      respawnAt: destroyed ? mr1TribeRespawnAt({ destroyed, destroyedAt: record?.destroyedAt ?? now }) : 0,
    };
  }),
  neighbours,
});
