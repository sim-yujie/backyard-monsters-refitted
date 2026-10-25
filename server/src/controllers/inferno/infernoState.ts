import type { EntityManager } from "@mikro-orm/core";

import type { User } from "../../database/models/user.model.js";
import { Status } from "../../enums/StatusCodes.js";
import { postgres } from "../../server.js";
import { EMERGENCE_LEVELS, caveShown, nextEmergenceAt, type CaveSave } from "../../services/inferno/emergence.js";
import { requireInfernoEnabled } from "../../services/inferno/infernoGate.js";
import {
  DESCENT_YARDS,
  readInfernoProgress,
  type InfernoProgressRecord,
} from "../../services/inferno/infernoProgress.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import type { KoaController } from "../../utils/KoaController.js";

/**
 * `GET /bm/inferno/state` (`docs/design/inferno.md` §3.2): how far the player
 * is on the way into the Inferno, for the cave on the main yard and its
 * menu. Read-only; refused with `403 infernoOff` while the new Inferno is
 * switched off (`infernoConfig.enabled`).
 */

export interface InfernoStateBody {
  error: 0;
  /** The server's clock, unix seconds, so countdowns are right whatever the device says. */
  now: number;
  cave: {
    /** Whether the cave shows on the main yard (Town Hall 5, tutorial over). */
    shown: boolean;
    /** 0-5, one per emergence raid. */
    level: number;
    maxLevel: number;
  };
  emergence: {
    /** Unix seconds the last raid's level-up came, or null. */
    lastAt: number | null;
    /** The earliest the next may come (0: any time), or null once all five are done. */
    nextAt: number | null;
    done: boolean;
  };
  descent: {
    /** Flash's Descent counter: 1 + yards beaten; 14 once passed (`MAPROOM_DESCENT.as:24`). */
    level: number;
    /** The 13 yards in order, 1 once beaten. */
    destroyed: number[];
    passed: boolean;
  };
  /** Whether the player has captured their Inferno yard. */
  hasYard: boolean;
  /** Korath is unlocked and the player has not been told yet (owner I10). */
  korathNotice: boolean;
}

/** The answer, from the player's progress and main yard. Pure. */
export const infernoStateAnswer = (
  progress: InfernoProgressRecord,
  main: CaveSave | null | undefined,
  now: number,
  skipTutorial?: boolean
): InfernoStateBody => {
  const destroyed = Array.from({ length: DESCENT_YARDS }, (_, index): number => (progress.descentDestroyed[index] ? 1 : 0));
  const passed = progress.descentPassedAt !== null;
  const nextAt = nextEmergenceAt(progress);
  return {
    error: 0,
    now,
    cave: {
      shown: main ? caveShown(main, progress, skipTutorial) : false,
      level: progress.emergenceLevel,
      maxLevel: EMERGENCE_LEVELS,
    },
    emergence: { lastAt: progress.emergenceLastAt, nextAt, done: nextAt === null },
    descent: {
      level: passed ? DESCENT_YARDS + 1 : 1 + destroyed.reduce((sum, flag) => sum + flag, 0),
      destroyed,
      passed,
    },
    hasYard: progress.infernoBaseid !== null,
    korathNotice: progress.korathUnlockedAt !== null && progress.korathNoticeAt === null,
  };
};

/** Reads what the answer needs: the player's progress and their main yard. */
export const readInfernoState = async (em: EntityManager, user: User, now: number): Promise<InfernoStateBody> => {
  await em.populate(user, ["save"]);
  const progress = await readInfernoProgress(em, user.userid);
  return infernoStateAnswer(progress, user.save ?? null, now);
};

export const infernoState: KoaController = async (ctx) => {
  requireInfernoEnabled();
  ctx.status = Status.OK;
  ctx.body = await readInfernoState(postgres.em, ctx.authUser, getCurrentDateTime());
};

