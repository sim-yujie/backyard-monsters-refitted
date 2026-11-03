import { Migration } from "@mikro-orm/migrations";

/**
 * Adds `user.country` (ISO 3166-1 alpha-2, null until the player picks one)
 * and `user.country_asked` (the one-time prompt after login was answered or
 * put off). A country listed in `CHAT_COUNTRY_ROOMS` opens that country's
 * chat room beside Global (owner 3 Nov 2026). Nobody has a country yet, so
 * nobody's chat changes until they pick one.
 */
export class AddCountryToUser extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE "bym"."user" ADD COLUMN IF NOT EXISTS "country" varchar(2) NULL;`);
    this.addSql(`ALTER TABLE "bym"."user" ADD COLUMN IF NOT EXISTS "country_asked" boolean NOT NULL DEFAULT false;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE "bym"."user" DROP COLUMN IF EXISTS "country_asked";`);
    this.addSql(`ALTER TABLE "bym"."user" DROP COLUMN IF EXISTS "country";`);
  }
}
