import type { EntityManager } from "@mikro-orm/core";
import type { EntityManager as SqlEntityManager } from "@mikro-orm/postgresql";

import { infernoConfig } from "../../config/InfernoConfig.js";
import { readInfernoProgress, type InfernoProgressRecord } from "./infernoProgress.js";

/**
 * Korath, the fourth basic champion (`docs/design/inferno.md` §2.9, WP 5.1).
 * **[OWNER I10]** He unlocks on the surface once the player owns an Inferno
 * yard: from then the Champion Cage raises him like Gorgo, Drull and Fomor
 * (free, a one-day egg, one basic champion at a time,
 * `services/yard/champion.ts`), and the next load of the main yard tells the
 * player once. Flash gave him as an event prize instead (Monster Madness,
 * `KorathReward.as`); his Burn, Breath of Fire and Fists of Doom prizes are
 * left out (I13): he hatches at power level 0, as the catalogue has him.
 *
 * `inferno_progress` keeps `korath_unlocked_at`, written with
 * `inferno_baseid` at the capture (`descentLanding.ts`), and
 * `korath_notice_at`, written when the player has been told
 * ({@link markKorathNoticeSeen}).
 */

/**
 * Whether Korath is unlocked: the player owns an Inferno yard. A row with the
 * yard but no `korath_unlocked_at` (made before WP 5.1, or by the dev seed)
 * counts too.
 */
export const korathUnlocked = (progress: InfernoProgressRecord): boolean =>
  progress.infernoBaseid !== null || progress.korathUnlockedAt !== null;

/** Korath is unlocked and the player has not been told yet. */
export const korathNoticeDue = (progress: InfernoProgressRecord): boolean =>
  korathUnlocked(progress) && progress.korathNoticeAt === null;

/**
 * Whether the cage may raise Korath for this player now: the new Inferno is
 * switched on and they own an Inferno yard.
 *
 * @param enabled - The switch; the config's own unless a test passes one.
 */
export const korathRaisable = async (
  em: EntityManager,
  userid: number,
  enabled: boolean = infernoConfig.enabled
): Promise<boolean> => enabled && korathUnlocked(await readInfernoProgress(em, userid));

/**
 * Notes that the player has been told Korath is unlocked, so the message is
 * not shown again. Fills in `korath_unlocked_at` too where an older row lacks
 * it. Nothing changes before Korath is unlocked or once already told.
 *
 * @param now - Unix seconds.
 * @returns Whether this call marked it.
 */
export const markKorathNoticeSeen = async (em: EntityManager, userid: number, now: number): Promise<boolean> => {
  const rows = await (em as SqlEntityManager).execute<{ userid: number }[]>(
    `UPDATE bym.inferno_progress
        SET korath_notice_at = to_timestamp(?),
            korath_unlocked_at = COALESCE(korath_unlocked_at, to_timestamp(?)),
            updated_at = now()
      WHERE userid = ?
        AND korath_notice_at IS NULL
        AND (inferno_baseid IS NOT NULL OR korath_unlocked_at IS NOT NULL)
     RETURNING userid`,
    [now, now, userid]
  );
  return rows.length > 0;
};
