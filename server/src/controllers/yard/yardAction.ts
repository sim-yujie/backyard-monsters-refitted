import { LockMode, type EntityManager } from "@mikro-orm/core";
import type z from "zod";
import { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { BaseType } from "../../enums/Base.js";
import { Status } from "../../enums/StatusCodes.js";
import { ClientSafeError } from "../../middleware/clientSafeError.js";
import {
  RESOURCE_KEYS,
  storageCap,
  type ResourceKey,
} from "../../services/base/economy/resourceBudget.js";
import { isAttackActive } from "../../services/base/isAttackActive.js";
import { isShinyLocked } from "../../services/user/shinyLock.js";
import { catchUpYard, type CompletedJob } from "../../services/yard/catchUp.js";
import { syncDerivedLevels } from "../../services/yard/derivedLevels.js";
import {
  notMainYardErr,
  yardBadRequestErr,
  yardRefusedErr,
  yardUnderAttackErr,
} from "../../services/yard/yardErrors.js";
import { yardState } from "../../services/yard/yardState.js";
import type { ResourceAmounts } from "../../services/yardplanner/costs.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";

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
 *    caller's own main yard, `409 underAttack` while `isAttackActive`.
 * 3. `catchUpYard(save, now)`: finish every job that ended, award its points,
 *    move `savetime` to `now` (§2.3).
 * 4. `run({ save, user, body, now, completed })`.
 * 5. Check and apply its {@link YardOutcome}: Shiny (`409 shinyLocked`,
 *    `409 credits`), resources (`409 shortfall`), then the new slices, the
 *    debit, the credit clamped to the cap (T3), the points; re-derive
 *    `flinger`/`catapult`; one flush; commit.
 * 6. Answer `{ error: 0, ...yardState, completed, report }`.
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
 * FROZEN (2026-09-27): later work packages build routes against
 * `defineYardAction` / `YardAction` / `YardOutcome` here and `yardRoute` there.
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
  >
>;

/** What `run` is handed. */
export interface YardActionInput<Body> {
  /** The caller's main yard: locked, caught up to `now`. Treat as read-only; return changes as `slices`. */
  save: Save;
  user: User;
  /** The body, as the route's schema parsed it. */
  body: Body;
  /** Unix seconds; the moment the whole request happens at. */
  now: number;
  /** Jobs the catch-up finished in this request, before `run`. */
  completed: readonly CompletedJob[];
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
}

/** One yard route: a body schema and the decision. */
export interface YardAction<Schema extends z.ZodType, Report> {
  schema: Schema;
  run: (
    input: YardActionInput<z.output<Schema>>
  ) => YardOutcome<Report> | Promise<YardOutcome<Report>>;
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

  if (RESOURCE_KEYS.some((key) => debit[key] > 0 || credit[key] > 0)) {
    // The cap is read after the slices land: a silo the action changed moves it.
    const cap = storageCap(save);
    const resources = { ...(save.resources ?? {}) };
    for (const key of RESOURCE_KEYS) {
      const after = held(key) - debit[key];
      resources[key] = Math.max(after, Math.min(after + credit[key], cap));
    }
    save.resources = resources;
  }

  if (shiny > 0) save.credits -= shiny;

  const points = amount(outcome.points);
  if (points > 0) save.points = String(Number(save.points ?? "0") + points);

  syncDerivedLevels(save);
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

  return save;
};

/** `SELECT … FOR UPDATE` on one save row, refreshed into the identity map. */
const lockRow = (em: EntityManager, basesaveid: number) =>
  em.findOne(Save, { basesaveid }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true });

/**
 * Catches a main yard up under the row lock and writes it: the owner's
 * build-mode `/base/load` (§2.3 "Where it runs"). The same locked read and the
 * same `catchUpYard` an action does, in one flush, so a plain load cannot
 * overwrite an action that committed after the load first read the row.
 * Skipped while the yard is under attack (the attack save owns the row then).
 *
 * @param em - The request's entity manager.
 * @param save - The main yard the load is about to answer with.
 * @returns The caught-up save to answer with; the same entity in practice,
 *   since the transaction shares the request's identity map.
 */
export const catchUpLockedYard = async (em: EntityManager, save: Save): Promise<Save> =>
  em.transactional(async (tx) => {
    const locked = await lockRow(tx, save.basesaveid);
    if (!locked || isAttackActive(locked)) return locked ?? save;

    catchUpYard(locked, getCurrentDateTime());
    await tx.flush();
    return locked;
  });

/** What {@link runYardAction} answers: the HTTP status and the body. */
export interface YardAnswer {
  status: number;
  body: Record<string, unknown>;
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

    const answer = await em.transactional(async (tx) => {
      const save = await lockMainYard(tx, user);
      const now = getCurrentDateTime();
      const completed = catchUpYard(save, now);

      const outcome = await action.run({ save, user, body: parsed.data, now, completed });
      applyOutcome(save, user, outcome);
      save.savetime = now;

      await tx.flush();
      return { save, now, completed, report: outcome.report };
    });

    return {
      status: Status.OK,
      body: {
        error: 0,
        ...yardState(answer.save, answer.now, isShinyLocked(user)),
        completed: answer.completed,
        report: answer.report,
      },
    };
  } catch (err) {
    if (!(err instanceof ClientSafeError)) throw err;
    return { status: err.status, body: { error: err.message, ...err.data } };
  }
};
