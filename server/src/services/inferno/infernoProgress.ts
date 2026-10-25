import type { EntityManager } from "@mikro-orm/core";

import { InfernoProgress } from "../../database/models/infernoprogress.model.js";

/**
 * A player's Inferno progress (`bym.inferno_progress`,
 * `database/models/infernoprogress.model.ts`), read as plain numbers: unix
 * seconds for times. A player with no row reads as {@link NO_INFERNO_PROGRESS}.
 */
export interface InfernoProgressRecord {
  /** The cave's level, 0-5: one per emergence raid. */
  readonly emergenceLevel: number;
  /** Unix seconds the cave last went up a level, or null. */
  readonly emergenceLastAt: number | null;
  /** The 13 Descent yards in order, 1 once beaten. */
  readonly descentDestroyed: readonly number[];
  /** Best damage (0-100) on each Descent yard, in order. */
  readonly descentBest: readonly number[];
  /** Unix seconds the 13th Descent yard fell, or null. */
  readonly descentPassedAt: number | null;
  /** The player's Inferno yard, or null before the capture. */
  readonly infernoBaseid: string | null;
  readonly korathUnlockedAt: number | null;
  readonly korathNoticeAt: number | null;
  /** One-time story popups shown, by key: unix seconds each. */
  readonly popupsSeen: Readonly<Record<string, number>>;
}

export const NO_INFERNO_PROGRESS: InfernoProgressRecord = {
  emergenceLevel: 0,
  emergenceLastAt: null,
  descentDestroyed: [],
  descentBest: [],
  descentPassedAt: null,
  infernoBaseid: null,
  korathUnlockedAt: null,
  korathNoticeAt: null,
  popupsSeen: {},
};

/** The Descent's yards (`maproom_inferno/DescentLayer.as:299-311`, ids 201-213). */
export const DESCENT_YARDS = 13;

const seconds = (date: Date | null | undefined): number | null =>
  date ? Math.floor(new Date(date).getTime() / 1000) : null;

/** Whole numbers from a stored array, anything else read as 0. */
const numbers = (raw: unknown): number[] =>
  Array.isArray(raw) ? raw.slice(0, DESCENT_YARDS).map((value) => Math.max(0, Math.floor(Number(value)) || 0)) : [];

const popups = (raw: unknown): Record<string, number> =>
  raw && typeof raw === "object" && !Array.isArray(raw)
    ? Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Number(value) || 0]))
    : {};

/** A stored row as a record. */
export const progressRecordOf = (row: InfernoProgress | null | undefined): InfernoProgressRecord =>
  row
    ? {
        emergenceLevel: Math.min(5, Math.max(0, Number(row.emergence_level) || 0)),
        emergenceLastAt: seconds(row.emergence_last_at),
        descentDestroyed: numbers(row.descent_destroyed),
        descentBest: numbers(row.descent_best),
        descentPassedAt: seconds(row.descent_passed_at),
        infernoBaseid: row.inferno_baseid ?? null,
        korathUnlockedAt: seconds(row.korath_unlocked_at),
        korathNoticeAt: seconds(row.korath_notice_at),
        popupsSeen: popups(row.popups_seen),
      }
    : NO_INFERNO_PROGRESS;

/** The player's progress; {@link NO_INFERNO_PROGRESS} with no row. */
export const readInfernoProgress = async (em: EntityManager, userid: number): Promise<InfernoProgressRecord> =>
  progressRecordOf(await em.findOne(InfernoProgress, { userid }, { refresh: true }));
