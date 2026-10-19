import { BANDITO_ID, EYE_RA_ID } from "@/game/combat/rules";
import type { PunchyStrength } from "./blastFx";

/**
 * Where the battle screen draws a punchy blast (feat/punchy-trial, as the
 * owner picked on 2026-10-19). Drawing only: nothing here reaches the battle.
 *
 * - Korath's quake: `full`, over its orange rings.
 * - A Bandito's whirlwind: the `flash` alone, over its yellow rings, as it
 *   goes off every swing.
 * - A Wormzer popping up out of the ground to bite: `light`, attacking or
 *   sent out by a bunker.
 * - Every other splash (Project X's death blast, a Wormzer's burst) keeps
 *   its yellow rings; the Town Hall falling keeps its old look.
 */

/** How a ranked splash is drawn: Eye-ra's fireball, the yellow rings, or the rings with a flash. */
export type SplashLook = "fiery" | "rings" | "rings-flash";

export const splashLook = (moveId: string): SplashLook => {
  if (moveId === EYE_RA_ID) return "fiery";
  if (moveId === BANDITO_ID) return "rings-flash";
  return "rings";
};

/** Korath's quake blast. */
export const QUAKE_PUNCHY: PunchyStrength = "full";

/** A Bandito's whirlwind blast, over its rings. */
export const BANDITO_PUNCHY: PunchyStrength = "flash";

/** A Wormzer coming up to bite: its blast, and how wide, screen px. */
export const SURFACE_PUNCHY: PunchyStrength = "light";
export const SURFACE_BLAST_RADIUS = 40;
