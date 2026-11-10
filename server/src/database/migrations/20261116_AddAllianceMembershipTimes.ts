import { Migration } from "@mikro-orm/migrations";

/**
 * When a player joined and last left an alliance (alliances phase 0, owner
 * 10 Nov 2026).
 *
 * `bym."user"` gains:
 * - `alliance_left_at`: when they last left or were kicked; they may not found,
 *   ask to join, be invited to or accept an alliance for 24 hours after
 *   (`REJOIN_COOLDOWN_HOURS`, `config/AllianceConfig.ts`).
 * - `alliance_joined_at`: when they joined their current alliance; the
 *   absent-leader takeover picks the longest-serving player by it.
 *
 * Players already in an alliance get its founding time as their join time.
 *
 * Only adds; no row is removed.
 */
export class Migration20261116_AddAllianceMembershipTimes extends Migration {
  async up(): Promise<void> {
    await this.execute(`
      ALTER TABLE bym."user"
        ADD COLUMN IF NOT EXISTS alliance_left_at TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS alliance_joined_at TIMESTAMPTZ NULL
    `);

    await this.execute(`
      UPDATE bym."user" u
         SET alliance_joined_at = a.created_at
        FROM bym.alliance a
       WHERE u.alliance_id = a.id
         AND u.alliance_joined_at IS NULL
    `);
  }

  async down(): Promise<void> {
    await this.execute(`
      ALTER TABLE bym."user"
        DROP COLUMN IF EXISTS alliance_left_at,
        DROP COLUMN IF EXISTS alliance_joined_at
    `);
  }
}
