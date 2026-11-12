import { Migration } from "@mikro-orm/migrations";

const TYPES_BEFORE = [
  "message",
  "joined",
  "left",
  "kicked",
  "promoted",
  "created",
  "relationship",
  "powerup_activated",
  "powerup_purchase",
  "officer",
  "demoted",
  "type_changed",
  "renamed",
  "takeover",
];

const typeCheck = (types: string[]) => `
  ALTER TABLE bym.alliance_message
  ADD CONSTRAINT alliance_message_type_check
  CHECK (message_type IN (${types.map((type) => `'${type}'`).join(", ")}))
`;

/**
 * Under-attack alerts in the Alliance chat room (beta 7 alliances, design v5
 * §12): the feed's message-type check gains `under_attack`. Its `body` holds
 * the attacked yard's cell, whether it is an outpost, and the attacker's name
 * (`services/alliance/shoutText.ts`).
 *
 * Only widens the check; `down` removes the new rows first, then narrows it.
 */
export class Migration20261121_AddUnderAttackMessageType extends Migration {
  async up(): Promise<void> {
    await this.execute(`ALTER TABLE bym.alliance_message DROP CONSTRAINT IF EXISTS alliance_message_type_check`);
    await this.execute(typeCheck([...TYPES_BEFORE, "under_attack"]));
  }

  async down(): Promise<void> {
    await this.execute(`DELETE FROM bym.alliance_message WHERE message_type = 'under_attack'`);
    await this.execute(`ALTER TABLE bym.alliance_message DROP CONSTRAINT IF EXISTS alliance_message_type_check`);
    await this.execute(typeCheck(TYPES_BEFORE));
  }
}
