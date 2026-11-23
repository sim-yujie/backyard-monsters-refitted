import { postgres } from "../../server.js";
import type { UsageRow } from "./monsterUsage.js";

/**
 * The one write of the dashboard's monster counts (`monsterUsage.ts`), on a
 * connection of its own, so it is never part of a landing's transaction.
 * Kept apart so the landings' tests can stand in for it.
 */

/** Writes a row; a second write of the same attack does nothing. */
export const insertUsageRow = async (row: UsageRow): Promise<void> => {
  await postgres.em.fork().execute(
    `INSERT INTO bym.monster_usage
       (landed_at, day, attacker_userid, attack_started, attack_id, mode, arena, base_type, repeat,
        defender_userid, tribe, camp_level, monsters, champions, damage_before, damage_after,
        flattened, replayed, assumed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?, ?, ?, ?)
     ON CONFLICT (attacker_userid, attack_started, attack_id) DO NOTHING`,
    [
      row.landedAt,
      row.day,
      row.attackerUserid,
      row.attackStarted,
      row.attackId,
      row.mode,
      row.arena,
      row.baseType,
      row.repeat,
      row.defenderUserid,
      row.tribe,
      row.campLevel,
      JSON.stringify(row.monsters),
      JSON.stringify(row.champions),
      row.damageBefore,
      row.damageAfter,
      row.flattened,
      row.replayed,
      row.assumed,
    ]
  );
};

