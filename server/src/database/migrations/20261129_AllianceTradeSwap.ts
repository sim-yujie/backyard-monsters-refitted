import { Migration } from "@mikro-orm/migrations";

/**
 * A trade request is now a 1:1 swap (owner, 11 Nov 2026): "I give 1,000
 * Twigs, I want 1,000 Goo"; a mate who agrees accepts and both get 90%
 * (`services/alliance/trade.ts`). The old Ask ("give me Goo, for my Town
 * Hall") goes.
 *
 * - `give_key`, `want_key`, `amount`: the swap. What the asker gives is taken
 *   from their yard when they post (held by the request), so a request no
 *   longer names amounts per resource or what for.
 * - Old-style requests never held anything, so dropping them loses nothing:
 *   open ones close, then every old row goes with `amounts` and `reason`.
 *   Feature not live yet (beta 7 alliances); only test rows exist.
 * - `alliance_id` no longer cascades: a disbanded alliance must not delete a
 *   request that holds a player's resources. It is set NULL, and the next
 *   refund (`refundStaleRequests`) gives them back.
 */
export class Migration20261129_AllianceTradeSwap extends Migration {
  async up(): Promise<void> {
    await this.execute(`ALTER TABLE bym.alliance_trade_request ADD COLUMN IF NOT EXISTS give_key VARCHAR(2)`);
    await this.execute(`ALTER TABLE bym.alliance_trade_request ADD COLUMN IF NOT EXISTS want_key VARCHAR(2)`);
    await this.execute(`ALTER TABLE bym.alliance_trade_request ADD COLUMN IF NOT EXISTS amount INT`);
    await this.execute(`DELETE FROM bym.alliance_trade_request WHERE give_key IS NULL OR want_key IS NULL OR amount IS NULL`);
    await this.execute(`ALTER TABLE bym.alliance_trade_request ALTER COLUMN give_key SET NOT NULL`);
    await this.execute(`ALTER TABLE bym.alliance_trade_request ALTER COLUMN want_key SET NOT NULL`);
    await this.execute(`ALTER TABLE bym.alliance_trade_request ALTER COLUMN amount SET NOT NULL`);
    await this.execute(`ALTER TABLE bym.alliance_trade_request DROP COLUMN IF EXISTS amounts`);
    await this.execute(`ALTER TABLE bym.alliance_trade_request DROP COLUMN IF EXISTS reason`);

    await this.execute(`ALTER TABLE bym.alliance_trade_request ALTER COLUMN alliance_id DROP NOT NULL`);
    await this.execute(
      `ALTER TABLE bym.alliance_trade_request DROP CONSTRAINT IF EXISTS alliance_trade_request_alliance_id_fkey`
    );
    await this.execute(`
      ALTER TABLE bym.alliance_trade_request
      ADD CONSTRAINT alliance_trade_request_alliance_id_fkey
      FOREIGN KEY (alliance_id) REFERENCES bym.alliance(id) ON DELETE SET NULL`);
    // The refund on a yard load looks for the player's own open request.
    await this.execute(
      `CREATE INDEX IF NOT EXISTS alliance_trade_request_open_expiry ON bym.alliance_trade_request (expires_at) WHERE status = 'open'`
    );
  }

  async down(): Promise<void> {
    await this.execute(`DROP INDEX IF EXISTS bym.alliance_trade_request_open_expiry`);
    await this.execute(`DELETE FROM bym.alliance_trade_request WHERE alliance_id IS NULL OR status = 'open'`);
    await this.execute(
      `ALTER TABLE bym.alliance_trade_request DROP CONSTRAINT IF EXISTS alliance_trade_request_alliance_id_fkey`
    );
    await this.execute(`
      ALTER TABLE bym.alliance_trade_request
      ADD CONSTRAINT alliance_trade_request_alliance_id_fkey
      FOREIGN KEY (alliance_id) REFERENCES bym.alliance(id) ON DELETE CASCADE`);
    await this.execute(`ALTER TABLE bym.alliance_trade_request ALTER COLUMN alliance_id SET NOT NULL`);
    await this.execute(`ALTER TABLE bym.alliance_trade_request ADD COLUMN IF NOT EXISTS amounts JSONB NOT NULL DEFAULT '{}'`);
    await this.execute(`ALTER TABLE bym.alliance_trade_request ADD COLUMN IF NOT EXISTS reason VARCHAR(16)`);
    await this.execute(`ALTER TABLE bym.alliance_trade_request DROP COLUMN IF EXISTS give_key`);
    await this.execute(`ALTER TABLE bym.alliance_trade_request DROP COLUMN IF EXISTS want_key`);
    await this.execute(`ALTER TABLE bym.alliance_trade_request DROP COLUMN IF EXISTS amount`);
  }
}
