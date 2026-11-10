import { Migration } from "@mikro-orm/migrations";

/**
 * When a player's alliance production bonus changed
 * (`services/alliance/productionHistory.ts`): `bym."user".production_history`,
 * a list of `{until, factor}` steps, so time away is paid at the factor that
 * held then. Empty for nearly everyone; written only by raw SQL.
 *
 * Only adds.
 */
export class Migration20261123_AddProductionHistory extends Migration {
  async up(): Promise<void> {
    await this.execute(
      `ALTER TABLE bym."user" ADD COLUMN IF NOT EXISTS production_history JSONB NOT NULL DEFAULT '[]'::jsonb`
    );
  }
}
