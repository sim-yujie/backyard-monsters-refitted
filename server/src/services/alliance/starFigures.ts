import type { EntityManager } from "@mikro-orm/core";
import type { EntityManager as SqlEntityManager } from "@mikro-orm/postgresql";

import { CONSTELLATIONS } from "../../config/AllianceConfig.js";
import { logger } from "../../utils/logger.js";

/**
 * The star figures the owner draws over each constellation's monster with
 * the in-game star editor (web `ui/alliance/StarEditor.ts`, owner 10 Nov).
 *
 * Kept in `bym.game_setting` under {@link SETTING_KEY} as one JSON object,
 * constellation id to figure. A constellation with no saved figure uses the
 * web's built-in one (`web/src/ui/alliance/starFigures.ts`). Every player's
 * `myalliance` answer carries the saved ones, so a save reaches everyone the
 * next time they open the Constellation tab.
 *
 * A figure lives in the tab's 200 x 170 box: 10 stars as [x, y] (lit two by
 * two in this order), and the lines as pairs of star numbers.
 */

export const SETTING_KEY = "constellation_figures";
export const FIGURE_WIDTH = 200;
export const FIGURE_HEIGHT = 170;
export const FIGURE_STARS = 10;
/** Every pair of 10 stars. */
export const MAX_LINES = 45;

export interface StarFigure {
  stars: [number, number][];
  lines: [number, number][];
}

/** Every constellation id of every type, with its name, type and kind. */
export const allConstellations = () =>
  Object.entries(CONSTELLATIONS).flatMap(([type, list]) =>
    list.map((c) => ({ id: c.id, name: c.name, type, kind: c.kind }))
  );

const knownIds = (): ReadonlySet<string> => new Set(allConstellations().map((c) => c.id));

const round1 = (value: number): number => Math.round(value * 10) / 10;

/** A figure from untrusted JSON, or null when it is not one. Coordinates are rounded to 0.1. */
export const parseFigure = (raw: unknown): StarFigure | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const { stars, lines } = raw as { stars?: unknown; lines?: unknown };
  if (!Array.isArray(stars) || stars.length !== FIGURE_STARS) return null;
  if (!Array.isArray(lines) || lines.length > MAX_LINES) return null;
  const outStars: [number, number][] = [];
  for (const star of stars) {
    if (!Array.isArray(star) || star.length !== 2) return null;
    const [x, y] = star.map(Number) as [number, number];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (x < 0 || x > FIGURE_WIDTH || y < 0 || y > FIGURE_HEIGHT) return null;
    outStars.push([round1(x), round1(y)]);
  }
  const seen = new Set<string>();
  const outLines: [number, number][] = [];
  for (const line of lines) {
    if (!Array.isArray(line) || line.length !== 2) return null;
    const [a, b] = line as unknown[];
    if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
    const lo = Math.min(a as number, b as number);
    const hi = Math.max(a as number, b as number);
    if (lo < 0 || hi >= FIGURE_STARS || lo === hi) return null;
    const key = `${lo}-${hi}`;
    if (seen.has(key)) continue;
    seen.add(key);
    outLines.push([lo, hi]);
  }
  return { stars: outStars, lines: outLines };
};

/** The stored object, keeping only good figures of known constellations. */
export const readFigures = (raw: unknown): Record<string, StarFigure> => {
  const value = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  if (typeof value !== "object" || value === null) return {};
  const ids = knownIds();
  const out: Record<string, StarFigure> = {};
  for (const [id, figure] of Object.entries(value)) {
    const parsed = ids.has(id) ? parseFigure(figure) : null;
    if (parsed) out[id] = parsed;
  }
  return out;
};

const sql = (em: EntityManager) => em as unknown as SqlEntityManager;

/** The saved figures; none when the row is missing or cannot be read. */
export const loadStarFigures = async (em: EntityManager): Promise<Record<string, StarFigure>> => {
  try {
    const [row] = await sql(em).execute<{ value: unknown }[]>(
      `SELECT value FROM bym.game_setting WHERE key = ?`,
      [SETTING_KEY]
    );
    return row ? readFigures(row.value) : {};
  } catch (error) {
    logger.warn("Star figures not read: {error}", { error: String(error) });
    return {};
  }
};

/** A change from the editor: one constellation's figure, or back to the built-in one. */
export type FigureChange = { id: string; figure: StarFigure } | { id: string; reset: true };

/** The editor's body, or the reason it is refused. */
export const parseFigureChange = (body: unknown): { ok: true; change: FigureChange } | { ok: false; reason: string } => {
  const { id, figure, reset } = (body ?? {}) as { id?: unknown; figure?: unknown; reset?: unknown };
  if (typeof id !== "string" || !knownIds().has(id)) return { ok: false, reason: "unknown constellation" };
  if (reset === true) return { ok: true, change: { id, reset: true } };
  // A JSON body's object fields reach the routes as strings (`middleware/jsonBody.ts`).
  let raw: unknown = figure;
  if (typeof figure === "string") {
    try {
      raw = JSON.parse(figure);
    } catch {
      raw = null;
    }
  }
  const parsed = parseFigure(raw);
  if (!parsed) return { ok: false, reason: "a figure needs 10 stars inside 200 x 170 and lines between them" };
  return { ok: true, change: { id, figure: parsed } };
};

/** Saves one change in one statement (no lost update between two saves), then answers with all figures. */
export const saveStarFigure = async (
  em: EntityManager,
  change: FigureChange,
  by: number
): Promise<Record<string, StarFigure>> => {
  if ("reset" in change) {
    await sql(em).execute(`UPDATE bym.game_setting SET value = value - ?::text, updated_at = now(), updated_by = ? WHERE key = ?`, [
      change.id,
      by,
      SETTING_KEY,
    ]);
  } else {
    const entry = JSON.stringify({ [change.id]: change.figure });
    await sql(em).execute(
      `INSERT INTO bym.game_setting (key, value, updated_at, updated_by) VALUES (?, ?::jsonb, now(), ?)
       ON CONFLICT (key) DO UPDATE SET value = bym.game_setting.value || EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [SETTING_KEY, entry, by]
    );
  }
  return loadStarFigures(em);
};
