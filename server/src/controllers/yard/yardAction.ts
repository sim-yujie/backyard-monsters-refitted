import { LockMode, type EntityManager } from "@mikro-orm/core";
import type z from "zod";
import { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { emitLevelChange } from "../../chat/levelChangeBus.js";
import { BaseType } from "../../enums/Base.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";
import { Status } from "../../enums/StatusCodes.js";
import { ClientSafeError } from "../../middleware/clientSafeError.js";
import { YardTargetSchema } from "../../schemas/YardSchemas.js";
import { RESOURCE_KEYS, type ResourceKey } from "../../services/base/economy/resourceBudget.js";
import { playerLevelOf } from "../../services/base/calculateBaseLevel.js";
import { isAttackActive } from "../../services/base/isAttackActive.js";
import { addEvents, builtEvents, recordAchievements, unseenAchievements } from "../../services/achievements/record.js";
import type { AchievementEvents } from "../../services/achievements/evaluate.js";
import { autobankYard } from "../../services/maproom/v2/autobank.js";
import { isShinyLocked } from "../../services/user/shinyLock.js";
import { catchUpYard, type CompletedJob } from "../../services/yard/catchUp.js";
import { catchUpDamage } from "../../services/yard/catchUpDamage.js";
import { creditResources } from "../../services/yard/credit.js";
import { syncBaseValue, syncDerivedLevels } from "../../services/yard/derivedLevels.js";
import { joinMapRoom2 } from "../../services/yard/mapRoom.js";
import { moveMushroomsOffBuildings } from "../../services/yard/mushrooms.js";
import { outpostCarryover, outpostProblems } from "../../services/yard/outpostYard.js";
import { poolView } from "../../services/yard/poolView.js";
import {
  notInOutpostErr,
  notMainYardErr,
  notYourYardErr,
  yardBadRequestErr,
  yardRefusedErr,
  yardRaidInProgressErr,
  yardUnderAttackErr,
} from "../../services/yard/yardErrors.js";
import { raidFighting } from "../../services/raids/raidLock.js";
import { yardState } from "../../services/yard/yardState.js";
import { onboardingSummary } from "../../services/onboarding/summary.js";
import type { ResourceAmounts } from "../../services/yardplanner/costs.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { logger } from "../../utils/logger.js";

/**
 * The yard action wrapper every `POST /bm/yard/<action>` runs
 * through (`docs/design/yard-buildings.md` §2.1, decision D2).
 *
 * A route is a zod schema plus a `run` function. `run` gets the caller's main
 * yard already locked and caught up, decides, and returns what should change;
 * it never touches the database or the clock. The wrapper does the rest, the
 * same way for every route:
 *
 * 1. Parse the body with the route's schema: `400 badRequest` if it fails.
 *    (Done before the lock so a malformed request never holds the row; the
 *    design lists it third, but nothing it reads depends on the order.)
 * 2. Inside one transaction, re-read `user.save` with `SELECT … FOR UPDATE`
 *    (T4), so two requests for the same player run one after the other and
 *    the second sees what the first wrote. `409 notMainYard` unless it is the
 *    caller's own main yard, `409 underAttack` while `isAttackActive`, and
 *    `409 raidInProgress` while a wild monster raid is being fought on it
 *    (#226, `services/raids/raidLock.ts`).
 * 3. `catchUpYard(save, now)`: finish every job that ended, award its points,
 *    move `savetime` to `now` (§2.3); then, if that left a level 2 Map Room
 *    on a yard not yet on Map Room 2, join a world (`joinMapRoom2`, §5.7);
 *    then pay the player's outpost income into the main pool
 *    (`autobankYard`, outposts WP4).
 * 4. `run({ save, user, body, now, completed })`.
 * 5. Check and apply its {@link YardOutcome}: Shiny (`409 shinyLocked`,
 *    `409 credits`), resources (`409 shortfall`), then the new slices, the
 *    debit, the credit clamped to the cap (T3), the points; re-derive
 *    `flinger`/`catapult` and, on the main yard, raise `basevalue` (#209);
 *    move any mushroom a building now stands on to free ground (#263: a
 *    mushroom never blocks a build or a decoration, it pops up elsewhere);
 *    evaluate the account's achievements on the main row
 *    (`recordAchievements`, issue #204): the Blocks and Heavy Traps the
 *    catch-up finished plus the outcome's `achievementEvents`, paying what
 *    unlocks when rewards are on; one flush; commit.
 * 6. Answer `{ error: 0, ...yardState, completed, report, playerlevel }`, the last
 *    the player's level from their main save (the yard HUD's, #192). The yard
 *    state's `onboarding` is the account's tutorial summary, read from the
 *    main row after the action (issue #227). `achievements` lists the
 *    account's paid unlocks not yet shown, when there are any (§9.3 of
 *    `docs/design/achievements.md`).
 *
 * Any `ClientSafeError` thrown along the way rolls the transaction back — the
 * catch-up included, so a refused action writes nothing — and answers in the
 * planner's flat shape, `{ error: message, reason, ...detail }` with the
 * error's real HTTP status (`controllers/yardplanner/layoutRoute.ts`). Other
 * errors go to the global interceptor as usual.
 *
 * This module never imports `server.ts`, so it runs under test with a stand-in
 * entity manager; `yardRoute.ts` binds it to Koa and `postgres.em`.
 *
 * ## Outposts (outposts WP3, issue #184)
 *
 * A body with a `baseid` naming one of the caller's own Map Room 2 outposts
 * acts on that outpost instead ({@link lockOwnYard}). Step 2 then locks the
 * main row first and the outpost row second, the order every route that
 * touches both keeps, so two requests for the same player (one on the main
 * yard, one on an outpost, or two on outposts) run one after the other and
 * cannot spend the one pool twice. `run` gets the outpost seen through the
 * main yard (`services/yard/poolView.ts`): its own buildings, the main yard's
 * pool, caps, Shiny and points, so every charge, credit and point lands on the
 * main row. The catch-up is the outpost's (`catchUpOutpost`), Map Room 2 is
 * never joined from one, and a route refuses unless its `outposts` says
 * `"allow"` (Flash's list: recycle, cancelling a construction, banking and the
 * player-level buildings are refused).
 *
 * FROZEN (2026-09-27): later work packages build routes against
 * `defineYardAction` / `YardAction` / `YardOutcome` here and `yardRoute` there.
 * WP3 added `YardAction.outposts` (optional) and {@link lockOwnYard}.
 * The tutorial's WP0 (issue #227, `docs/design/tutorial.md` §9.2) added
 * `onboarding` to {@link YardSlices}, `em` to {@link YardActionInput}, and the
 * `onboarding` summary to the answer. Achievements' WP2 (issue #204,
 * `docs/design/achievements.md` §7.2) added `achievements` to
 * {@link YardSlices}, `achievementEvents` to {@link YardOutcome}, and the
 * unseen unlocks to the answer; its WP4 added
 * {@link YardAction.reportAfterAchievements}.
 */

/** Save columns an action may replace wholesale. */
export type YardSlices = Partial<
  Pick<
    Save,
    | "buildingdata"
    | "buildinghealthdata"
    | "storedata"
    | "monsters"
    | "lockerdata"
    | "academy"
    | "champion"
    | "mushrooms"
    | "researchdata"
    | "firedtraps"
    | "protected"
    // Which Starter Kit an outpost last took (issue #334); see the column's
    // own comment on `Save`.
    | "starterkit"
    // The tutorial's record (`services/onboarding/state.ts`); always written
    // whole, through `updateOnboarding`. On an outpost it lands on the main row.
    | "onboarding"
    // The achievements' record (`services/achievements/state.ts`); always
    // written whole, through `updateAchievements`. On an outpost it lands on
    // the main row. The wrapper evaluates it again after the slices land.
    | "achievements"
  >
>;

/** What `run` is handed. */
export interface YardActionInput<Body> {
  /**
   * The caller's main yard, or the outpost the request names seen through it
   * (`poolView`): locked, caught up to `now`. Treat as read-only; return
   * changes as `slices`.
   */
  save: Save;
  user: User;
  /** The body, as the route's schema parsed it. */
  body: Body;
  /** Unix seconds; the moment the whole request happens at. */
  now: number;
  /** Jobs the catch-up finished in this request, before `run`. */
  completed: readonly CompletedJob[];
  /**
   * The request's transaction, for the rare route that must change another
   * table in the same commit as the yard (the tutorial's practice camp lives
   * in the player's `Maproom` row, `docs/design/tutorial.md` §5.5). Anything
   * persisted through it is flushed with the yard, and rolled back with it on
   * a refusal. Never use it to write the save itself: return `slices`.
   */
  em: EntityManager;
}

/** What `run` returns. Every field but `report` is optional. */
export interface YardOutcome<Report> {
  /** Route-specific result, sent back as `report`. */
  report: Report;
  /** Columns to replace. */
  slices?: YardSlices;
  /** Resources to take. The wrapper refuses `409 shortfall` if the yard holds less. */
  debit?: Partial<ResourceAmounts>;
  /** Resources to give, each clamped to the storage cap (T3); a pool already over the cap is not reduced. */
  credit?: Partial<ResourceAmounts>;
  /** Shiny to take. Refused `409 shinyLocked` for a locked account, `409 credits` if short. */
  shiny?: number;
  /** Empire points to add. */
  points?: number;
  /**
   * Achievement event stats the action brought about (issue #204): a Block or
   * Heavy Trap it placed finished, a Starter Kit. The catch-up's finished
   * builds are counted by the wrapper; do not repeat them here.
   */
  achievementEvents?: AchievementEvents;
}

/**
 * What a route does when the request names an outpost: `"allow"`, or refuse
 * with this message (`409 notInOutpost`).
 */
export type OutpostPolicy = "allow" | { refuse: string };

/** One yard route: a body schema and the decision. */
export interface YardAction<Schema extends z.ZodType, Report> {
  schema: Schema;
  run: (
    input: YardActionInput<z.output<Schema>>
  ) => YardOutcome<Report> | Promise<YardOutcome<Report>>;
  /** Whether the route works on an outpost; refused with a plain message when absent. */
  outposts?: OutpostPolicy;
  /**
   * Builds the report again once the wrapper has evaluated the account's
   * achievements (issue #204), for a route that answers with that record, so
   * the answer holds this request's backfill and unlocks. `save` is the one
   * `run` saw, with the outcome applied. Replaces the report `run` returned.
   */
  reportAfterAchievements?: (save: Save) => Report;
}

/** Identity helper so `run`'s `body` is typed from `schema`. */
export const defineYardAction = <Schema extends z.ZodType, Report>(
  action: YardAction<Schema, Report>
): YardAction<Schema, Report> => action;

/** A non-negative whole amount, 0 for anything else. */
const amount = (raw: number | undefined): number =>
  Number.isFinite(raw) && raw! > 0 ? Math.floor(raw!) : 0;

/** All four resources, each through {@link amount}. */
const amountsOf = (raw: Partial<ResourceAmounts> | undefined): ResourceAmounts => ({
  r1: amount(raw?.r1),
  r2: amount(raw?.r2),
  r3: amount(raw?.r3),
  r4: amount(raw?.r4),
});

/**
 * Checks and applies an outcome to the locked save. Every check runs before
 * anything is written, so a refusal leaves the save as `run` saw it.
 */
export const applyOutcome = (save: Save, user: User, outcome: YardOutcome<unknown>): void => {
  const shiny = amount(outcome.shiny);
  if (shiny > 0) {
    if (isShinyLocked(user)) {
      throw yardRefusedErr("shinyLocked", "Shiny spending is switched off for this account.");
    }
    if (save.credits < shiny) {
      throw yardRefusedErr("credits", "You do not have enough Shiny for that.", {
        credits: { have: save.credits, need: shiny },
      });
    }
  }

  const held = (key: ResourceKey): number => {
    const value = Number(save.resources?.[key]);
    return Number.isFinite(value) ? value : 0;
  };

  const debit = amountsOf(outcome.debit);
  const credit = amountsOf(outcome.credit);
  const short = amountsOf({
    r1: debit.r1 - held("r1"),
    r2: debit.r2 - held("r2"),
    r3: debit.r3 - held("r3"),
    r4: debit.r4 - held("r4"),
  });
  if (RESOURCE_KEYS.some((key) => short[key] > 0)) {
    throw yardRefusedErr("shortfall", "You do not have enough resources for that.", {
      shortfall: short,
    });
  }

  if (outcome.slices) Object.assign(save, outcome.slices);

  if (RESOURCE_KEYS.some((key) => debit[key] > 0)) {
    const resources = { ...(save.resources ?? {}) };
    for (const key of RESOURCE_KEYS) resources[key] = held(key) - debit[key];
    save.resources = resources;
  }
  // Credited after the slices land (a silo the action changed moves the cap)
  // and after the debit, through the one clamp every credit takes (T3).
  creditResources(save, credit);

  if (shiny > 0) save.credits -= shiny;

  const points = amount(outcome.points);
  if (points > 0) save.points = String(Number(save.points ?? "0") + points);

  syncDerivedLevels(save);
  // A no-op on an outpost: the view keeps the outpost's `type`.
  syncBaseValue(save);
};

/**
 * Re-reads the caller's main yard under a row lock and checks it may be acted
 * on. The transaction's fork shares the request's identity map, so `refresh`
 * is what makes the read come from the locked row rather than from whatever
 * this request already held.
 */
const lockMainYard = async (em: EntityManager, user: User): Promise<Save> => {
  const basesaveid = user.save?.basesaveid;
  if (basesaveid == null) throw notMainYardErr();

  const save = await lockRow(em, basesaveid);

  if (!save || save.type !== BaseType.MAIN || save.userid !== user.userid) throw notMainYardErr();
  if (isAttackActive(save)) throw yardUnderAttackErr();
  if (raidFighting(save, getCurrentDateTime())) throw yardRaidInProgressErr();

  return save;
};

/** `SELECT … FOR UPDATE` on one save row, refreshed into the identity map. */
const lockRow = (em: EntityManager, basesaveid: number) =>
  em.findOne(Save, { basesaveid }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true });

/** The yard a request acts on, locked. */
export interface OwnYard {
  /** What the rules get: the main yard, or the outpost seen through it (`poolView`). */
  save: Save;
  /** The main yard row, which holds the pool. */
  main: Save;
  /** The outpost row, or null when the request acts on the main yard. */
  outpost: Save | null;
}

/**
 * Locks the yard a request acts on: the caller's main yard, or, when `baseid`
 * names another yard, the main yard first and then that outpost, which must
 * be one of the caller's own Map Room 2 outposts: listed in the main yard's
 * `outposts`, owned by the caller, in the main yard's world and not a Map
 * Room 3 structure (`403 notYourYard` otherwise). `409 underAttack` while
 * either row is being attacked: an attack on an outpost loots the main pool
 * too.
 *
 * @param em - The transaction's entity manager.
 * @param user - The caller.
 * @param baseid - `baseid` from the request; absent for the main yard.
 */
export const lockOwnYard = async (
  em: EntityManager,
  user: User,
  baseid?: string
): Promise<OwnYard> => {
  const main = await lockMainYard(em, user);
  if (baseid === undefined || baseid === String(main.baseid)) return { save: main, main, outpost: null };

  const listed = (main.outposts ?? []).some(([, , id]) => String(id) === baseid);
  if (!listed) throw notYourYardErr();

  const outpost = await em.findOne(
    Save,
    { baseid },
    { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }
  );
  if (
    !outpost ||
    outpost.type !== BaseType.OUTPOST ||
    outpost.mapversion === MapRoomVersion.V3 ||
    outpost.userid !== user.userid ||
    outpost.saveuserid !== user.userid ||
    !outpost.worldid ||
    outpost.worldid !== main.worldid
  ) {
    throw notYourYardErr();
  }
  if (isAttackActive(outpost)) throw yardUnderAttackErr();

  return { save: poolView(outpost, main), main, outpost };
};

/** Outposts whose old-data problems this process has logged already. */
const checkedOutposts = new Set<number>();

/**
 * Logs, once per outpost per process, where an outpost row breaks the outpost
 * props (`outpostProblems`): Flash-era owner saves wrote whatever the client
 * sent. Nothing is changed.
 */
const logOutpostProblems = (outpost: Save): void => {
  if (checkedOutposts.has(outpost.basesaveid)) return;
  checkedOutposts.add(outpost.basesaveid);

  const problems = outpostProblems(outpost.buildingdata);
  if (problems.length > 0) {
    logger.warn("Outpost {basesaveid} does not match the outpost props: {problems}", {
      basesaveid: outpost.basesaveid,
      problems: JSON.stringify(problems),
    });
  }

  // Main-yard data a copied row carries (#191): the catch-up drops the
  // mushrooms and keeps the expansion (`outpostCarryover`).
  const carried = outpostCarryover(outpost);
  if (carried.mushrooms > 0 || carried.expansion > 0) {
    logger.warn(
      "Outpost {basesaveid} carries main-yard data: {mushrooms} mushrooms (dropped), expansion {expansion} (kept)",
      { basesaveid: outpost.basesaveid, ...carried }
    );
  }
};

/**
 * Catches a main yard up under the row lock and writes it: the owner's
 * build-mode `/base/load` (§2.3 "Where it runs"). The same locked read and the
 * same `catchUpYard` an action does, in one flush, so a plain load cannot
 * overwrite an action that committed after the load first read the row.
 * The account's achievements are evaluated in the same flush, with the
 * Blocks and Heavy Traps the catch-up finished (issue #204).
 * Skipped while the yard is under attack (the attack save owns the row then).
 *
 * @param em - The request's entity manager.
 * @param save - The main yard the load is about to answer with.
 * @param alsoUnderLock - More to write on the locked row in the same flush,
 *   under attack too: the load's raid session count (`countRaidSession`,
 *   passed in because this module reads no Redis and so cannot import it).
 * @returns The caught-up save to answer with (the same entity in practice,
 *   since the transaction shares the request's identity map) and what the
 *   catch-up finished, which the load sends as `completed` so the client can
 *   say what finished while the player was away (issue #135); `[]` when it
 *   was skipped.
 */
export const catchUpLockedYard = async (
  em: EntityManager,
  save: Save,
  alsoUnderLock?: (locked: Save, now: number) => void
): Promise<{ save: Save; completed: CompletedJob[] }> =>
  em.transactional(async (tx) => {
    const locked = await lockRow(tx, save.basesaveid);
    if (!locked) return { save, completed: [] };
    const now = getCurrentDateTime();
    if (alsoUnderLock) alsoUnderLock(locked, now);
    if (isAttackActive(locked)) {
      if (alsoUnderLock) await tx.flush();
      return { save: locked, completed: [] };
    }

    const completed = await catchUpLockedRow(tx, locked, now);
    await recordAchievements(tx, locked, now, builtEvents(completed));
    await tx.flush();
    return { save: locked, completed };
  });

/**
 * The main yard's catch-up on a row the caller has locked, not yet flushed:
 * `catchUpYard`, then Map Room 2 if it now qualifies, then the outpost income.
 * {@link catchUpLockedYard}'s, and a wild monster raid's at its start and its
 * finish (#226, `services/raids/raidFlow.ts`).
 *
 * @returns What the catch-up finished.
 */
export const catchUpLockedRow = async (tx: EntityManager, locked: Save, now: number): Promise<CompletedJob[]> => {
  const completed = catchUpYard(locked, now);
  await joinMapRoom2(tx, locked);
  await autobankYard(tx, locked, now, completed);
  return completed;
};

/**
 * Catches an owner's outpost up under the row locks and writes it: the
 * build-mode `/base/load` of an own outpost, as {@link catchUpLockedYard} is
 * for the main yard. The main row is locked first (the order of
 * {@link lockOwnYard}), because the catch-up credits it: points, the HCC's
 * goo refund, the player's outpost income (`autobankYard`), and the
 * achievements it finishes Blocks or Heavy Traps towards (issue #204). An
 * empty outpost gets its core here. Skipped, and the row
 * answered as it is, when {@link lockOwnYard} refuses (an attack is running,
 * or the row is not one of the caller's listed outposts).
 *
 * @returns The outpost row and what the catch-up finished.
 */
export const catchUpLockedOutpost = async (
  em: EntityManager,
  user: User,
  outpost: Save
): Promise<{ save: Save; completed: CompletedJob[] }> =>
  em.transactional(async (tx) => {
    let yard: OwnYard;
    try {
      yard = await lockOwnYard(tx, user, String(outpost.baseid));
    } catch (err) {
      if (err instanceof ClientSafeError) return { save: outpost, completed: [] };
      throw err;
    }
    if (!yard.outpost) return { save: yard.main, completed: [] };

    logOutpostProblems(yard.outpost);
    // The catch-up re-derives the outpost's own Flinger level (its reach) too.
    const now = getCurrentDateTime();
    const completed = catchUpYard(yard.save, now);
    await autobankYard(tx, yard.main, now, [], yard.outpost);
    await recordAchievements(tx, yard.main, now, builtEvents(completed), yard.outpost);
    await tx.flush();
    return { save: yard.outpost, completed };
  });

/** What {@link runYardAction} answers: the HTTP status and the body. */
export interface YardAnswer {
  status: number;
  body: Record<string, unknown>;
  /**
   * The outpost the action ran on, null for the main yard; set on a success
   * only, for the notification list (`yardRoute`, issue #257).
   */
  outpost?: string | null;
  /**
   * The acted-on save's `flinger` just before the catch-up and the action
   * ran, and once they and the transaction committed; set on a success only.
   * `yardRoute` compares them to invalidate the Map Room 2 fog of war sight
   * cache (issue #329, #330 WP1) — kept out of this module so it stays
   * drivable without a server (the file comment).
   */
  flingerBefore?: number;
  flingerAfter?: number;
}

/**
 * Runs one yard action end to end (the steps in the file comment) and returns
 * the answer rather than writing it to a Koa context, so it can be driven
 * without a server. `yardRoute` is the Koa binding.
 *
 * @param em - The request's entity manager.
 * @param user - The authenticated caller (`ctx.authUser`).
 * @param action - The route.
 * @param rawBody - The request body, before parsing.
 * @throws Anything that is not a `ClientSafeError`, for the global interceptor.
 */
export const runYardAction = async <Schema extends z.ZodType, Report>(
  em: EntityManager,
  user: User,
  action: YardAction<Schema, Report>,
  rawBody: unknown
): Promise<YardAnswer> => {
  try {
    const parsed = action.schema.safeParse(rawBody ?? {});
    if (!parsed.success) {
      throw yardBadRequestErr("That request could not be read.", {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    const target = YardTargetSchema.safeParse(rawBody ?? {});
    if (!target.success) throw yardBadRequestErr("That yard could not be read.", { field: "baseid" });

    // Read under the lock, before the catch-up or the action itself might
    // move it; compared against the post-action value once the transaction
    // commits, to invalidate the Map Room 2 fog of war sight cache only when
    // it actually changed (issue #329, #330 WP1).
    let flingerBefore: number | undefined;

    const answer = await em.transactional(async (tx) => {
      const yard = await lockOwnYard(tx, user, target.data.baseid);
      if (yard.outpost && action.outposts !== "allow") {
        throw notInOutpostErr(action.outposts?.refuse);
      }

      const save = yard.save;
      flingerBefore = save.flinger;
      const now = getCurrentDateTime();
      const completed = catchUpYard(save, now);
      if (!yard.outpost) await joinMapRoom2(tx, save, user);
      // Outpost income up to now lands before the action decides (outposts
      // WP4): it can pay for it, and a rate the action changes (a harvester
      // upgrade on an outpost) only counts from here on.
      await autobankYard(tx, yard.main, now, yard.outpost ? [] : completed, yard.outpost);

      const outcome = await action.run({ save, user, body: parsed.data, now, completed, em: tx });
      applyOutcome(save, user, outcome);
      moveMushroomsOffBuildings(save);
      // An instant or paid repair shows on the map now, not at the next catch-up (#182 B).
      catchUpDamage(save);
      save.savetime = now;
      // The account's, so on the main row from an outpost too (issue #204).
      await recordAchievements(
        tx,
        yard.main,
        now,
        addEvents(builtEvents(completed), outcome.achievementEvents),
        yard.outpost
      );
      const report = action.reportAfterAchievements
        ? action.reportAfterAchievements(save)
        : outcome.report;

      await tx.flush();
      return {
        save,
        now,
        completed,
        report,
        playerlevel: playerLevelOf(yard.main),
        // The account's, so from the main row on an outpost's answer too.
        onboarding: onboardingSummary(yard.main),
        achievements: unseenAchievements(yard.main),
        outpost: yard.outpost ? String(yard.outpost.baseid) : null,
      };
    });

    // After the commit, so a rolled-back action never announces a level it
    // did not save. The account's level, so this fires from an outpost
    // action too (issue #232); a no-op (in chat) if it is not the level last
    // broadcast, or if chat is not even loaded, per `levelChangeBus.ts`.
    emitLevelChange(user.userid, user.username, answer.playerlevel);

    return {
      status: Status.OK,
      body: {
        error: 0,
        ...yardState(answer.save, answer.now, isShinyLocked(user), answer.onboarding),
        completed: answer.completed,
        report: answer.report,
        playerlevel: answer.playerlevel,
        ...(answer.achievements.length > 0 && { achievements: answer.achievements }),
      },
      outpost: answer.outpost,
      flingerBefore,
      flingerAfter: answer.save.flinger,
    };
  } catch (err) {
    if (!(err instanceof ClientSafeError)) throw err;
    return { status: err.status, body: { error: err.message, ...err.data } };
  }
};
