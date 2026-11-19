import type { EntityManager } from "@mikro-orm/core";
import type { EntityManager as SqlEntityManager } from "@mikro-orm/postgresql";

import { infernoConfig } from "../../config/InfernoConfig.js";
import { quietLoginOn } from "../../config/QuietLoginConfig.js";
import type { Save } from "../../database/models/save.model.js";
import { logger } from "../../utils/logger.js";
import { isAttackActive } from "../base/isAttackActive.js";
import { dropOpenRaid, readOpenRaid, type OpenRaid } from "../raids/raidStore.js";
import {
  EMERGENCE_GAP_SECONDS,
  emergenceDueCheck,
  emergencePausesWildRaids,
  emergenceRaidSkipped,
  type EmergenceNotDue,
  type EmergenceSave,
} from "./emergence.js";
import { isEmergenceRaid, openEmergenceRaid } from "./emergenceRaid.js";
import { readInfernoProgress, type InfernoProgressRecord } from "./infernoProgress.js";

/**
 * The emergence on the owner's build-mode load of their main yard
 * (`docs/design/inferno.md` §3.2 "main-yard load hook"), and the pause it
 * puts on wild monster raids. The rules are `emergence.ts`'s; this reads the
 * facts and writes the level-up.
 *
 * The level and its time are written **before** the raid starts, as Flash
 * saved them before its attack (`UpgradePortal`, `INFERNO_EMERGENCE_EVENT.as`):
 * from here the raid counts, whatever happens to it (owner I14, R5). Moloch's
 * raid for the new level is opened right after (`emergenceRaid.ts`, WP 1.9).
 */

/**
 * Which screen's load it was, as the client says (`BaseLoadSchema`'s
 * `screen`): the yard, or a map opening the own yard to find its home cell.
 * "unknown" for a client that does not say. For the logs only (patch 7.12).
 */
export type LoadScreen = "yard" | "map" | "unknown";

/** What the load hook found. */
export interface EmergenceOnLoad {
  /** The progress after the hook: with the new level when it went up. */
  readonly progress: InfernoProgressRecord;
  /**
   * The level whose emergence the yard plays now: the one the cave just went
   * up to, or one raised on an earlier load whose raid has not landed yet
   * (`replay`); null when none.
   */
  readonly raised: number | null;
  /** Why it did not; null when it did. `quiet`: the test server's `QUIET_LOGIN` held it back. */
  readonly notDue: EmergenceNotDue | "race" | "quiet" | null;
  /**
   * Moloch's raid for that level, open in its warning and due now; null when
   * none: none raised, or the first raise on a yard at 10% health or less
   * ({@link emergenceRaidSkipped}), which counts the stage with no raid.
   */
  readonly raid: OpenRaid | null;
  /** True when `raised` is a stage raised on an earlier load, played again (patch 7.12). */
  readonly replay?: boolean;
}

/**
 * Raises the cave from level `from` to `from + 1` at `now`, if it is still
 * at `from` with no stage left to play and its 23 hours are up: one
 * statement, so two loads at once raise it once. Makes the row for a player
 * who has none. With `withRaid`, the new level is kept as the stage still to
 * be played (`emergence_pending`) until its raid lands.
 *
 * @returns The new level, or null when another request got there first.
 */
export const raiseEmergence = async (
  em: EntityManager,
  userid: number,
  from: number,
  now: number,
  withRaid: boolean = true
): Promise<number | null> => {
  const rows = await (em as SqlEntityManager).execute<{ emergence_level: number | string }[]>(
    `INSERT INTO bym.inferno_progress AS p (userid, emergence_level, emergence_last_at, emergence_pending)
     VALUES (?, ?, to_timestamp(?), ?)
     ON CONFLICT (userid) DO UPDATE
        SET emergence_level = EXCLUDED.emergence_level,
            emergence_last_at = EXCLUDED.emergence_last_at,
            emergence_pending = EXCLUDED.emergence_pending,
            updated_at = now()
      WHERE p.emergence_level = ?
        AND p.emergence_pending IS NULL
        AND (p.emergence_last_at IS NULL OR p.emergence_last_at <= to_timestamp(?))
     RETURNING emergence_level`,
    [userid, from + 1, now, withRaid ? from + 1 : null, from, now - EMERGENCE_GAP_SECONDS]
  );
  return rows.length > 0 ? Number(rows[0]!.emergence_level) : null;
};

/**
 * The stage `level` is played: its Moloch raid has landed at `landedAt`
 * (unix seconds), so the next load no longer plays it again, and the 23-hour
 * wait for the next rise counts from this landing, not from the rise (owner,
 * 19 Nov: a stage left waiting for days is not followed by the next one
 * straight after it lands). Run in the landing's own transaction
 * (`raidFlow.ts`'s `settleRaid`). Leaves any other stage alone, and never
 * moves the wait back.
 */
export const clearEmergencePending = async (
  em: EntityManager,
  userid: number,
  level: number,
  landedAt: number
): Promise<void> => {
  await (em as SqlEntityManager).execute(
    `UPDATE bym.inferno_progress
        SET emergence_pending = NULL,
            emergence_last_at = GREATEST(emergence_last_at, to_timestamp(?)),
            updated_at = now()
      WHERE userid = ? AND emergence_pending = ?`,
    [landedAt, userid, level]
  );
};

/** The cave level a Moloch raid is the stage of, from its plan; null when unreadable. */
const stageOf = (raid: OpenRaid): number | null => {
  const level = Number((raid.plan as { level?: unknown } | null | undefined)?.level);
  return Number.isInteger(level) ? level : null;
};

/**
 * A stage raised on an earlier load whose raid has not landed (patch 7.12,
 * owner's A): its warning still open is answered again as it is; one that
 * has gone (its 15 minutes ran out, a load after the game was closed called
 * it off, a fight cancelled) is opened afresh for the same level. Either way
 * the yard plays the earthquake, the warning and the fight. Waits for a
 * load with no attack running and no other raid open.
 */
const replayEmergence = async (
  userid: number,
  save: Save,
  progress: InfernoProgressRecord,
  level: number,
  now: number,
  screen: LoadScreen
): Promise<EmergenceOnLoad> => {
  const held = (notDue: EmergenceNotDue): EmergenceOnLoad => ({ progress, raised: null, notDue, raid: null });
  if (isAttackActive(save)) return held("underAttack");
  let open = await readOpenRaid(userid);
  if (open && isEmergenceRaid(open) && open.phase === "warning") {
    if (stageOf(open) === level) {
      logger.info("Inferno emergence for userid {userid}: level {level} not played yet, its warning shown again", {
        event: "inferno-emergence-replay",
        userid,
        level,
        screen,
        reopened: false,
      });
      return { progress, raised: level, notDue: null, raid: open, replay: true };
    }
    // Another stage's warning: not the one to play.
    await dropOpenRaid(userid, open.id);
    open = null;
  }
  // A fight under way, or another raid (a Trojan Horse): the next load.
  if (open) return held("raidOpen");
  const raid = await openEmergenceRaid(userid, save, level, now);
  if (!raid) return held("raidOpen");
  logger.info("Inferno emergence for userid {userid}: level {level} not played yet, its raid opened again", {
    event: "inferno-emergence-replay",
    userid,
    level,
    screen,
    reopened: true,
  });
  return { progress, raised: level, notDue: null, raid, replay: true };
};

/**
 * The load hook: reads the player's progress, and when an emergence raid is
 * due ({@link emergenceDueCheck}) raises the cave a level and opens Moloch's
 * raid for it. Undefined while the new Inferno is switched off, so the load
 * answers nothing of it.
 *
 * A stage raised on an earlier load and not yet played to its landing
 * (`emergencePending`) is played first, on this load and every one after
 * until its raid lands, however long the player was away (patch 7.12,
 * owner's A, 19 Nov 2026): a map's load can raise the cave where nothing
 * plays it, and the stage used to be lost. No new level comes meanwhile.
 * Stages raised before the patch are not run again (owner's C).
 *
 * A Moloch warning open with no stage pending (one opened before the patch)
 * is called off, as Flash's reload dropped it (`UpgradePortal` saved the
 * level before the warning).
 *
 * A local test server with `QUIET_LOGIN` on (`config/QuietLoginConfig.ts`)
 * never raises the cave on load, so a test account lands in its yard with no
 * emergence and no Moloch raid; the cave and its progress are left as they are.
 *
 * @param save - The main yard, caught up by this load.
 * @param now - Unix seconds.
 * @param screen - Which screen's load it was, for the logs.
 */
export const emergenceOnLoad = async (
  em: EntityManager,
  userid: number,
  save: Save,
  now: number,
  enabled: boolean = infernoConfig.enabled,
  quiet: boolean = quietLoginOn(),
  screen: LoadScreen = "unknown"
): Promise<EmergenceOnLoad | undefined> => {
  if (!enabled) return undefined;
  const progress = await readInfernoProgress(em, userid);
  if (quiet) return { progress, raised: null, notDue: "quiet", raid: null };
  if (progress.emergencePending !== null) {
    return replayEmergence(userid, save, progress, progress.emergencePending, now, screen);
  }
  let open = await readOpenRaid(userid);
  if (open && isEmergenceRaid(open) && open.phase === "warning") {
    await dropOpenRaid(userid, open.id);
    open = null;
  }
  const notDue = emergenceDueCheck({
    enabled,
    save,
    progress,
    now,
    underAttack: isAttackActive(save),
    raidOpen: open !== null,
  });
  if (notDue !== null) return { progress, raised: null, notDue, raid: null };

  // Flash saved the level, then left the attack out on a yard at 10% or less (`:172-176`).
  const skipped = emergenceRaidSkipped(save);
  const raised = await raiseEmergence(em, userid, progress.emergenceLevel, now, !skipped);
  if (raised === null) {
    return { progress: await readInfernoProgress(em, userid), raised: null, notDue: "race", raid: null };
  }
  logger.info("Inferno emergence for userid {userid}: the cave goes up to level {level}", {
    event: "inferno-emergence",
    userid,
    level: raised,
    screen,
    raid: !skipped,
  });
  // Should the open fail (another raid got in first), the stage stays
  // pending and the next load opens it (`replayEmergence`).
  const raid = skipped ? null : await openEmergenceRaid(userid, save, raised, now);
  return {
    progress: { ...progress, emergenceLevel: raised, emergenceLastAt: now, emergencePending: skipped ? null : raised },
    raised,
    notDue: null,
    raid,
  };
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
  const progress = await readInfernoProgress(em, userid);
  // A stage still to be played holds them too, the fifth's included (patch 7.12).
  return progress.emergencePending !== null || emergencePausesWildRaids(enabled, save, progress);
};
