import { call, getFrom, nothing, postTo, type AllianceResult, type AllianceType } from "@/api/alliance";

/**
 * The alliance dashboard's phase 2 data and actions (design v5 §7b, §8, §9a,
 * §11), served by `server/src/controllers/alliance/allianceProgress.ts` and
 * the extra fields of `myalliance`.
 */

/** One constellation of the alliance's type, as the Constellation tab draws it. */
export interface ConstellationView {
  readonly id: string;
  readonly name: string;
  readonly kind: "strength" | "weakness";
  /** Steps lit, 0-5 (each step = 2 stars). */
  readonly steps: number;
  /** Points for the next step, or null when all 10 stars are lit. */
  readonly next_price: number | null;
  /** The price of steps 1-5. */
  readonly prices: readonly (number | null)[];
  /** Members suggesting its next step. */
  readonly suggest_count: number;
  /** Each stat it moves: its value at start, then after steps 1-5. */
  readonly effects: readonly { readonly stat: string; readonly values: readonly number[] }[];
}

/** One weekly goal. */
export interface GoalView {
  readonly id: number;
  readonly kind: string;
  readonly name: string;
  readonly tier: "easy" | "medium" | "hard";
  readonly target: number;
  readonly points: number;
  readonly progress: number;
  readonly done: boolean;
  readonly removable: boolean;
}

/** One goal the Leader or an Officer can add. */
export interface GoalMenuItem {
  readonly kind: string;
  readonly name: string;
  readonly only: AllianceType | null;
  readonly tiers: readonly { readonly tier: GoalView["tier"]; readonly target: number; readonly points: number }[];
}

/** What `myalliance` adds in phase 2 (all optional: an older server sends none). */
export interface AllianceProgressFields {
  readonly bonuses?: Readonly<Record<string, number>>;
  readonly stars?: Readonly<Record<string, number>>;
  readonly constellations?: readonly ConstellationView[];
  /** The owner's drawn star figures by constellation id (`ui/alliance/starFigures.ts`); checked before use. */
  readonly star_figures?: Readonly<Record<string, unknown>>;
  /** The owner (an admin): the Constellation tab shows the star editor button. */
  readonly can_edit_stars?: boolean;
  readonly my_suggestion?: string | null;
  readonly last_lit?: { readonly id: string | null; readonly step: number; readonly by: string; readonly at: number } | null;
  readonly territory?: { readonly rank: number; readonly of: number; readonly month: number; readonly badge: number | null } | null;
  readonly today?: {
    readonly contributed: number;
    readonly members: number;
    readonly points_today: number;
    readonly helped_ids: readonly number[];
  };
  readonly week_ends_at?: number;
  readonly goals?: readonly GoalView[];
  readonly goal_menu?: readonly GoalMenuItem[];
  readonly goals_per_week?: number;
  readonly top_helpers?: readonly { readonly userid: number; readonly username: string; readonly quests: number; readonly goal_share: number }[];
}

/** One row of a territory board. */
export interface TerritoryRow {
  readonly rank: number;
  readonly alliance_id: number;
  readonly name: string;
  readonly image: number;
  readonly month: number;
  readonly all_time: number;
  readonly badge: number | null;
}

/** One All news line. */
export interface NewsLine {
  readonly name: string;
  readonly text: string;
  readonly ts: number;
  readonly type: string;
  readonly cell?: { readonly x: number; readonly y: number };
}

export interface AllianceProgressApi {
  lightStar(constellation: string): Promise<AllianceResult<object>>;
  suggestStar(constellation: string): Promise<AllianceResult<object>>;
  setGoal(kind: string, tier: GoalView["tier"]): Promise<AllianceResult<object>>;
  removeGoal(goalId: number): Promise<AllianceResult<object>>;
  territory(type: AllianceType): Promise<AllianceResult<{ rows: readonly TerritoryRow[] }>>;
  news(): Promise<AllianceResult<{ news: readonly NewsLine[] }>>;
}

const listOf = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

export const allianceProgressApi: AllianceProgressApi = {
  lightStar: (constellation) => call(postTo("lightstar", { constellation }), nothing),
  suggestStar: (constellation) => call(postTo("suggeststar", { constellation }), nothing),
  setGoal: (kind, tier) => call(postTo("setgoal", { kind, tier }), nothing),
  removeGoal: (goalId) => call(postTo("removegoal", { goal_id: goalId }), nothing),
  territory: (type) =>
    call(getFrom(`territory?type=${encodeURIComponent(type)}`), (body) => ({ rows: listOf<TerritoryRow>(body["rows"]) })),
  news: () => call(getFrom("news"), (body) => ({ news: listOf<NewsLine>(body["news"]) })),
};
