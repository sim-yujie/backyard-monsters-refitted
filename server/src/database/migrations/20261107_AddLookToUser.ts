import { Migration } from "@mikro-orm/migrations";

/**
 * Which look each player uses (owner, 4 Nov 2026: "can we log down which
 * players are using modern vs classic for beta6? would be nice to know").
 * The web client sends its Account settings ▸ Look and sound choices once per
 * load and on every change (`POST /player/look`, `services/user/lookReport.ts`);
 * the owner's dashboard counts them. Only the dashboard reads them.
 *
 * - `look_style`: `modern` or `classic` (the Style switch).
 * - `look_music`: `style`, `new` or `flash` (Music).
 * - `look_quality`: `high`, `medium` or `low` (Quality).
 * - `look_font`: `game`, `clear` or `readable` (Font).
 * - `look_seen_at`: when the client last sent them.
 *
 * All null until the player's first load on a client that sends them (the
 * Android and raw Flash builds never do).
 */
export class AddLookToUser extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE "bym"."user"
      ADD COLUMN IF NOT EXISTS "look_style" varchar(8) NULL,
      ADD COLUMN IF NOT EXISTS "look_music" varchar(8) NULL,
      ADD COLUMN IF NOT EXISTS "look_quality" varchar(8) NULL,
      ADD COLUMN IF NOT EXISTS "look_font" varchar(8) NULL,
      ADD COLUMN IF NOT EXISTS "look_seen_at" timestamptz NULL;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE "bym"."user"
      DROP COLUMN IF EXISTS "look_seen_at",
      DROP COLUMN IF EXISTS "look_font",
      DROP COLUMN IF EXISTS "look_quality",
      DROP COLUMN IF EXISTS "look_music",
      DROP COLUMN IF EXISTS "look_style";`);
  }
}
