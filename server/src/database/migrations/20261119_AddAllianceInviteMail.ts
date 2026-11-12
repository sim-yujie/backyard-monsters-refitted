import { Migration } from "@mikro-orm/migrations";

/**
 * Alliance invites by in-game mail (owner, 10 Nov 2026): a Leader or Officer
 * invites a player, and the invite reaches that player's mailbox as a message
 * they can accept or decline from. The invite row stays the source of truth;
 * the message only points at it.
 *
 * - `bym.alliance_invite.invited_by`: the Leader or Officer who sent an
 *   invite (null on requests and on invites sent before this).
 * - `bym.message.allianceinviteid`: on an `allianceinvite` message, the
 *   invite it delivers; null on every other message.
 *
 * Only adds; no row is removed.
 */
export class Migration20261119_AddAllianceInviteMail extends Migration {
  async up(): Promise<void> {
    await this.execute(`ALTER TABLE bym.alliance_invite ADD COLUMN IF NOT EXISTS invited_by INTEGER NULL`);
    await this.execute(`ALTER TABLE bym.message ADD COLUMN IF NOT EXISTS allianceinviteid INTEGER NULL`);
  }

  async down(): Promise<void> {
    await this.execute(`ALTER TABLE bym.message DROP COLUMN IF EXISTS allianceinviteid`);
    await this.execute(`ALTER TABLE bym.alliance_invite DROP COLUMN IF EXISTS invited_by`);
  }
}
