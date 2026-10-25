/**
 * The Descent burn (Inferno WP 1.21, `docs/design/inferno.md` §2.4, owner
 * decisions I15 and R8).
 *
 * Flash showed a toxicity bar from Descent yard 7 with the text "monsters lose
 * health" (`DescentDebuffPopup.as`, `UI_TOP.as:1175`), but no combat code ever
 * applied it. Here it is real, as a burn: from yard 7 on, every surface monster
 * in the fight loses a share of its full health every
 * {@link DESCENT_BURN_INTERVAL} ticks, the first time that long after it joins
 * the field. The Inferno's own monsters (IC1-IC8) and Korath are at home in the
 * fire and never burn. The engine ticks it before the creep acts, as it does
 * Korath's flame, and through the creep's armour; the client shows the
 * "burning" icon over every creep it burns.
 *
 * The strengths are the plan's suggestion, to be tuned in play tests: change
 * {@link DESCENT_BURN_SHARE} and nothing else.
 */

import { KORATH_ID } from "./champions.js";
import { TICKS_PER_SECOND } from "./stats.js";

/** The Descent's yards, 1 to 13 (`DescentLayer.as:299-311`). */
export const DESCENT_YARDS = 13;

/** Ticks between two burns: 10 s. */
export const DESCENT_BURN_INTERVAL = 10 * TICKS_PER_SECOND;

/**
 * The share of a monster's full health each burn takes, by Descent yard. A
 * yard missing here does not burn. [PLACEHOLDER] 2% at yard 7, up evenly to
 * 5% at yard 13; tune in play tests.
 */
export const DESCENT_BURN_SHARE: Readonly<Record<number, number>> = {
  7: 0.02,
  8: 0.025,
  9: 0.03,
  10: 0.035,
  11: 0.04,
  12: 0.045,
  13: 0.05,
};

/** What each burn takes at Descent yard `yard`, as a share of full health; 0 for none. */
export const descentBurnShare = (yard: number | null | undefined): number =>
  yard === null || yard === undefined ? 0 : (DESCENT_BURN_SHARE[yard] ?? 0);

/** Whether a monster burns in the Descent: every one but the Inferno's (`IC…`) and Korath. */
export const burnsInDescent = (monsterId: string): boolean =>
  !monsterId.startsWith("IC") && monsterId !== KORATH_ID;
