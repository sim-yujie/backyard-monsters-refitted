import { Migration } from "@mikro-orm/migrations";

/**
 * Alliance types (beta 7 alliances, design v5 §4; owner 10 Nov 2026).
 *
 * `bym.alliance` gains:
 * - `type`: midas / conquest / fortress, which sets the member limit (15 / 30
 *   / 60) and the Officer limit (2 / 4 / 6, `config/AllianceConfig.ts`).
 * - `type_changed_at`: when the type last changed; a down switch waits 14 days
 *   from here.
 * - `points` and `points_spent`: alliance points, unspent and spent on stars.
 *   Nothing earns or spends them yet; the type switch converts them.
 *
 * An alliance that already exists gets the smallest type its members fit,
 * so none is over its limit (the old single limit was 50; anything over 30 is
 * a Fortress Legion).
 *
 * The feed's message-type check gains the new rows: officer, demoted,
 * type_changed, renamed, takeover.
 *
 * Only adds; no row is removed.
 */
export class Migration20261115_AddAllianceTypes extends Migration {
  async up(): Promise<void> {
    await this.execute(`
      ALTER TABLE bym.alliance
        ADD COLUMN IF NOT EXISTS type VARCHAR(16) NOT NULL DEFAULT 'midas',
        ADD COLUMN IF NOT EXISTS type_changed_at TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS points INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS points_spent INTEGER NOT NULL DEFAULT 0
    `);

    await this.execute(`
      UPDATE bym.alliance a
         SET type = CASE WHEN m.members > 30 THEN 'fortress' WHEN m.members > 15 THEN 'conquest' ELSE 'midas' END
        FROM (
          SELECT a2.id, count(u.userid) AS members
            FROM bym.alliance a2
            LEFT JOIN bym."user" u ON u.alliance_id = a2.id
           GROUP BY a2.id
        ) m
       WHERE m.id = a.id
    `);

    await this.execute(`ALTER TABLE bym.alliance DROP CONSTRAINT IF EXISTS alliance_type_check`);
    await this.execute(`
      ALTER TABLE bym.alliance
      ADD CONSTRAINT alliance_type_check CHECK (type IN ('midas', 'conquest', 'fortress'))
    `);

    await this.execute(`ALTER TABLE bym.alliance_message DROP CONSTRAINT IF EXISTS alliance_message_type_check`);
    await this.execute(`
      ALTER TABLE bym.alliance_message
      ADD CONSTRAINT alliance_message_type_check
      CHECK (message_type IN (
        'message',
        'joined',
        'left',
        'kicked',
        'promoted',
        'created',
        'relationship',
        'powerup_activated',
        'powerup_purchase',
        'officer',
        'demoted',
        'type_changed',
        'renamed',
        'takeover'
      ))
    `);
  }
}
