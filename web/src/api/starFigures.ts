import { call, type AllianceResult } from "@/api/alliance";
import { get, postJson } from "@/api/http";
import type { StarFigure } from "@/ui/alliance/starFigures";

/**
 * The star editor's calls (server `controllers/admin/starFigures.ts`),
 * owner-only: anyone else gets the dashboard's plain 404.
 */

const ROUTE = "/api/:apiVersion/admin/star-figures";

/** One constellation the editor can draw. */
export interface EditorConstellation {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly kind: "strength" | "weakness";
}

export interface StarFiguresAnswer {
  readonly constellations: readonly EditorConstellation[];
  /** The saved figures by constellation id; checked before use. */
  readonly figures: Readonly<Record<string, unknown>>;
}

export interface StarFiguresApi {
  load(): Promise<AllianceResult<StarFiguresAnswer>>;
  /** Saves a figure, or with null drops the saved one so the built-in one shows. */
  save(id: string, figure: StarFigure | null): Promise<AllianceResult<StarFiguresAnswer>>;
}

const pick = (body: Record<string, unknown>): StarFiguresAnswer => ({
  constellations: Array.isArray(body.constellations) ? (body.constellations as EditorConstellation[]) : [],
  figures: typeof body.figures === "object" && body.figures !== null ? (body.figures as Record<string, unknown>) : {},
});

export const starFiguresApi: StarFiguresApi = {
  load: () => call(() => get(ROUTE), pick),
  save: (id, figure) =>
    call(() => postJson(ROUTE, figure ? { id, figure: { stars: figure.stars, lines: figure.lines } } : { id, reset: true }), pick),
};
