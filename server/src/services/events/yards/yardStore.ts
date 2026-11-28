import type { EntityManager } from "@mikro-orm/core";
import type { EntityManager as SqlEntityManager } from "@mikro-orm/postgresql";

import { RESOURCE_KEYS, type ResourceAmounts } from "../../../game-rules/combat/index.js";
import type { JsonObject } from "../../../types/JsonObject.js";

/**
 * A player's state on each Brukkarg event yard (beta 10, bruk-port), in
 * `bym.event_yard` and `bym.event_yard_copy` (migration
 * `20261210_CreateEventYards.ts`), and the prizes paid, in the run's
 * `bym.event_progress` row (`data.yardPrizes`, a merge, never a rewrite: the
 * wave events keep `counter` and `data.lost` on the same row for Brukkarg War).
 *
 * Raw SQL on the caller's `em`, so the landing writes it in its own
 * transaction. Every write is one statement.
 */

/** How long a damaged yard stays damaged: a day after its first hit (Flash, upstream `BASE_REPAIR_TIME`). */
export const YARD_REPAIR_SECONDS = 24 * 60 * 60;

export interface YardState {
  /** Building health the last landing left (`buildinghealthdata`); `{}` is whole. */
  readonly health: JsonObject;
  readonly destroyed: boolean;
  /** The server's damage, 0-100, of the last landing. */
  readonly damage: number;
  /** When the yard was first hit since it was last whole (unix s). */
  readonly firstAttackedAt: number;
  /** What the yard has given over the whole run. */
  readonly looted: Partial<ResourceAmounts>;
}

const sql = (em: EntityManager): SqlEntityManager => em as SqlEntityManager;

const json = (raw: unknown): JsonObject => {
  const value = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
};

const amounts = (raw: unknown): Partial<ResourceAmounts> => {
  const source = json(raw);
  const out: Partial<ResourceAmounts> = {};
  for (const key of RESOURCE_KEYS) {
    const value = Number(source[key]);
    if (Number.isFinite(value) && value > 0) out[key] = Math.floor(value);
  }
  return out;
};

interface YardRow {
  baseid: string;
  health: unknown;
  destroyed: boolean;
  damage: number | string;
  first_attacked_at: number | string;
  looted: unknown;
}

const stateOf = (row: YardRow): YardState => ({
  health: json(row.health),
  destroyed: Boolean(row.destroyed),
  damage: Number(row.damage) || 0,
  firstAttackedAt: Number(row.first_attacked_at) || 0,
  looted: amounts(row.looted),
});

/** Every yard of the run the player has hit, by base id. */
export const readYardStates = async (em: EntityManager, userid: number, runId: string): Promise<Map<string, YardState>> => {
  const rows = await sql(em).execute<YardRow[]>(
    `SELECT baseid, health, destroyed, damage, first_attacked_at, looted FROM bym.event_yard WHERE userid = ? AND run_id = ?`,
    [userid, runId]
  );
  return new Map(rows.map((row) => [row.baseid, stateOf(row)]));
};

export const readYardState = async (
  em: EntityManager,
  userid: number,
  runId: string,
  baseid: string
): Promise<YardState | null> => {
  const [row] = await sql(em).execute<YardRow[]>(
    `SELECT baseid, health, destroyed, damage, first_attacked_at, looted FROM bym.event_yard WHERE userid = ? AND run_id = ? AND baseid = ?`,
    [userid, runId, baseid]
  );
  return row ? stateOf(row) : null;
};

/**
 * The health the yard fights with now: what its last landing left, or whole
 * once {@link YARD_REPAIR_SECONDS} have passed since its first hit. A
 * destroyed yard is not attacked again (the next one is), so it has none.
 */
export const standingHealth = (state: YardState | null | undefined, now: number): JsonObject => {
  if (!state || state.destroyed) return {};
  return now - state.firstAttackedAt >= YARD_REPAIR_SECONDS ? {} : state.health;
};

/** When a damaged yard is whole again (unix s), or 0 when it is whole or destroyed. */
export const repairsAt = (state: YardState | null | undefined, now: number): number => {
  if (!state || state.destroyed || Object.keys(state.health).length === 0) return 0;
  const at = state.firstAttackedAt + YARD_REPAIR_SECONDS;
  return at > now ? at : 0;
};

/** The state a landing leaves: `firstAttackedAt` kept while the yard is still damaged, else now. */
export const landedState = (
  before: YardState | null,
  after: { health: JsonObject; destroyed: boolean; damage: number; looted: Partial<ResourceAmounts> },
  now: number
): YardState => {
  const stillDamaged = before && !before.destroyed && now - before.firstAttackedAt < YARD_REPAIR_SECONDS;
  return { ...after, firstAttackedAt: stillDamaged ? before.firstAttackedAt : now };
};

export const writeYardState = async (
  em: EntityManager,
  userid: number,
  runId: string,
  baseid: string,
  state: YardState
): Promise<void> => {
  await sql(em).execute(
    `INSERT INTO bym.event_yard (userid, run_id, baseid, health, destroyed, damage, first_attacked_at, looted)
     VALUES (?, ?, ?, ?::jsonb, ?, ?, ?, ?::jsonb)
     ON CONFLICT (userid, run_id, baseid) DO UPDATE SET
       health = EXCLUDED.health, destroyed = EXCLUDED.destroyed, damage = EXCLUDED.damage,
       first_attacked_at = EXCLUDED.first_attacked_at, looted = EXCLUDED.looted, updated_at = now()`,
    [
      userid,
      runId,
      baseid,
      JSON.stringify(state.health),
      state.destroyed,
      Math.max(0, Math.min(100, Math.round(state.damage))),
      Math.floor(state.firstAttackedAt),
      JSON.stringify(state.looted),
    ]
  );
};

/** The player's copied yard for this run, or null when none was made. */
export const readYardCopy = async (em: EntityManager, userid: number, runId: string): Promise<JsonObject | null> => {
  const [row] = await sql(em).execute<{ yard: unknown }[]>(
    `SELECT yard FROM bym.event_yard_copy WHERE userid = ? AND run_id = ?`,
    [userid, runId]
  );
  return row ? json(row.yard) : null;
};

/** Stores the copy unless one is stored already (once per run); returns the one kept. */
export const writeYardCopyOnce = async (
  em: EntityManager,
  userid: number,
  runId: string,
  yard: JsonObject
): Promise<JsonObject> => {
  await sql(em).execute(
    `INSERT INTO bym.event_yard_copy (userid, run_id, yard) VALUES (?, ?, ?::jsonb) ON CONFLICT (userid, run_id) DO NOTHING`,
    [userid, runId, JSON.stringify(yard)]
  );
  return (await readYardCopy(em, userid, runId)) ?? yard;
};

/**
 * Records the prize for `yards` beaten as paid, once: true when this call
 * recorded it. A merge into `data` (`yardPrizes`, a list of yard counts).
 */
export const markPrizePaid = async (em: EntityManager, userid: number, runId: string, yards: number): Promise<boolean> => {
  const rows = await sql(em).execute<{ userid: number }[]>(
    `INSERT INTO bym.event_progress AS p (userid, event_id, data) VALUES (?, ?, jsonb_build_object('yardPrizes', jsonb_build_array(?::int)))
     ON CONFLICT (userid, event_id) DO UPDATE
        SET data = p.data || jsonb_build_object('yardPrizes', COALESCE(p.data->'yardPrizes', '[]'::jsonb) || to_jsonb(?::int)),
            updated_at = now()
      WHERE NOT (COALESCE(p.data->'yardPrizes', '[]'::jsonb) @> to_jsonb(?::int))
     RETURNING userid`,
    [userid, runId, yards, yards, yards]
  );
  return rows.length > 0;
};
