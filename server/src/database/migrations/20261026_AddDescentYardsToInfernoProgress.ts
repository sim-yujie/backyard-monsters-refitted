import { Migration } from "@mikro-orm/migrations";

/**
 * Adds `descent_yards` to `bym.inferno_progress` (`docs/design/inferno.md`
 * §2.4, WP 1.12): what each Descent yard not yet beaten kept from the attacks
 * on it, by base id, `{ health, looted }`: its `buildinghealthdata` after the
 * last attack and what it has given up. A yard keeps its damage between
 * attacks, as a Map Room 1 tribe does, so a loss is not a fresh yard to loot
 * again. Forgotten once the yard is beaten.
 *
 * Additive only: a new column with a default.
 */
export class AddDescentYardsToInfernoProgress extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "bym"."inferno_progress"
        ADD COLUMN IF NOT EXISTS "descent_yards" jsonb NOT NULL DEFAULT '{}'::jsonb
          CHECK (jsonb_typeof("descent_yards") = 'object');
    `);
  }
}
