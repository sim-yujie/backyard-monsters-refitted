import type { EntityManager } from "@mikro-orm/core";

import { InfernoMaproom } from "../../database/models/infernomaproom.model.js";
import { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { BaseType } from "../../enums/Base.js";
import { noInfernoYardErr } from "../../errors/errors.js";
import type { TribeData } from "../../types/TribeData.js";
import {
  currentInfernoTribes,
  infernoTribeRespawnAt,
  infernoTribeRespawned,
  respawnInfernoTribe,
  type InfernoTribeSlot,
} from "./infernoTribes.js";

/**
 * The player's seven Moloch tribes as they stand now (`docs/design/inferno.md`
 * §2.7, WP 2.7), from their `maproom_inferno` row: what attacks did to each,
 * kept until it respawns an hour after it fell.
 *
 * Reading them stands back up every tribe whose hour is up and drops the
 * tribes of another tier (the Inferno yard's level moved on), as Map Room 1
 * does (`createMR1Tribes.ts`). The row is made the first time. Nothing else
 * is written; the caller flushes.
 */

/**
 * The caller's Inferno yard, read without a lock: the one their main save
 * names, of the Inferno type and theirs. `409 noInfernoYard` when there is
 * none (the 13th Descent win makes it).
 */
export const findInfernoYard = async (em: EntityManager, user: User, main: Save): Promise<Save> => {
  const baseid = Number(main.baseid_inferno);
  if (!(baseid > 0)) throw noInfernoYardErr();
  const yard = await em.findOne(Save, { baseid: String(baseid) });
  if (!yard || yard.type !== BaseType.INFERNO || yard.userid !== user.userid) throw noInfernoYardErr();
  return yard;
};

/** One tribe as the map shows it. */
export interface InfernoTribeView {
  baseid: string;
  level: number;
  /** 1 while it lies wrecked. */
  destroyed: 0 | 1;
  /** When a wrecked tribe is back (unix seconds), 0 while it stands. */
  respawnat: number;
  /** The last attack's damage this tribe life, 0-100. */
  damage: number;
}

export interface InfernoTribes {
  row: InfernoMaproom;
  slots: InfernoTribeSlot[];
  /** Whether the row changed and wants a flush. */
  changed: boolean;
}

/**
 * The player's tribes at Inferno level `level`, with their row (made and
 * persisted when there was none) and the respawns done.
 */
export const loadInfernoTribes = async (
  em: EntityManager,
  userid: number,
  level: number,
  now: number
): Promise<InfernoTribes> => {
  const slots = currentInfernoTribes(level);
  const current = new Set(slots.map((slot) => slot.baseid));

  let row = await em.findOne(InfernoMaproom, { userid });
  let changed = false;
  if (!row) {
    row = em.create(InfernoMaproom, { userid });
    em.persist(row);
    changed = true;
  }

  const kept = (row.tribedata ?? []).filter((tribe) => current.has(String(tribe.baseid)));
  if (kept.length !== (row.tribedata ?? []).length) changed = true;

  for (const tribe of kept) {
    if (infernoTribeRespawned(tribe, now)) {
      respawnInfernoTribe(tribe);
      changed = true;
    }
  }

  if (changed) {
    row.tribedata = kept;
    em.persist(row);
  }
  return { row, slots, changed };
};

/** The stored state of one tribe, or undefined while nothing has attacked it this life. */
export const infernoTribeOf = (row: InfernoMaproom, baseid: string): TribeData | undefined =>
  (row.tribedata ?? []).find((tribe) => String(tribe.baseid) === baseid);

/** The seven tribes as the map shows them. */
export const infernoTribeViews = ({ row, slots }: Pick<InfernoTribes, "row" | "slots">): InfernoTribeView[] =>
  slots.map((slot) => {
    const tribe = infernoTribeOf(row, slot.baseid);
    return {
      baseid: slot.baseid,
      level: slot.level,
      destroyed: tribe?.destroyed ? 1 : 0,
      respawnat: infernoTribeRespawnAt(tribe),
      damage: Math.max(0, Math.min(100, Math.floor(tribe?.damage ?? 0))),
    };
  });
