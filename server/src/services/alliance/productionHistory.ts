import type { EntityManager } from "@mikro-orm/core";
import type { EntityManager as SqlEntityManager } from "@mikro-orm/postgresql";

import type { AllianceType } from "../../enums/Alliance.js";
import { allianceQuery, bonusesFor, productionFactor, type LitSteps } from "./allianceBonuses.js";

/**
 * When a player's alliance production bonus changed, so the time they were
 * away is paid at the factor that held then, not the one that holds now
 * (security review of 78c9156be, 10 Nov 2026). Without it a player away 20 h
 * could join an alliance (or see it light a star, or switch type) and then
 * collect all 20 h at the boosted rate, and leaving would cut time already
 * earned.
 *
 * Every change to a member's factor (join, leave, kick, disband, type switch,
 * a star lit or reset) appends `{until: now, factor: old}` to
 * `bym."user".production_history` for each player it touches. A catch-up
 * then splits its window at those moments ({@link factorPieces}): the old
 * factor up to `until`, the next one after, and the factor read now after the
 * last. Steps a catch-up has passed are dropped ({@link settleProductionHistory}).
 *
 * The column is written only by raw SQL here, never through the User entity,
 * so a flush of a loaded User cannot overwrite a step appended meanwhile.
 */

/** The factor that held up to `until` (Unix seconds). */
export interface FactorStep {
  until: number;
  factor: number;
}

/** A factor over time: each past step up to its `until`, then `current`. */
export interface FactorSchedule {
  past: FactorStep[];
  current: number;
}

/** A flat factor, or one that changed during the window. */
export type ProductionFactor = number | FactorSchedule;

/** One stretch of a window at one factor. */
export interface FactorPiece {
  from: number;
  to: number;
  factor: number;
}

/** The steps as stored, cleaned and sorted; bad entries are dropped. */
export const parseHistory = (raw: unknown): FactorStep[] => {
  const list = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  if (!Array.isArray(list)) return [];
  const steps: FactorStep[] = [];
  for (const entry of list) {
    const until = Number((entry as FactorStep)?.until);
    const factor = Number((entry as FactorStep)?.factor);
    if (Number.isFinite(until) && Number.isFinite(factor) && factor >= 0) steps.push({ until, factor });
  }
  return steps.sort((a, b) => a.until - b.until);
};

/**
 * Splits `from`..`to` into stretches of one factor each. A plain number is one
 * stretch. Steps that ended at or before `from` are already paid and skipped;
 * the factor of the first step that ends after a moment is the one that held
 * then.
 */
export const factorPieces = (from: number, to: number, factor: ProductionFactor): FactorPiece[] => {
  if (typeof factor === "number") return [{ from, to, factor }];
  const pieces: FactorPiece[] = [];
  let at = from;
  for (const step of factor.past) {
    if (step.until <= at) continue;
    if (at >= to) break;
    const end = Math.min(step.until, to);
    pieces.push({ from: at, to: end, factor: step.factor });
    at = end;
  }
  if (at < to || pieces.length === 0) pieces.push({ from: at, to: Math.max(at, to), factor: factor.current });
  return pieces;
};

/** The factor that holds at `now` (the schedule's current one). */
export const factorNow = (factor: ProductionFactor): number => (typeof factor === "number" ? factor : factor.current);

/** True when nothing changed in the schedule: it is a plain factor. */
export const isFlat = (factor: ProductionFactor): boolean =>
  typeof factor === "number" || factor.past.length === 0;

/** The production factor of an alliance of `type` with `stars`; 1 for none. */
export const allianceFactor = (type: AllianceType | null | undefined, stars?: LitSteps | string | null): number =>
  productionFactor(bonusesFor(type, typeof stars === "string" ? (JSON.parse(stars) as LitSteps) : stars));

/**
 * A player's factor over time: their stored steps, then their alliance's
 * factor now. One query; safe inside a transaction.
 */
export const productionScheduleOfUser = async (
  em: EntityManager,
  userid: number | null | undefined
): Promise<FactorSchedule> => {
  if (!userid) return { past: [], current: 1 };
  const [row] = await allianceQuery<{
    type: AllianceType | null;
    stars: LitSteps | string | null;
    production_history: unknown;
  }>(
    em,
    `SELECT a.type, a.stars, u.production_history
       FROM bym."user" u LEFT JOIN bym.alliance a ON a.id = u.alliance_id
      WHERE u.userid = ?`,
    [userid]
  );
  if (!row) return { past: [], current: 1 };
  return { past: parseHistory(row.production_history), current: allianceFactor(row.type, row.stars) };
};

/** The current factor of an alliance, read from the database (1 when gone). */
export const allianceFactorOf = async (em: EntityManager, allianceId: number): Promise<number> => {
  const [row] = await allianceQuery<{ type: AllianceType; stars: LitSteps | string | null }>(
    em,
    `SELECT type, stars FROM bym.alliance WHERE id = ?`,
    [allianceId]
  );
  return row ? allianceFactor(row.type, row.stars) : 1;
};

/**
 * Records that the factor `before` held up to `at` for one player or for
 * every member of an alliance. Call it BEFORE the change is written (for an
 * alliance, while its members still point at it), inside the change's
 * transaction. Does nothing when the factor does not move.
 */
export const noteFactorChange = async (
  em: EntityManager,
  who: { userid: number } | { allianceId: number },
  before: number,
  after: number,
  at: number
): Promise<void> => {
  if (before === after) return;
  const step = JSON.stringify([{ until: at, factor: before }]);
  const [where, id] = "userid" in who ? ["userid = ?", who.userid] : ["alliance_id = ?", who.allianceId];
  await (em as SqlEntityManager).execute(
    `UPDATE bym."user" SET production_history = COALESCE(production_history, '[]'::jsonb) || ?::jsonb WHERE ${where}`,
    [step, id]
  );
};

/**
 * Drops the steps every catch-up of this player has passed: those that ended
 * at or before `upTo`. Only writes when a step is dropped.
 */
export const settleProductionHistory = async (
  em: EntityManager,
  userid: number | null | undefined,
  schedule: ProductionFactor,
  upTo: number
): Promise<void> => {
  if (!userid || typeof schedule === "number" || !schedule.past.some((s) => s.until <= upTo)) return;
  await (em as SqlEntityManager).execute(
    `UPDATE bym."user"
        SET production_history = COALESCE(
          (SELECT jsonb_agg(e) FROM jsonb_array_elements(production_history) e
            WHERE (e->>'until')::numeric > ?),
          '[]'::jsonb)
      WHERE userid = ?`,
    [upTo, userid]
  );
};

/**
 * One number for a stretch paid in whole ticks (the outpost income): each
 * piece's factor weighted by the ticks paid in it. `ticksFrom(t)` is how many
 * ticks are paid from `t` to the end of the window.
 */
export const weightedFactor = (
  from: number,
  to: number,
  factor: ProductionFactor,
  ticksFrom: (start: number) => number
): number => {
  if (isFlat(factor)) return factorNow(factor);
  const all = ticksFrom(from);
  if (!(all > 0)) return factorNow(factor);
  let sum = 0;
  for (const piece of factorPieces(from, to, factor)) {
    const ticks = ticksFrom(piece.from) - (piece.to >= to ? 0 : ticksFrom(piece.to));
    sum += ticks * piece.factor;
  }
  return sum / all;
};
