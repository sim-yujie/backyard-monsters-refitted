import { Migration } from "@mikro-orm/migrations";

/**
 * Adds message.byuserid: on the game's attack notices (an outpost attacked
 * or taken, a yard attacked), the player who did it, so the mailbox can offer
 * Add friend on them (friends WP11, issue #378). Null on every other message
 * and on notices written before this. No foreign key: the name is already in
 * the notice's words, and a deleted attacker's id simply finds no one.
 */
export class AddByUserIdToMessage extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE "bym"."message" ADD COLUMN IF NOT EXISTS "byuserid" int NULL;`);
  }
}
