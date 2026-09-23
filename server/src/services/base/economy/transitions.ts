import { costOf, type CostRequirement, type CostStep } from "../../../game-data/buildingCosts.js";
import type { BuildingData, BuildingDataMap } from "../../../types/BuildingData.js";
import {
  FREE_FINISH_SECONDS,
  TOWN_HALL_TYPE,
  pointsForBuild,
  pointsForUpgrade,
  requirementsMet,
  upgradeSteps,
  type ResourceAmounts,
} from "../../yardplanner/costs.js";
import type { EconomyViolation } from "./auditEconomySave.js";
import {
  addAmounts,
  cancelRefund,
  instantCost,
  noAmounts,
  pricingLevel,
  pricingType,
  WALL_TYPE,
  LEGACY_WALL_TYPE,
} from "./resourceBudget.js";
import { voucherCovers, type Voucher } from "./voucher.js";

/**
 * The ladder walk for one building: what a level, a countdown or a brand new
 * building between the reference yard and the submitted one costs, and which
 * rule it breaks when nothing explains it
 * (`docs/design/economy-save-validation.md` §2.2 and §2.3).
 *
 * Kept apart from `auditEconomySave.ts` so it can be exercised on hand-built
 * buildings rather than on a 575-building fixture. Nothing here reaches the
 * database, and nothing throws: a transition that does not add up comes back as
 * a violation, because a log-mode verdict is only useful if it names
 * everything.
 *
 * Two readings run through the whole file. The first is that an **upper bound
 * is the safe direction**: where the server cannot model something the client
 * does — the worker walk, damage pauses, friend help — the rule allows it,
 * because a false positive in `reject` mode costs an honest player their
 * session. The second is that **charging is safe and over-charging is not**:
 * every step this file charges is subtracted from the resource budget in §2.6,
 * and spending less than the server expected is explicitly not a violation, so
 * a step charged twice would manufacture one.
 */

/** The three countdown fields a building can carry. */
const COUNTDOWN_FIELDS = ["cB", "cU", "cF"] as const;

/** One of the countdown fields. */
export type CountdownField = (typeof COUNTDOWN_FIELDS)[number];

/** The Town Hall's flat completion bonus (`client/scripts/BFOUNDATION.as:2915-2916`). */
const TOWN_HALL_BUILD_POINTS = 100;

/** What one building's transition needs to know about the save around it. */
export interface TransitionContext {
  /** Seconds since the stored save, clamped (`referenceYard.ts`). */
  elapsed: number;
  /** Seconds of countdown slack (`EconomyConfig.timerTolerance`). */
  tolerance: number;
  /** 1, or 0.8 while Sharper Tools is active (`client/scripts/STORE.as:2513-2519`). */
  bst: number;
  /** The save's single voucher. */
  voucher: Voucher;
  /** The reference yard, which prerequisites and caps are measured against. */
  reference: BuildingDataMap;
  /** The reference yard's Town Hall level. */
  hall: number;
  /** Whether the stored save had this building damaged or repairing. */
  damaged: boolean;
}

/** Everything a new building needs on top of {@link TransitionContext}. */
export interface NewBuildingContext extends Omit<TransitionContext, "damaged"> {
  /** Decoration types the stored `researchdata` holds in inventory. */
  inventory: ReadonlySet<number>;
}

/** What one building's change costs, earns and breaks. */
export interface Transition {
  /** Cost steps this save should have paid for. */
  charged: CostStep[];
  /** Resources a cancelled countdown hands back. */
  refund: ResourceAmounts;
  /** Empire points the completions in this transition award. */
  points: number;
  /** True when this transition spent the save's one voucher. */
  spentVoucher: boolean;
  violations: EconomyViolation[];
}

/** An empty transition: nothing charged, nothing earned, nothing wrong. */
const emptyTransition = (): Transition => ({
  charged: [],
  refund: noAmounts(),
  points: 0,
  spentVoucher: false,
  violations: [],
});

/** A countdown's value, with anything absent, negative or unreadable as 0. */
export const countdownOf = (
  building: BuildingData | undefined,
  field: CountdownField
): number => {
  const raw = Number(building?.[field]);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
};

/** Whether any countdown is running on a building. */
const isBusy = (building: BuildingData | undefined): boolean =>
  COUNTDOWN_FIELDS.some((field) => countdownOf(building, field) > 0);

/**
 * The unmet half of a step's `re` list, in the shape the batch routes report
 * it, or `null` when the yard satisfies the step.
 *
 * Mirrors `checkRequirements` (`services/yardplanner/wallUpgrade.ts:312-330`)
 * without throwing, and blames the Town Hall only when the Town Hall entry is
 * the one that actually failed.
 */
export const requirementDetail = (
  re: readonly CostRequirement[],
  buildings: BuildingDataMap,
  hall: number
): Record<string, unknown> | null => {
  if (requirementsMet(re, buildings)) return null;

  const unmet = re.filter((entry) => !requirementsMet([entry], buildings));
  const townHall = unmet.find(([type]) => type === TOWN_HALL_TYPE);
  if (townHall) return { townHall: { have: hall, need: townHall[2] } };

  return { requirements: unmet.map((entry) => [...entry]) };
};

/** A violation, with the building id already attached. */
const violation = (
  rule: EconomyViolation["rule"],
  id: number,
  detail: Record<string, unknown>,
  enforced = true
): EconomyViolation => ({ rule, ids: [id], detail, enforced });

/**
 * A countdown may only get shorter by time, or vanish (§2.3).
 *
 * It may never grow past what the stored save held, and it may never be further
 * along than the reference yard minus the tolerance and whatever the voucher
 * buys. A countdown *longer* than the reference is fine: damage and the worker
 * walk pause it and the reference models neither.
 */
const checkCountdownShape = (
  stored: BuildingData,
  reference: BuildingData,
  submitted: BuildingData,
  ctx: TransitionContext,
  id: number,
  out: Transition
): void => {
  for (const field of COUNTDOWN_FIELDS) {
    const sent = countdownOf(submitted, field);
    // A countdown that vanished is the ladder walk's business, not this check's.
    if (sent === 0) continue;

    const before = countdownOf(stored, field);
    if (before > 0 && sent > before) {
      out.violations.push(violation("countdownJumped", id, { field, expected: before, sent }));
      continue;
    }

    const now = countdownOf(reference, field);
    if (now === 0) continue;

    if (sent < now - ctx.tolerance && ctx.voucher.speedup > 0) out.spentVoucher = true;

    const earliest = now - ctx.tolerance - ctx.voucher.speedup;
    if (sent < earliest) {
      out.violations.push(
        violation("countdownJumped", id, { field, expected: Math.max(0, earliest), sent })
      );
    }
  }
};

/**
 * Fortification, shape only (§2.8).
 *
 * No building in the Map Room 2 main-yard table can fortify and the generator
 * emits no `fortify_costs`, so there is no ladder to price a `cF` with. A new
 * one, or a `fort` that climbed, is recorded and never enforced (§6, item 4);
 * the magnitude checks that *can* be made live in {@link checkCountdownShape}.
 */
const explainFortify = (
  reference: BuildingData,
  submitted: BuildingData,
  id: number,
  out: Transition
): void => {
  const before = Math.max(0, Number(reference.fort) || 0);
  const after = Math.max(0, Number(submitted.fort) || 0);
  const started = countdownOf(submitted, "cF") > 0 && countdownOf(reference, "cF") === 0;

  if (!started && after <= before) return;

  out.violations.push(
    violation("fortifyUnpriced", id, { from: before, to: after, cF: countdownOf(submitted, "cF") }, false)
  );
};

/**
 * Whether a countdown the reference yard still had may have finished in the
 * submitted save.
 *
 * Free under five minutes (`client/scripts/BFOUNDATION.as:2063-2083`), inside
 * the tolerance, or brought under it by `SP2`/`SP3`/`SP4`.
 */
const mayFinish = (remaining: number, ctx: TransitionContext): boolean =>
  remaining <= FREE_FINISH_SECONDS || remaining - ctx.voucher.speedup <= ctx.tolerance;

/**
 * Starting an upgrade: the one transition on an existing building that costs
 * resources (§2.3, the `to == from` with a new `cU` row).
 *
 * Every gate is checked against the reference yard, not the submitted one,
 * because a building that only appears in this save cannot have unlocked
 * anything yet.
 */
const startUpgrade = (
  reference: BuildingData,
  submitted: BuildingData,
  from: number,
  type: number,
  ctx: TransitionContext,
  id: number,
  out: Transition
): void => {
  const costs = costOf(type)?.costs ?? [];
  const step = costs[from];

  if (!step) {
    out.violations.push(
      violation("upgradeBlocked", id, { maxLevel: { have: from, max: costs.length } })
    );
    return;
  }

  if (isBusy(reference)) out.violations.push(violation("upgradeBlocked", id, { busy: true }));
  if (ctx.damaged) out.violations.push(violation("upgradeBlocked", id, { damaged: true }));

  if (ctx.hall <= 0) {
    out.violations.push(violation("upgradeBlocked", id, { townHall: { have: 0, need: 1 } }));
  } else {
    const unmet = requirementDetail(step[5], ctx.reference, ctx.hall);
    if (unmet) out.violations.push(violation("upgradeBlocked", id, unmet));
  }

  const expected = Math.floor(step[4] * ctx.bst);
  const sent = countdownOf(submitted, "cU");

  if (sent > expected) {
    out.violations.push(violation("countdownTooLong", id, { field: "cU", expected, sent }));
  } else {
    const earliest = expected - ctx.elapsed - ctx.tolerance;
    if (sent < earliest) {
      out.violations.push(
        violation("countdownJumped", id, { field: "cU", expected: Math.max(0, earliest), sent })
      );
    }
  }

  out.charged.push(step);
};

/**
 * Whether the save's voucher is a `BLK<n>` that takes every wall to level `n`.
 *
 * `STORE.as:1993-2026` upgrades every block in the yard at once, so this
 * voucher is the one with unlimited uses.
 */
const blockUpgradeCovers = (rawType: number, to: number, voucher: Voucher): boolean =>
  voucher.kind === "blockUpgrade" &&
  voucher.target === to &&
  (rawType === WALL_TYPE || rawType === LEGACY_WALL_TYPE);

/**
 * Explains one building that is in both the stored and the submitted save.
 *
 * `stored` is the row as it was saved, `reference` the same row with its
 * countdowns advanced to now, and `submitted` what the client sent. The stored
 * copy is needed as well as the reference one because "a countdown never grows"
 * is measured against what was actually saved, while "a countdown never runs
 * faster than the clock" is measured against the reference.
 */
export const explainTransition = (
  stored: BuildingData,
  reference: BuildingData,
  submitted: BuildingData,
  ctx: TransitionContext
): Transition => {
  const out = emptyTransition();
  const id = Number(submitted.id ?? reference.id ?? stored.id);
  const rawType = Number(submitted.t);
  const type = pricingType(rawType);

  checkCountdownShape(stored, reference, submitted, ctx, id, out);
  explainFortify(reference, submitted, id, out);

  const row = costOf(type);
  if (!row) return out;

  const costs = row.costs;
  const top = costs.length;
  const from = pricingLevel(reference);
  const to = pricingLevel(submitted);

  // A build countdown may never appear on a building the stored save already
  // had: `Constructed()` is a one-way door (`BFOUNDATION.as:2892-2901`).
  if (countdownOf(submitted, "cB") > 0 && countdownOf(stored, "cB") === 0) {
    out.violations.push(violation("upgradeBlocked", id, { field: "cB", busy: true }));
  }

  // A building still under construction is level 0 until it finishes, so an `l`
  // above 1 on one is a level nothing paid for. `prefab` is an outpost kit
  // field and is copied through untouched on a main-yard save.
  if (
    countdownOf(submitted, "cB") > 0 &&
    submitted.prefab == null &&
    Number(submitted.l) > 1
  ) {
    out.violations.push(violation("levelJumped", id, { from, to: Number(submitted.l) }));
  }

  if (to < from) {
    out.violations.push(violation("levelDropped", id, { from, to }));
    return out;
  }

  if (to > top) {
    out.violations.push(violation("levelJumped", id, { from, to, max: top }));
    return out;
  }

  const running: CountdownField | null =
    countdownOf(reference, "cU") > 0 ? "cU" : countdownOf(reference, "cB") > 0 ? "cB" : null;

  if (to === from) {
    // The reference was mid-upgrade and the submitted save is not: a cancel,
    // which hands the whole step back (`BFOUNDATION.as:2401-2432`).
    if (running === "cU" && countdownOf(submitted, "cU") === 0) {
      addAmounts(out.refund, cancelRefund(type, from));
      return out;
    }

    // A countdown that was not there before: the player started an upgrade.
    if (countdownOf(submitted, "cU") > 0 && countdownOf(reference, "cU") === 0) {
      startUpgrade(reference, submitted, from, type, ctx, id, out);
    }

    return out;
  }

  // From here the level rose. The step the reference countdown was already
  // paying for is the only one this save does not owe resources on.
  const firstUnpaid = running ? from + 1 : from;

  if (running) {
    const remaining = countdownOf(reference, running);
    if (!mayFinish(remaining, ctx)) {
      const earliest = remaining - ctx.tolerance - ctx.voucher.speedup;
      out.violations.push(
        violation("countdownJumped", id, {
          field: running,
          expected: Math.max(0, earliest),
          sent: 0,
        })
      );
      return out;
    }

    if (remaining > ctx.tolerance && ctx.voucher.speedup > 0) out.spentVoucher = true;

    out.points +=
      running === "cB"
        ? pointsForBuild(costs[0]!) + (rawType === TOWN_HALL_TYPE ? TOWN_HALL_BUILD_POINTS : 0)
        : pointsForUpgrade(costs[from]!);
  }

  const pending = upgradeSteps(type, firstUnpaid, to);
  if (pending.length === 0) return out;

  // Blocks go up in one purchase, every wall in the yard at once, and nothing
  // in resources.
  if (blockUpgradeCovers(rawType, to, ctx.voucher)) {
    out.spentVoucher = true;
    for (const step of pending) out.points += pointsForUpgrade(step);
    return out;
  }

  // One step, no countdown to explain it: the shiny "finish now before
  // starting" path (`BFOUNDATION.as:2130-2140`).
  if (!running && pending.length === 1 && ctx.voucher.kind === "instantUpgrade") {
    const needed = instantCost(costs[from]);
    if (!voucherCovers(ctx.voucher, needed)) {
      out.violations.push(
        violation("voucherShort", id, {
          item: ctx.voucher.key,
          quantity: ctx.voucher.quantity,
          needed,
        })
      );
    }
    out.spentVoucher = true;
    out.points += pointsForUpgrade(costs[from]!);
    return out;
  }

  // Otherwise every pending step has to fit inside the gap between the two
  // saves (§6, item 10). A lost save between two five-second wall steps is the
  // honest case this covers; anything slower than a wall cannot fit two steps
  // into one save interval, and a single step that started and finished inside
  // one interval is the same reading applied to `k == 1`.
  const needed = pending.reduce((total, step) => total + Math.floor(step[4] * ctx.bst), 0);

  if (needed <= ctx.elapsed + ctx.tolerance) {
    for (const step of pending) {
      out.charged.push(step);
      out.points += pointsForUpgrade(step);
    }
    return out;
  }

  out.violations.push(
    violation(pending.length === 1 ? "unpaidUpgrade" : "levelJumped", id, {
      from,
      to,
      needed,
      elapsed: ctx.elapsed,
    })
  );

  return out;
};

/**
 * Explains a building that is in the submitted save and not in the stored one
 * (§2.2, "New").
 *
 * Exactly one of the five explanations has to hold. They are tried in the order
 * that keeps the resource budget honest: the shiny ones first, because charging
 * a building the player paid shiny for would subtract resources from the budget
 * that the delta never spent and turn an honest save into a `resourceBudget`
 * violation.
 */
export const explainNewBuilding = (
  submitted: BuildingData,
  ctx: NewBuildingContext
): Transition => {
  const out = emptyTransition();
  const id = Number(submitted.id);
  const rawType = Number(submitted.t);
  const type = pricingType(rawType);
  const row = costOf(type);

  if (!row) {
    out.violations.push(violation("unknownType", id, { type: rawType }));
    return out;
  }

  const step = row.costs[0];
  if (!step) {
    out.violations.push(violation("unknownType", id, { type: rawType }));
    return out;
  }

  // Prerequisites, measured against the reference yard (§2.5).
  if (step[5].length > 0) {
    if (ctx.hall <= 0) {
      out.violations.push(violation("upgradeBlocked", id, { townHall: { have: 0, need: 1 } }));
    } else {
      const unmet = requirementDetail(step[5], ctx.reference, ctx.hall);
      if (unmet) out.violations.push(violation("upgradeBlocked", id, unmet));
    }
  }

  const level = Number(submitted.l);
  const levelOk = !Number.isFinite(level) || level <= 1;
  const cB = countdownOf(submitted, "cB");

  // 1. A build in progress. The worker walk only ever makes a countdown longer,
  //    so only the upper bound is firm (`BFOUNDATION.as:1670-1673`, `:1376-1393`).
  if (cB > 0) {
    const expected = Math.floor(step[4] * ctx.bst);

    if (!levelOk && submitted.prefab == null) {
      out.violations.push(violation("levelJumped", id, { from: 0, to: level }));
    }

    if (cB > expected) {
      out.violations.push(violation("countdownTooLong", id, { field: "cB", expected, sent: cB }));
    } else {
      const earliest = expected - ctx.elapsed - ctx.tolerance;
      if (cB < earliest) {
        out.violations.push(
          violation("countdownJumped", id, { field: "cB", expected: Math.max(0, earliest), sent: cB })
        );
      }
    }

    out.charged.push(step);
    return out;
  }

  const buildPoints = () =>
    pointsForBuild(step) + (rawType === TOWN_HALL_TYPE ? TOWN_HALL_BUILD_POINTS : 0);

  // 3. Instant build: paid in shiny, charged nothing in resources.
  if (levelOk && ctx.voucher.kind === "instantBuild") {
    const needed = instantCost(step);
    if (!voucherCovers(ctx.voucher, needed)) {
      out.violations.push(
        violation("voucherShort", id, {
          item: ctx.voucher.key,
          quantity: ctx.voucher.quantity,
          needed,
        })
      );
    }
    out.spentVoucher = true;
    out.points += buildPoints();
    return out;
  }

  // 4. From inventory: a decoration the player already owned, or one bought
  //    with this save's `BUILDING<t>` voucher. Charged nothing either way
  //    (`BFOUNDATION.as:1690-1692`).
  if (row.kind === "decoration") {
    if (ctx.inventory.has(rawType)) return out;
    if (ctx.voucher.kind === "decoration" && ctx.voucher.target === rawType) {
      out.spentVoucher = true;
      return out;
    }
  }

  // 2. Finished on the spot: walls, traps and anything under five minutes
  //    finish for free, and a decoration's step takes no time at all.
  if (levelOk && step[4] <= FREE_FINISH_SECONDS) {
    out.charged.push(step);
    out.points += buildPoints();
    return out;
  }

  out.violations.push(violation("unpaidBuild", id, { type: rawType, level: levelOk ? 1 : level }));
  return out;
};
