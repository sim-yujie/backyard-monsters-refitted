import type { EntityManager } from "@mikro-orm/core";
import type { EntityManager as SqlEntityManager } from "@mikro-orm/postgresql";

import { infernoConfig } from "../../config/InfernoConfig.js";
import type { Save } from "../../database/models/save.model.js";
import { logger } from "../../utils/logger.js";
import { isAttackActive } from "../base/isAttackActive.js";
import { readOpenRaid } from "../raids/raidStore.js";
import {
  EMERGENCE_GAP_SECONDS,
  emergenceDueCheck,
  emergencePausesWildRaids,
  type EmergenceNotDue,
  type EmergenceSave,
} from "./emergence.js";
import { readInfernoProgress, type InfernoProgressRecord } from "./infernoProgress.js";

/**
 * The emergence on the owner's build-mode load of their main yard
 * (`docs/design/inferno.md` §3.2 "main-yard load hook"), and the pause it
 * puts on wild monster raids. The rules are `emergence.ts`'s; this reads the
 * facts and writes the level-up.
 *
 * The level and its time are written **before** the raid starts, as Flash
 * saved them before its attack (`UpgradePortal`, `INFERNO_EMERGENCE_EVENT.as`):
 * from here the raid counts, whatever happens to it (owner I14, R5).
 */

/** What the load hook found. */
export interface EmergenceOnLoad {
  /** The progress after the hook: with the new level when it went up. */
  readonly progress: InfernoProgressRecord;
  /** The level the cave just went up to, its raid due now; null when it did not. */
  readonly raised: number | null;
  /** Why it did not; null when it did. */
  readonly notDue: EmergenceNotDue | "race" | null;
}

/**
 * Raises the cave from level `from` to `from + 1` at `now`, if it is still
 * at `from` and its 12 hours are up: one statement, so two loads at once
 * raise it once. Makes the row for a player who has none.
 *
 * @returns The new level, or null when another request got there first.
 */
export const raiseEmergence = async (
  em: EntityManager,
  userid: number,
  from: number,
  now: number
): Promise<number | null> => {
  const rows = await (em as SqlEntityManager).execute<{ emergence_level: number | string }[]>(
    `INSERT INTO bym.inferno_progress AS p (userid, emergence_level, emergence_last_at)
     VALUES (?, ?, to_timestamp(?))
     ON CONFLICT (userid) DO UPDATE
        SET emergence_level = EXCLUDED.emergence_level,
            emergence_last_at = EXCLUDED.emergence_last_at,
            updated_at = now()
      WHERE p.emergence_level = ?
        AND (p.emergence_last_at IS NULL OR p.emergence_last_at <= to_timestamp(?))
     RETURNING emergence_level`,
    [userid, from + 1, now, from, now - EMERGENCE_GAP_SECONDS]
  );
  return rows.length > 0 ? Number(rows[0]!.emergence_level) : null;
};

/**
 * The load hook: reads the player's progress, and when an emergence raid is
 * due ({@link emergenceDueCheck}) raises the cave a level. Undefined while
 * the new Inferno is switched off, so the load answers nothing of it.
 *
 * @param save - The main yard, caught up by this load.
 * @param now - Unix seconds.
 */
export const emergenceOnLoad = async (
  em: EntityManager,
  userid: number,
  save: Save,
  now: number,
  enabled: boolean = infernoConfig.enabled
): Promise<EmergenceOnLoad | undefined> => {
  if (!enabled) return undefined;
  const progress = await readInfernoProgress(em, userid);
  const notDue = emergenceDueCheck({
    enabled,
    save,
    progress,
    now,
    underAttack: isAttackActive(save),
    raidOpen: (await readOpenRaid(userid)) !== null,
  });
  if (notDue !== null) return { progress, raised: null, notDue };

  const raised = await raiseEmergence(em, userid, progress.emergenceLevel, now);
  if (raised === null) return { progress: await readInfernoProgress(em, userid), raised: null, notDue: "race" };
  logger.info("Inferno emergence for userid {userid}: the cave goes up to level {level}", {
    event: "inferno-emergence",
    userid,
    level: raised,
  });
  return { progress: { ...progress, emergenceLevel: raised, emergenceLastAt: now }, raised, notDue: null };
};

/**
 * Whether the emergence holds the player's wild monster raids back now
 * ({@link emergencePausesWildRaids}). Reads the progress only for a main
 * yard at Town Hall 5 or more with the new Inferno on: below Town Hall 5 the
 * cave has never gone up (the hall never goes down), so nothing is paused.
 *
 * @param save - The main yard: `type`, `tutorialstage` and the hall's level
 *   (`buildingdata`, or the `thlevel` column).
 */
export const emergenceHoldsRaids = async (
  em: EntityManager,
  userid: number,
  save: EmergenceSave,
  enabled: boolean = infernoConfig.enabled
): Promise<boolean> => {
  const before = { emergenceLevel: 0 };
  if (!emergencePausesWildRaids(enabled, save, before)) return false;
  return emergencePausesWildRaids(enabled, save, await readInfernoProgress(em, userid));
};
