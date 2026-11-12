import { Migration } from "@mikro-orm/migrations";

/**
 * Retires every Map Room 1 bot for good (owner, 12 Nov 2026: "bots can be
 * decommissioned from game. we have a sufficiently big population now.").
 * The code side is `BOTS_RETIRED` (`config/BotConfig.ts`): no bot fills a
 * list, grows, rebalances or takes revenge any more. This moves the bots
 * there are off the map, as `bots.ts retire-all` (`retireAllBots`) and the
 * sweep's own retirement always have:
 *
 * 1. Each active bot's main yard goes to Map Room 2 with no world
 *    (`mapversion` 2, `worldid` null): on no map, in no list (every Map Room 1
 *    list reads `mapversion` 1 saves only, `updateNeighbourData`).
 * 2. Its `bot` row becomes `retired`. Nothing is deleted: the account, the
 *    yard and the row stay, so attack logs, defence replays, mail and the
 *    admin pages keep the bot's name, and `isBot` still keeps it out of
 *    leaderboards, logins, gifts and the Inferno.
 * 3. Every pending bot job (grow, repair, revenge, truce and friend answers)
 *    is deleted. A seeded Map Room 2 dev player's jobs are kept (none exist on
 *    production).
 * 4. Each player's cached Map Room 1 list loses its bots, and a list that had
 *    any is marked for a fresh search on its next read
 *    (`neighbors_last_calculated` null, `needsNewNeighbours`), so the empty
 *    places fill with real players at once instead of after the 2-week cache.
 *    Real neighbours stay with their attack counters, which the search
 *    carries over (`carryAttackCounters`).
 *
 * Seeded rows (`state = 'seeded'`) are not bots and are left alone. Safe to
 * run again: a second run finds no active bot and no list holding one.
 *
 * No `down`: putting bots back on the map is not wanted, and their yards and
 * rows are all still there should it ever be.
 */
export const RETIRE_BOTS_SQL: readonly string[] = [
  `UPDATE "bym"."save" s SET "mapversion" = 2, "worldid" = NULL
     FROM "bym"."bot" b
    WHERE s."userid" = b."userid" AND b."state" = 'active' AND s."type" = 'main';`,
  `UPDATE "bym"."bot" SET "state" = 'retired', "retired_at" = now() WHERE "state" = 'active';`,
  `DELETE FROM "bym"."bot_job" j
    USING "bym"."bot" b
    WHERE j."bot_userid" = b."userid" AND b."state" <> 'seeded';`,
  `UPDATE "bym"."maproom" m
      SET "neighbors" = COALESCE(
            (SELECT jsonb_agg(n.entry ORDER BY n.position)
               FROM jsonb_array_elements(m."neighbors") WITH ORDINALITY AS n(entry, position)
              WHERE NOT EXISTS (
                SELECT 1 FROM "bym"."bot" b
                 WHERE b."userid"::text = n.entry->>'userid' AND b."state" <> 'seeded')),
            '[]'::jsonb),
          "neighbors_last_calculated" = NULL
    WHERE jsonb_typeof(m."neighbors") = 'array'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(m."neighbors") AS n(entry)
          JOIN "bym"."bot" b ON b."userid"::text = n.entry->>'userid'
         WHERE b."state" <> 'seeded');`,
];

export class RetireBots extends Migration {
  async up(): Promise<void> {
    for (const statement of RETIRE_BOTS_SQL) this.addSql(statement);
  }
}
