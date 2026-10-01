/**
 * The new-player tutorial's server record, `save.onboarding`
 * (`docs/design/tutorial.md` §8.1, issue #227).
 *
 * One jsonb column on the main save holds everything the guided start, Goals
 * and the screen tips need to remember: the guide's step, a ledger of every
 * grant, the practice camp's state, goal claims, server-side counters and the
 * tips already seen. Only the main save's row holds it.
 *
 * The client can never write it. It is not a `@FrontendKey` (an attacker's
 * load of somebody's yard never carries it) and it is in neither
 * `Save.saveKeys` nor `Save.attackSaveKeys`, so `/base/save` cannot touch it.
 * Only yard actions (through `YardSlices.onboarding`) and the server's own
 * counter hooks write it, always through {@link updateOnboarding} so a write
 * never loses a field another package owns.
 *
 * A `NULL` column reads as {@link LEGACY_ONBOARDING}: a save from before this
 * column existed, a sandbox yard, or a yard made while the `guidedStart`
 * switch is off. Such a player never sees the guided start, and Goals marks
 * whatever they already meet as claimed without a reward (the baseline,
 * decision Q1 of 2026-10-01).
 */

/** Where the guided start stands for this account. */
export type GuideState =
  /** A new account that has not seen step 1 yet. */
  | "pending"
  /** Running: `step` says which macro step. */
  | "active"
  /** Finished at the last step. */
  | "done"
  /** Skipped from Bob's bubble; nothing more is granted. */
  | "skipped"
  /** An account from before the tutorial: never shown it. */
  | "legacy";

export const GUIDE_STATES: readonly GuideState[] = ["pending", "active", "done", "skipped", "legacy"];

/** The guide's progress. The macro step names are the guided start package's (`guidedStart.ts`). */
export interface GuideRecord {
  state: GuideState;
  /** The macro step while `pending` or `active`, e.g. `"build-sniper"`. */
  step?: string;
  /** Unix seconds the guide went `active`. */
  startedAt?: number;
  /** Unix seconds it went `done` or `skipped`. */
  endedAt?: number;
}

/**
 * One grant, under its ledger key in {@link Onboarding.grants}: `fund:<type>`
 * (a top-up, the shortfall paid per resource), `finish:<type>` (a free
 * finish), and the like. `id` is the building it was for.
 */
export interface GrantRecord {
  r1?: number;
  r2?: number;
  r3?: number;
  r4?: number;
  /** The building the grant paid for or finished. */
  id?: number;
  /** Unix seconds. */
  at: number;
}

/** One free-Pokey top-up: how many were added. */
export interface ArmyGrant {
  added: number;
  at: number;
}

/**
 * Every grant the guided start has made, at most once per key (anti-cheat
 * rule 2, §8.4). `army` is a list: the first gift and each free retry.
 */
export interface GrantLedger {
  army?: ArmyGrant[];
  [key: string]: GrantRecord | ArmyGrant[] | undefined;
}

/** The private practice camp (§5.5). */
export type CampState = "none" | "open" | "removed";

export interface CampRecord {
  state: CampState;
  openedAt?: number;
  removedAt?: number;
}

/** One goal's record. `claimed` is `"baseline"` for a goal met before Goals existed (no reward). */
export interface GoalRecord {
  /** Unix seconds the condition was first seen met; sticky (§6.2). */
  done?: number;
  /** Unix seconds the reward was paid, or `"baseline"`. */
  claimed?: number | "baseline";
}

/** The Map Room 1 tribes whose destruction Goals counts (WM1-WM4). */
export type TribeCounterName = "legionnaire" | "kozu" | "abunakki" | "dreadnaut";

/**
 * Counters only server events move (§6.2, anti-cheat rule 8): `save.stats`
 * cannot be trusted for them because `/base/save` lets a client write it.
 */
export interface OnboardingCounters {
  mushrooms: number;
  goldMushrooms: number;
  /** The most banked by one request (Collect all counts as one tap). */
  bestBank: number;
  juiced: number;
  /** Finished Wild Monster Baiter practice runs (goal N1, decision of 2026-10-01). */
  baiterRuns: number;
  tribes: Record<TribeCounterName, number>;
}

/** The whole column, version 1. */
export interface Onboarding {
  v: 1;
  guide: GuideRecord;
  grants: GrantLedger;
  /** Unix seconds the staged raid was watched (goal D1); 1 on a legacy save. */
  raidSeen?: number;
  camp: CampRecord;
  goals: Record<string, GoalRecord>;
  /**
   * The Goals baseline (decision Q1): `"pending"` until the Goals package has
   * marked the goals this save already met as claimed without a reward, then
   * the unix second it did. Absent on a new account, which has none to mark.
   */
  goalsBaseline?: "pending" | number;
  counters: OnboardingCounters;
  /** Screen id to the unix second its tips were seen or skipped. */
  tips: Record<string, number>;
}

/** Fresh counters, all zero. */
export const emptyCounters = (): OnboardingCounters => ({
  mushrooms: 0,
  goldMushrooms: 0,
  bestBank: 0,
  juiced: 0,
  baiterRuns: 0,
  tribes: { legionnaire: 0, kozu: 0, abunakki: 0, dreadnaut: 0 },
});

/**
 * What the migration writes onto every existing main save, and what a `NULL`
 * column reads as. Kept equal to the migration's SQL literal (a test checks).
 */
export const LEGACY_ONBOARDING_JSON = {
  v: 1,
  guide: { state: "legacy" },
  raidSeen: 1,
  goalsBaseline: "pending",
} as const;

/** The record a new main save starts with while the `guidedStart` switch is on. */
export const NEW_ONBOARDING_JSON = { v: 1, guide: { state: "pending" } } as const;

/** The slice of a save the onboarding helpers read. */
export interface OnboardingSave {
  onboarding?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A finite number, or undefined. */
const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** A whole non-negative count, 0 for anything else. */
const count = (value: unknown): number => {
  const n = num(value);
  return n !== undefined && n > 0 ? Math.floor(n) : 0;
};

const readGuide = (raw: unknown): GuideRecord => {
  if (!isRecord(raw)) return { state: "legacy" };
  const state = GUIDE_STATES.includes(raw.state as GuideState) ? (raw.state as GuideState) : "legacy";
  const guide: GuideRecord = { state };
  if (typeof raw.step === "string") guide.step = raw.step;
  const startedAt = num(raw.startedAt);
  if (startedAt !== undefined) guide.startedAt = startedAt;
  const endedAt = num(raw.endedAt);
  if (endedAt !== undefined) guide.endedAt = endedAt;
  return guide;
};

const readCamp = (raw: unknown): CampRecord => {
  if (!isRecord(raw)) return { state: "none" };
  const state: CampState = raw.state === "open" || raw.state === "removed" ? raw.state : "none";
  const camp: CampRecord = { state };
  const openedAt = num(raw.openedAt);
  if (openedAt !== undefined) camp.openedAt = openedAt;
  const removedAt = num(raw.removedAt);
  if (removedAt !== undefined) camp.removedAt = removedAt;
  return camp;
};

const readCounters = (raw: unknown): OnboardingCounters => {
  const counters = emptyCounters();
  if (!isRecord(raw)) return counters;
  counters.mushrooms = count(raw.mushrooms);
  counters.goldMushrooms = count(raw.goldMushrooms);
  counters.bestBank = count(raw.bestBank);
  counters.juiced = count(raw.juiced);
  counters.baiterRuns = count(raw.baiterRuns);
  const tribes = isRecord(raw.tribes) ? raw.tribes : {};
  for (const name of Object.keys(counters.tribes) as TribeCounterName[]) {
    counters.tribes[name] = count(tribes[name]);
  }
  return counters;
};

const readNumberMap = (raw: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (!isRecord(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    const n = num(value);
    if (n !== undefined) out[key] = n;
  }
  return out;
};

const readGoals = (raw: unknown): Record<string, GoalRecord> => {
  const out: Record<string, GoalRecord> = {};
  if (!isRecord(raw)) return out;
  for (const [id, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    const goal: GoalRecord = {};
    const done = num(value.done);
    if (done !== undefined) goal.done = done;
    if (value.claimed === "baseline") goal.claimed = "baseline";
    else {
      const claimed = num(value.claimed);
      if (claimed !== undefined) goal.claimed = claimed;
    }
    out[id] = goal;
  }
  return out;
};

/**
 * Reads `save.onboarding` into the full shape, every field present with its
 * default, so callers never null-check. `NULL` (or anything unreadable) is a
 * legacy save. The result is a fresh object: mutate it freely, then write it
 * back as a slice.
 *
 * @param save - A main save (an outpost seen through `poolView` reads its main yard's).
 */
export const readOnboarding = (save: OnboardingSave): Onboarding => {
  const raw: Record<string, unknown> = isRecord(save.onboarding) ? save.onboarding : LEGACY_ONBOARDING_JSON;
  const onboarding: Onboarding = {
    v: 1,
    guide: readGuide(raw.guide),
    // The ledger is kept as stored: its keys belong to the guided start package.
    grants: isRecord(raw.grants) ? (structuredClone(raw.grants) as GrantLedger) : {},
    camp: readCamp(raw.camp),
    goals: readGoals(raw.goals),
    counters: readCounters(raw.counters),
    tips: readNumberMap(raw.tips),
  };
  const raidSeen = num(raw.raidSeen);
  if (raidSeen !== undefined) onboarding.raidSeen = raidSeen;
  if (raw.goalsBaseline === "pending") onboarding.goalsBaseline = "pending";
  else {
    const baseline = num(raw.goalsBaseline);
    if (baseline !== undefined) onboarding.goalsBaseline = baseline;
  }
  return onboarding;
};

/**
 * The one way to change the column: reads it with defaults, lets `change`
 * edit the copy, and returns it for a `slices: { onboarding }` outcome (or a
 * direct assignment outside a yard action, e.g. the Map Room 1 tribe save's
 * counter). Fields `change` does not touch come back as they were, so two
 * packages writing different parts never undo each other.
 */
export const updateOnboarding = (
  save: OnboardingSave,
  change: (onboarding: Onboarding) => void
): Onboarding => {
  const onboarding = readOnboarding(save);
  change(onboarding);
  return onboarding;
};

/** Whether the guided start is still to run or running (its routes are open). */
export const guideOpen = (onboarding: Onboarding): boolean =>
  onboarding.guide.state === "pending" || onboarding.guide.state === "active";
