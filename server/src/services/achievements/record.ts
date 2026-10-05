import type { EntityManager } from "@mikro-orm/core";
import { achievementConfig } from "../../config/AchievementConfig.js";
import { Maproom } from "../../database/models/maproom.model.js";
import { Save } from "../../database/models/save.model.js";
import { BaseType } from "../../enums/Base.js";
import { achievementById } from "../../game-data/achievements.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import { tribeOfBase } from "../goals/counters.js";
import { recordNotifications } from "../notifications/notifications.js";
import { evaluateAchievements, type AchievementEvents, type AchievementView } from "./evaluate.js";
import { needsBackfill, readAchievements, type Achievements, type AchievementsSave } from "./state.js";

/**
 * Achievements in the yard (`docs/design/achievements.md` §7.2, §7.3, §9.3,
 * issue #204, WP2): the event stats a yard action or a catch-up brings about,
 * the evaluation under the main row's lock, the payout, and what the answers
 * carry.
 *
 * {@link recordAchievements} runs inside the transaction that holds the
 * player's main row (the yard action wrapper, the owner's `/base/load`
 * catch-up), on that **main** row whichever yard the request acted on: the
 * record, the Shiny and the stats it reads are the account's.
 *
 * Paying is behind `ACHIEVEMENT_REWARDS` (`config/AchievementConfig.ts`).
 * Every unlock is first written `unpaid`; with rewards on, the same
 * evaluation pays every `unpaid` entry once (its Shiny onto `credits`, a
 * Shiny-locked account included, as quest rewards are, and a bell line) and
 * clears the mark. So an unlock earned while rewards were off is paid by the
 * first evaluation after they are turned on, and none is ever paid twice.
 */

/** Building types whose finished builds are event stats. */
const BUILT_STATS: ReadonlyMap<number, "blocksbuilt" | "heavytraps"> = new Map([
  [17, "blocksbuilt"],
  [117, "heavytraps"],
]);

/** A finished job, as far as {@link builtEvents} reads one (a catch-up `CompletedJob`). */
export interface FinishedJobLike {
  kind: string;
  t: unknown;
}

/**
 * Block and Heavy Trap builds among finished jobs (§7.2): one per `build` job
 * of type 17 or 117, the catch-up's or a route's. Upgrades are not builds; a
 * building taken out of the Yard Planner's storage and placed again finishes
 * no job, so it never counts.
 */
export const builtEvents = (jobs: readonly FinishedJobLike[]): AchievementEvents => {
  const events: AchievementEvents = {};
  for (const job of jobs) {
    if (job.kind !== "build") continue;
    const stat = BUILT_STATS.get(Number(job.t));
    if (stat) events[stat] = (events[stat] ?? 0) + 1;
  }
  return events;
};

/** A new building of type `t` a route placed already finished: a Block or Heavy Trap counts as built. */
export const placedFinishedEvents = (t: number): AchievementEvents => builtEvents([{ kind: "build", t }]);

/** The sum of several event sets. */
export const addEvents = (...sets: (AchievementEvents | undefined)[]): AchievementEvents => {
  const out: AchievementEvents = {};
  for (const set of sets) {
    for (const [stat, value] of Object.entries(set ?? {}) as [keyof AchievementEvents, number | undefined][]) {
      if (value === undefined || !Number.isFinite(value) || value <= 0) continue;
      out[stat] = (out[stat] ?? 0) + value;
    }
  }
  return out;
};

/** An unlock as the answers and the bell carry it (§9.3). */
export interface UnlockView {
  id: number;
  name: string;
  shiny: number;
  /** Found by the first read's backfill: the client shows these as one summary. */
  backfill?: true;
}

const unlockView = (id: number, shiny: number, backfill: boolean): UnlockView => ({
  id,
  name: achievementById(id)?.name ?? `Achievement ${id}`,
  shiny,
  ...(backfill && { backfill: true as const }),
});

/** The unlocks in `c`, oldest first (ties by number). */
const unlocksOf = (record: Achievements) =>
  Object.entries(record.c)
    .map(([key, unlock]) => ({ id: Number(key), unlock }))
    .sort((a, b) => a.unlock.at - b.unlock.at || a.id - b.id);

/**
 * What the answers carry as `achievements` (§9.3): every unlock paid and not
 * yet shown, oldest first. An `unpaid` one waits until it is paid.
 *
 * @param save - The player's main save (or an outpost's `poolView`, which reads the main row's record).
 */
export const unseenAchievements = (save: AchievementsSave): UnlockView[] =>
  unlocksOf(readAchievements(save))
    .filter(({ unlock }) => !unlock.seen && !unlock.unpaid)
    .map(({ id, unlock }) => unlockView(id, unlock.shiny, Boolean(unlock.backfill)));

/** What {@link settleAchievements} paid. */
export interface Settlement {
  /** The record with the paid entries' `unpaid` cleared: a new object. */
  record: Achievements;
  paid: UnlockView[];
  /** The Shiny to credit: the sum of `paid`. */
  shiny: number;
}

/** Pays every `unpaid` unlock when rewards are on; with them off, pays nothing. Pure. */
export const settleAchievements = (record: Achievements, rewards: boolean): Settlement => {
  const next = structuredClone(record);
  const paid: UnlockView[] = [];
  if (rewards) {
    for (const { id, unlock } of unlocksOf(next)) {
      if (!unlock.unpaid) continue;
      delete unlock.unpaid;
      paid.push(unlockView(id, unlock.shiny, Boolean(unlock.backfill)));
    }
  }
  return { record: next, paid, shiny: paid.reduce((sum, view) => sum + view.shiny, 0) };
};

/** One bell entry, shaped like a catch-up job: `{ kind, id, t, at, detail }`. */
export interface AchievementJob {
  kind: "achievement";
  id: number;
  t: null;
  at: number;
  detail: { name: string; shiny: number; backfill?: true };
}

/**
 * Paid unlocks as bell rows (§7.3): the backfill's together in one (a
 * summary, as the pop-up shows them), every other unlock in its own.
 */
export const achievementBatches = (paid: readonly UnlockView[], now: number): AchievementJob[][] => {
  const job = (view: UnlockView): AchievementJob => ({
    kind: "achievement",
    id: view.id,
    t: null,
    at: now,
    detail: { name: view.name, shiny: view.shiny, ...(view.backfill && { backfill: true as const }) },
  });
  const backfill = paid.filter((view) => view.backfill).map(job);
  const live = paid.filter((view) => !view.backfill).map((view) => [job(view)]);
  return backfill.length > 0 ? [backfill, ...live] : live;
};

/** Whether any of the player's Map Room 1 Kozu tribes is still marked destroyed (§8). */
const mr1KozuDestroyed = async (em: EntityManager, main: Save): Promise<boolean> => {
  // `wmstatus` mirrors the tribe records' `destroyed` (`scaledMR1Tribes.ts`).
  // The client could once write it, so it only decides whether the read is
  // worth making; the tribe record, which only the server writes, decides.
  const hinted = (main.wmstatus ?? []).some(
    (status) => Array.isArray(status) && Boolean(status[2]) && tribeOfBase(String(status[0])) === "kozu"
  );
  if (!hinted) return false;
  const maproom = await em.findOne(Maproom, { userid: main.userid });
  return (maproom?.tribedata ?? []).some(
    (tribe) => Boolean(tribe.destroyed) && tribeOfBase(String(tribe.baseid)) === "kozu"
  );
};

/**
 * The `buildingdata` of each outpost the player owns, for the backfill (§8).
 * The outpost the request acts on is taken as it stands now (this request's
 * build included), the others as stored.
 */
const outpostBuildings = async (
  em: EntityManager,
  main: Save,
  current: Save | null
): Promise<(BuildingDataMap | null | undefined)[]> => {
  const others = (main.outposts ?? [])
    .map(([, , baseid]) => String(baseid))
    .filter((baseid) => baseid !== String(current?.baseid));
  const rows =
    others.length > 0
      ? await em.find(Save, { baseid: { $in: others }, userid: main.userid, type: BaseType.OUTPOST })
      : [];
  return [...(current ? [current] : []), ...rows].map((row) => row.buildingdata);
};

/**
 * The evaluator's view of the main save (`evaluate.ts`), with the backfill's
 * reads of other rows only while the record still needs its backfill.
 */
const readView = async (
  em: EntityManager,
  main: Save,
  outpost: Save | null,
  record: Achievements
): Promise<AchievementView> => {
  const view: AchievementView = {
    buildingdata: main.buildingdata,
    champion: main.champion,
    lockerdata: main.lockerdata,
    resources: main.resources,
    mapversion: main.mapversion,
    outposts: main.outposts,
    onboarding: main.onboarding,
  };
  if (!needsBackfill(record)) return view;
  return {
    ...view,
    outpostBuildings: await outpostBuildings(em, main, outpost),
    mr1KozuDestroyed: await mr1KozuDestroyed(em, main),
  };
};

/** What {@link recordAchievements} did. */
export interface AchievementsRecorded {
  /** Unlocked by this evaluation (paid now, or owed while rewards are off). */
  unlocked: UnlockView[];
  /** Paid now: this evaluation's unlocks and any owed from before. */
  paid: UnlockView[];
}

/**
 * Evaluates the player's achievements onto the locked main row (§7.2, §7.3):
 * folds in the derived stats and `events`, backfills a record never worked
 * out, unlocks what is now met, and, with rewards on, credits the Shiny of
 * everything owed and writes its bell lines through `em`. The record is
 * assigned only when it changed. The caller flushes.
 *
 * @param em - The transaction holding the main row's lock.
 * @param main - The player's main save, locked; never an outpost or its `poolView`.
 * @param now - Unix seconds.
 * @param events - Event stats this request brought about.
 * @param outpost - The outpost row the request acts on, if any: the backfill reads its buildings as they stand.
 */
export const recordAchievements = async (
  em: EntityManager,
  main: Save,
  now: number,
  events: AchievementEvents = {},
  outpost: Save | null = null
): Promise<AchievementsRecorded> => {
  const record = readAchievements(main);
  const evaluation = evaluateAchievements(record, await readView(em, main, outpost, record), now, events);
  for (const unlock of evaluation.unlocked) evaluation.record.c[String(unlock.id)]!.unpaid = 1;

  const settled = settleAchievements(evaluation.record, achievementConfig.rewards);
  if (evaluation.changed || settled.paid.length > 0) {
    main.achievements = settled.record as unknown as Save["achievements"];
  }
  if (settled.shiny > 0) main.credits += settled.shiny;
  if (settled.paid.length > 0) {
    await recordNotifications(
      em,
      main.userid,
      null,
      "achievement",
      achievementBatches(settled.paid, now),
      new Date(now * 1000)
    );
  }

  return {
    unlocked: evaluation.unlocked.map((unlock) => unlockView(unlock.id, unlock.shiny, Boolean(unlock.backfill))),
    paid: settled.paid,
  };
};
