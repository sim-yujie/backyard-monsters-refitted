import { Migration } from "@mikro-orm/migrations";

/**
 * Adds `user.map_flat`: the player switched Map Room 2's tilted camera off
 * (MR2 look plan step 4; the tilt is on by default in the Modern look). Off
 * for everyone, so nobody's map changes until the server's `MR2_TILT` switch
 * is on.
 */
export class AddMapFlatToUser extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE "bym"."user" ADD COLUMN IF NOT EXISTS "map_flat" boolean NOT NULL DEFAULT false;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE "bym"."user" DROP COLUMN IF EXISTS "map_flat";`);
  }
}
