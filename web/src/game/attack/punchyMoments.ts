import { BANDITO_ID, EYE_RA_ID, PROJECT_X_ID, WORMZER_ID } from "@/game/combat/rules";
import type { PunchyStrength } from "./blastFx";

/**
 * Where the battle screen draws a punchy blast (feat/punchy-trial, a trial
 * for the owner to pick from). Drawing only: nothing here reaches the battle.
 *
 * - Korath's quake: `full`, over its orange rings.
 * - A Project X's death blast: `full`, in place of the yellow rings.
 * - The Town Hall (an outpost's core) destroyed: `full`.
 * - A Bandito's whirlwind and a Wormzer's burst: `light`, in place of the
 *   yellow rings, as they go off every swing.
 */

/** How a ranked splash is drawn: Eye-ra's fireball, a punchy blast, or the yellow rings. */
export type SplashLook = "fiery" | PunchyStrength | "rings";

export const splashLook = (moveId: string): SplashLook => {
  if (moveId === EYE_RA_ID) return "fiery";
  if (moveId === PROJECT_X_ID) return "full";
  if (moveId === BANDITO_ID || moveId === WORMZER_ID) return "light";
  return "rings";
};

/** Korath's quake blast. */
export const QUAKE_PUNCHY: PunchyStrength = "full";

/** The Town Hall's blast, screen px: a big building, a big bang. */
export const TOWN_HALL_BLAST_RADIUS = 120;
