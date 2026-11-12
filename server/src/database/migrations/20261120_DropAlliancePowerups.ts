import { Migration } from "@mikro-orm/migrations";

/**
 * The alliance power-ups (Armament, Conquest, Declare War) are removed (owner,
 * alliances phase 0, Nov 2026): nothing reads or writes `bym.alliance_powerup`
 * any more. Live held no rows when this was written. The power-ups had no
 * columns of their own elsewhere (`save.powerups`/`attpowerups` went in
 * 20260908_DropSavePowerupColumns).
 *
 * Old `powerup_*` rows in `bym.alliance_message` stay; the feed shows them with
 * the default text. The `declarewar` flag on old attack rows and `declareWar`
 * on old attack sessions and defence replays are still read, never written.
 *
 * `down` puts the empty table back as 20260908_CreateAlliancePowerupTable made it.
 */
export class Migration20261120_DropAlliancePowerups extends Migration {
  async up(): Promise<void> {
    await this.execute(`DROP TABLE IF EXISTS bym.alliance_powerup`);
  }

  async down(): Promise<void> {
    await this.execute(`
      CREATE TABLE IF NOT EXISTS bym.alliance_powerup (
        alliance_id INTEGER NOT NULL,
        powerup     VARCHAR(32) NOT NULL,
        active      BOOLEAN NOT NULL DEFAULT FALSE,
        end_time    INTEGER NOT NULL,
        updated_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        PRIMARY KEY (alliance_id, powerup),
        CONSTRAINT alliance_powerup_type_check
          CHECK (powerup IN ('ap_armament', 'ap_conquest', 'ap_declarewar')),
        CONSTRAINT alliance_powerup_alliance_id_foreign
          FOREIGN KEY (alliance_id) REFERENCES bym.alliance(id) ON DELETE CASCADE
      )
    `);
  }
}
