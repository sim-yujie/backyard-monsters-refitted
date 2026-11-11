import { Migration } from "@mikro-orm/migrations";

/**
 * The Frontier Pass ("New to Map Room 2", `services/events/mr2Welcome.ts`)
 * goes from one cheap takeover and one free kit to 7 of each, one a day
 * (owner, 11 Nov 2026). Its `bym.event_progress` rows (`event_id =
 * 'mr2-welcome'`) move from `takeoverUsed`/`kitUsed` (+ `takeoverAt`/`kitAt`)
 * to `takeoverUses`/`kitUses` (when each was used, null where not known) and
 * `takeoverDay`/`kitDay` (the UTC day of the last use). A reward already used
 * counts as 1 of 7, used on the day it was used. The 10 days and `start` stay.
 * The code reads a row not yet moved the same way, so the order of deploy and
 * migration does not matter.
 */
const up = (reward: string) => `
  '${reward}Uses', CASE WHEN COALESCE((data->>'${reward}Used')::boolean, false)
    THEN jsonb_build_array(data->'${reward}At') ELSE '[]'::jsonb END,
  '${reward}Day', CASE WHEN COALESCE((data->>'${reward}Used')::boolean, false) AND data->>'${reward}At' IS NOT NULL
    THEN to_jsonb(to_char(to_timestamp((data->>'${reward}At')::bigint) AT TIME ZONE 'UTC', 'YYYY-MM-DD'))
    ELSE 'null'::jsonb END`;

/** Back to one set: used when any was used, at the first known time. */
const down = (reward: string) => `
  '${reward}Used', jsonb_array_length(COALESCE(data->'${reward}Uses', '[]'::jsonb)) > 0,
  '${reward}At', COALESCE(data->'${reward}Uses'->0, 'null'::jsonb)`;

/** The move to seven sets (exported for `mr2Welcome.db.test.ts`). */
export const SEVEN_SETS_UP = `
      UPDATE bym.event_progress
         SET data = (data - 'takeoverUsed' - 'kitUsed' - 'takeoverAt' - 'kitAt')
                    || jsonb_build_object(${up("takeover")}, ${up("kit")}),
             updated_at = now()
       WHERE event_id = 'mr2-welcome' AND data->'takeoverUses' IS NULL;`;

/** Back to one set. */
export const SEVEN_SETS_DOWN = `
      UPDATE bym.event_progress
         SET data = (data - 'takeoverUses' - 'kitUses' - 'takeoverDay' - 'kitDay')
                    || jsonb_build_object(${down("takeover")}, ${down("kit")}),
             updated_at = now()
       WHERE event_id = 'mr2-welcome' AND data->'takeoverUses' IS NOT NULL;`;

export class Mr2WelcomeSevenSets extends Migration {
  async up(): Promise<void> {
    this.addSql(SEVEN_SETS_UP);
  }

  async down(): Promise<void> {
    this.addSql(SEVEN_SETS_DOWN);
  }
}
