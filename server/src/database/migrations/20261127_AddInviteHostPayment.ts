import { Migration } from "@mikro-orm/migrations";

/**
 * An invitation to move is paid by both players (beta 7 alliances, design v5
 * §12): the one who invites picks Shiny or resources for their share when
 * sending, kept on the `migraterequest` message. Null on every other message
 * and on invitations sent before (the invited player alone pays the old
 * price, `LEGACY_INVITE_PRICE` in `services/mail/inviteRules.ts`).
 *
 * Only adds.
 */
export class Migration20261127_AddInviteHostPayment extends Migration {
  async up(): Promise<void> {
    await this.execute(`ALTER TABLE bym.message ADD COLUMN IF NOT EXISTS hostpayment VARCHAR(10)`);
  }
}
