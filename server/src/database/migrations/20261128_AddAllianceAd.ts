import { Migration } from "@mikro-orm/migrations";

/**
 * The marketplace ad (beta 7 alliances, design v5 §7a): how players get in
 * (`join_mode`: open / ask / invite), the ad's language (a chat country code),
 * its GMT band and the lowest level that may ask or join.
 *
 * Existing alliances keep today's behaviour: Ask to join, any language, no
 * time zone, the level floor (30, which takes anyone).
 *
 * Only adds.
 */
export class Migration20261128_AddAllianceAd extends Migration {
  async up(): Promise<void> {
    await this.execute(`ALTER TABLE bym.alliance ADD COLUMN IF NOT EXISTS join_mode VARCHAR(8) NOT NULL DEFAULT 'ask'`);
    await this.execute(`ALTER TABLE bym.alliance ADD COLUMN IF NOT EXISTS language VARCHAR(2)`);
    await this.execute(`ALTER TABLE bym.alliance ADD COLUMN IF NOT EXISTS time_zone SMALLINT`);
    await this.execute(`ALTER TABLE bym.alliance ADD COLUMN IF NOT EXISTS min_level SMALLINT NOT NULL DEFAULT 30`);
  }
}
