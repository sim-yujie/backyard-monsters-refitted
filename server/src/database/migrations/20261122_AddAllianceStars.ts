import { Migration } from "@mikro-orm/migrations";

/**
 * Alliance constellations (beta 7 alliances phase 2, design v5 §9).
 *
 * `bym.alliance.stars`: steps lit per constellation id of the alliance's type,
 * e.g. `{"wormzer": 2}` (each step lights 2 of its 10 stars). A type switch
 * resets it to `{}`.
 *
 * Only adds.
 */
export class Migration20261122_AddAllianceStars extends Migration {
  async up(): Promise<void> {
    await this.execute(`ALTER TABLE bym.alliance ADD COLUMN IF NOT EXISTS stars JSONB NOT NULL DEFAULT '{}'::jsonb`);
  }
}
