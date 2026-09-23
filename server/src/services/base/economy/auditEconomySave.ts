import type { EconomyConfig } from "../../../config/EconomyConfig.js";
import { layoutInvalidErr } from "../../../errors/errors.js";
import { COSTS, type CostStep } from "../../../game-data/buildingCosts.js";
import type {
  BuildingData,
  BuildingDataMap,
  BuildingHealthData,
} from "../../../types/BuildingData.js";
import type { JsonObject } from "../../../types/JsonObject.js";
import {
  countOfType,
  levelOf,
  sumCosts,
  townHallLevel,
  type ResourceAmounts,
} from "../../yardplanner/costs.js";
import { MAX_LISTED } from "../../yardplanner/validateLayout.js";
import { referenceYard } from "./referenceYard.js";
import {
  addAmounts,
  baseValueOf,
  harvestAllowance,
  noAmounts,
  outpostAllowance,
  pricingType,
  refundOf,
  slackFor,
  storageCap,
  topupCost,
  RESOURCE_KEYS,
  type HarvestReport,
  type ResourceKey,
} from "./resourceBudget.js";
import {
  explainNewBuilding,
  explainTransition,
  type Transition,
  type TransitionContext,
} from "./transitions.js";
import { readVoucher, voucherCovers } from "./voucher.js";

/**
 * The economy audit: everything an owner save claims, checked against the yard
 * the server already holds (`docs/design/economy-save-validation.md` §2).
 *
 * Pure. It reads a slice of the stored `Save`, the parsed body, and the clock,
 * and returns a verdict: the fields the server derives for itself, what the
 * save should have spent, what it was allowed to gain, and every rule it broke.
 * Writing the verdict down, and refusing the save in `reject` mode, is
 * `recordVerdict.ts`'s job; this file never touches the database, the logger or
 * the entity it was handed.
 *
 * It never throws for a violation. The only error it raises is `malformed`, a
 * 400 for a body no honest client sends, which is the same split
 * `wallUpgrade.ts` makes between a request that cannot be read and a yard that
 * cannot support one.
 *
 * Unlike the Yard Planner batch routes it does **not** stop at the first
 * problem: the whole point of `log` mode is a verdict that names everything,
 * so a week of production logs can say which rules fire on honest play.
 */

/* -------------------------------------------------------------------------- */
/* The verdict                                                                 */
/* -------------------------------------------------------------------------- */

/** Every rule this audit can report, as it appears on the wire (§3.5). */
export type EconomyRule =
  | "typeChanged"
  | "unknownType"
  | "unpaidBuild"
  | "levelJumped"
  | "levelDropped"
  | "unpaidUpgrade"
  | "upgradeBlocked"
  | "countdownJumped"
  | "countdownTooLong"
  | "capReached"
  | "voucherShort"
  | "negativePool"
  | "resourceBudget"
  | "bufferJumped"
  | "overCap"
  | "capMismatch"
  | "basevalueMismatch"
  | "pointsJumped"
  | "fortifyUnpriced";

/** One thing the save could not explain. */
export interface EconomyViolation {
  rule: EconomyRule;
  /** Building ids, the first {@link MAX_LISTED}. */
  ids?: number[];
  detail?: Record<string, unknown>;
  /**
   * Whether this rule refuses the save in `reject` mode.
   *
   * Decided by the rule and never by the mode, so one verdict serves both and
   * the log line can say which violations *would* have rejected. False for the
   * `r3`/`r4` budgets (§6, item 1), for fortification (§6, item 4) and for the
   * two log-only mismatches, which are derived rather than refused.
   */
  enforced: boolean;
}

/** The fields the server works out for itself rather than storing what arrived. */
export interface EconomyDerived {
  r1max: number;
  r2max: number;
  r3max: number;
  r4max: number;
  /** A string, because that is what the `Save` row holds (`save.model.ts:155`). */
  basevalue: string;
}

/** What one audited save came to. */
export interface EconomyVerdict {
  violations: EconomyViolation[];
  derived: EconomyDerived;
  /** What this save should have spent, summed over every step it was charged. */
  charged: ResourceAmounts;
  /** The most each resource was allowed to gain. */
  budget: Record<ResourceKey, number>;
  /** Seconds between the stored save and now, clamped. */
  elapsed: number;
}

/**
 * Which rules apply to a save (§2.1).
 *
 * `main` is an owner save of a main yard, the only yard the cost table
 * describes. `outpost` is an owner save from an outpost session, which gets the
 * resource rules only because the delta lands on the main pool but outpost
 * buildings have their own props table. `none` is everything else: attacks,
 * Inferno, Map Room 1 tribes.
 */
export type EconomyAuditKind = "main" | "outpost" | "none";

/** The parts of a stored `Save` the audit reads. */
export interface StoredEconomySave {
  savetime?: number | null;
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
  resources?: JsonObject | null;
  storedata?: JsonObject | null;
  buildingresources?: JsonObject | null;
  researchdata?: JsonObject | null;
  outposts?: readonly unknown[] | null;
  points?: string | null;
  basevalue?: string | null;
}

/**
 * The parts of the request body the audit reads.
 *
 * Everything the schema does not give a firm shape to is `unknown` here rather
 * than a guessed type: the body is JSON from a client this server cannot patch,
 * so the audit parses what it needs and treats anything else as absent. That is
 * also what lets the controller hand this the parsed `saveData` whole.
 *
 * `buildinghealthdata` is deliberately absent: damage pauses a countdown, and
 * the pause the audit has to model is the one that was in force over the gap,
 * which is the **stored** health and not the health the client just reported.
 */
export interface SubmittedEconomySave {
  buildingdata?: BuildingDataMap | null;
  /** The **delta** `r1..r4` plus the absolute `r1max..r4max`. */
  resources?: unknown;
  /** The one voucher a save can carry: `[itemKey, quantity]`. */
  purchase?: readonly unknown[] | null;
  points?: unknown;
  basevalue?: unknown;
  researchdata?: unknown;
}

/** Everything one audit needs. */
export interface AuditInput {
  kind: EconomyAuditKind;
  /** The base being saved: its yard, its countdowns, its `savetime`. */
  stored: StoredEconomySave;
  /**
   * The save the resource delta lands on. The same row as `stored` for a main
   * yard, and the player's main save for an outpost session
   * (`controllers/base/save/baseSave.ts:79-80`).
   */
  pool: StoredEconomySave;
  submitted: SubmittedEconomySave;
  now: number;
  config: EconomyConfig;
}

/* -------------------------------------------------------------------------- */
/* Reading the body                                                            */
/* -------------------------------------------------------------------------- */

/** The tutorial's four opening buildings: Town Hall, Twig Snapper, Pebble Shiner, General Store. */
const TUTORIAL_TYPES = [1, 2, 12, 14];

/** What the tutorial bootstrap hands a brand new account (`client/scripts/BASE.as:1695-1703`). */
const TUTORIAL_GRANT: ResourceAmounts = { r1: 1600, r2: 1600, r3: 0, r4: 0 };

/** The tutorial's Twig Snapper arrives with a small pre-filled buffer. */
const TUTORIAL_MAX_BUFFER = 200;

/** A body this audit cannot read at all: a 400, not a refusal. */
const malformed = (message: string, issues: unknown[]): never => {
  throw layoutInvalidErr(message, {
    rule: "malformed",
    issues: issues.slice(0, MAX_LISTED),
  });
};

/** A finite number, or `null` when the value is not one. */
const finite = (raw: unknown): number | null => {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

/**
 * Reads the submitted `buildingdata`.
 *
 * `undefined` means the save carried no `buildingdata` key at all, which the
 * controller already treats as "change nothing" (`baseSave.ts:103`), so the
 * building rules are skipped rather than reading the whole yard as removed.
 */
const parseBuildings = (raw: BuildingDataMap | null | undefined): BuildingDataMap | null => {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    malformed("That save's buildings could not be read.", ["buildingdata is not an object"]);
  }

  const issues: string[] = [];
  for (const [key, building] of Object.entries(raw)) {
    if (!building || typeof building !== "object" || Array.isArray(building)) {
      issues.push(`${key} is not a building`);
      continue;
    }
    if (finite(building.t) === null) issues.push(`${key} has no building type`);
    if (finite(building.id) === null) issues.push(`${key} has no building id`);
  }

  if (issues.length > 0) malformed("That save's buildings could not be read.", issues);
  return raw;
};

/** The submitted `resources` blob as a bag of keys, or `null` when it is not one. */
const asRecord = (raw: unknown): Record<string, unknown> | null =>
  raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;

/** Reads the submitted resource delta. Absent keys are zero, unreadable ones are a 400. */
const parseDelta = (raw: Record<string, unknown> | null): ResourceAmounts => {
  const delta = noAmounts();
  if (!raw) return delta;

  const issues: string[] = [];
  for (const resource of RESOURCE_KEYS) {
    const value = raw[resource];
    if (value === undefined || value === null) continue;
    const parsed = finite(value);
    if (parsed === null) {
      issues.push(`resources.${resource} is not a number`);
      continue;
    }
    delta[resource] = parsed;
  }

  if (issues.length > 0) malformed("That save's resources could not be read.", issues);
  return delta;
};

/** A resource amount off a save's `resources` column. */
const poolAmount = (resources: JsonObject | null | undefined, resource: ResourceKey): number =>
  finite(resources?.[resource]) ?? 0;

/** Whether Sharper Tools was still running (`client/scripts/STORE.as:2513-2519`). */
const sharperToolsActive = (storedata: JsonObject | null | undefined, now: number): boolean =>
  (finite(storedata?.BST?.e) ?? 0) > now;

/**
 * Whether a stored building was damaged or repairing, and so had its countdown
 * paused (`services/yardplanner/wallUpgrade.ts:101-102`).
 */
const isDamaged = (
  building: BuildingData,
  health: BuildingHealthData | null | undefined
): boolean => building.hp != null || (health != null && String(building.id) in health);

/** Decoration types the player already owns, read off `researchdata` (§2.2, item 4). */
const inventoryTypes = (researchdata: unknown): Set<number> => {
  const types = new Set<number>();
  if (!researchdata || typeof researchdata !== "object") return types;

  for (const [key, value] of Object.entries(researchdata as Record<string, unknown>)) {
    const matched = /^(?:BUILDING)?(\d+)$/.exec(key);
    if (!matched) continue;

    const type = Number(matched[1]);
    const held =
      typeof value === "object" && value !== null
        ? finite((value as Record<string, unknown>).q) ?? 1
        : finite(value) ?? 1;

    if (held > 0) types.add(type);
  }

  return types;
};

/**
 * The tutorial bootstrap (§2.2, item 5).
 *
 * A brand new account's stored yard is empty and its pool is zero
 * (`game-data/getDefaultBaseData.ts:35-44`), and the first save it ever sends
 * places four buildings and credits 1,600 twigs and pebbles that nothing in the
 * yard produced. The shape is checked here; the grant it earns is handed to the
 * budget, which is what decides whether the delta fits.
 */
const isTutorialBootstrap = (
  stored: BuildingDataMap,
  submitted: BuildingDataMap | null
): boolean => {
  if (!submitted) return false;
  if (Object.keys(stored).length !== 0) return false;

  const buildings = Object.values(submitted);
  if (buildings.length !== TUTORIAL_TYPES.length) return false;

  const types = buildings.map((building) => Number(building.t)).sort((a, b) => a - b);
  if (types.some((type, index) => type !== TUTORIAL_TYPES[index])) return false;
  if (buildings.some((building) => levelOf(building) !== 1)) return false;

  const snapper = buildings.find((building) => Number(building.t) === 1);
  return (finite(snapper?.st) ?? 0) <= TUTORIAL_MAX_BUFFER;
};

/* -------------------------------------------------------------------------- */
/* The audit                                                                   */
/* -------------------------------------------------------------------------- */

/** The derived block that leaves a save exactly as it is: used when nothing is audited. */
const untouchedDerived = (
  pool: StoredEconomySave,
  stored: StoredEconomySave
): EconomyDerived => ({
  r1max: finite(pool.resources?.r1max) ?? 0,
  r2max: finite(pool.resources?.r2max) ?? 0,
  r3max: finite(pool.resources?.r3max) ?? 0,
  r4max: finite(pool.resources?.r4max) ?? 0,
  basevalue: String(stored.basevalue ?? "0"),
});

/** A zeroed budget, one entry per resource. */
const emptyBudget = (): Record<ResourceKey, number> => ({ r1: 0, r2: 0, r3: 0, r4: 0 });

/**
 * Audits one owner save.
 *
 * @param input The stored save, the pool the delta lands on, the parsed body,
 *   the server clock and the economy config.
 * @returns The verdict. Never `null`, never throwing for a violation.
 * @throws {ClientSafeError} 400, when the body cannot be read at all.
 */
export const auditEconomySave = (input: AuditInput): EconomyVerdict => {
  const { kind, stored, pool, submitted, now, config } = input;

  const { buildingdata: reference, elapsed } = referenceYard(stored, now);

  if (kind === "none") {
    return {
      violations: [],
      derived: untouchedDerived(pool, stored),
      charged: noAmounts(),
      budget: emptyBudget(),
      elapsed,
    };
  }

  const violations: EconomyViolation[] = [];
  const storedYard = stored.buildingdata ?? {};
  const submittedYard = parseBuildings(submitted.buildingdata);
  const submittedResources = asRecord(submitted.resources);
  const delta = parseDelta(submittedResources);

  // The yard the derived fields are read off: the submitted one when the save
  // carried it, and the reference otherwise.
  const currentYard = submittedYard ?? reference;

  const voucher = readVoucher(submitted.purchase as readonly unknown[] | null | undefined);
  const bst = sharperToolsActive(stored.storedata, now) ? 0.8 : 1;
  const hall = townHallLevel(reference);
  const bootstrap = kind === "main" && isTutorialBootstrap(storedYard, submittedYard);
  const inventory = inventoryTypes(stored.researchdata);

  const context: Omit<TransitionContext, "damaged"> = {
    elapsed,
    tolerance: config.timerTolerance,
    bst,
    voucher,
    reference,
    hall,
  };

  /* ---- §2.2, §2.3, §2.5: buildings ------------------------------------- */

  const charged: CostStep[] = [];
  const refunds = noAmounts();
  let completionPoints = 0;
  let voucherUses = 0;

  const absorb = (transition: Transition): void => {
    charged.push(...transition.charged);
    addAmounts(refunds, transition.refund);
    completionPoints += transition.points;
    if (transition.spentVoucher) voucherUses += 1;
    violations.push(...transition.violations);
  };

  if (kind === "main" && submittedYard) {
    const ids = new Set([...Object.keys(storedYard), ...Object.keys(submittedYard)]);

    for (const key of ids) {
      const before = storedYard[key];
      const current = reference[key];
      const after = submittedYard[key];

      // Removed. Recycling and cancelling are the player's right; all they do
      // is feed the refund term of the delta budget.
      if (before && !after) {
        addAmounts(refunds, refundOf(current ?? before));
        continue;
      }

      if (!before && after) {
        // The tutorial's four buildings arrive together with the grant that
        // pays for them, so they are not each explained on their own.
        if (bootstrap) continue;
        absorb(explainNewBuilding(after, { ...context, inventory }));
        continue;
      }

      if (!before || !after || !current) continue;

      const wasType = Number(before.t);
      const isType = Number(after.t);
      const legacyRewrite = wasType === 18 && isType === 17 && levelOf(after) >= 2;

      if (wasType !== isType && !legacyRewrite) {
        violations.push({
          rule: "typeChanged",
          ids: [Number(after.id ?? key)],
          detail: { from: wasType, to: isType },
          enforced: true,
        });
        continue;
      }

      absorb(
        explainTransition(before, current, after, {
          ...context,
          damaged: isDamaged(before, stored.buildinghealthdata),
        })
      );
    }

    // The tutorial bootstrap is one atomic grant against an empty yard, where
    // the reference Town Hall level is 0 and every cap with it, so the four
    // buildings it places would all read as over their allowance.
    if (!bootstrap) violations.push(...checkQuantityCaps(reference, submittedYard, hall));
  }

  /* ---- §2.6: the delta budget ------------------------------------------ */

  const harvest: HarvestReport =
    kind === "outpost"
      ? { allowance: noAmounts(), overfull: [] }
      : harvestAllowance(storedYard, submittedYard ?? storedYard, elapsed);

  for (const harvester of harvest.overfull.slice(0, MAX_LISTED)) {
    violations.push({
      rule: "bufferJumped",
      ids: [harvester.id],
      detail: { sent: harvester.sent, max: harvester.max },
      enforced: true,
    });
  }

  const income = outpostAllowance(
    (kind === "outpost" ? pool : stored).buildingresources,
    elapsed,
    config.overdriveMax
  );

  if (kind === "outpost") {
    // Outposts cannot recycle or cancel a build at all
    // (`client/scripts/BFOUNDATION.as:2513-2515`).
    refunds.r1 = 0;
    refunds.r2 = 0;
    refunds.r3 = 0;
    refunds.r4 = 0;
  }

  const spend = sumCosts(charged);
  const topup = noAmounts();

  if (voucher.kind === "resourceTopup") {
    for (const resource of RESOURCE_KEYS) {
      topup[resource] = Math.max(0, spend[resource] - poolAmount(pool.resources, resource));
    }

    const needed = topupCost(topup);
    if (!voucherCovers(voucher, needed)) {
      violations.push({
        rule: "voucherShort",
        detail: { item: voucher.key, quantity: voucher.quantity, needed },
        enforced: true,
      });
    }
    voucherUses += 1;
  }

  // One purchase, one excuse. A save carries at most one voucher
  // (`client/scripts/BASE.as:2609-2611`), so a single `SP4` cannot finish four
  // hundred wall countdowns. `BLK<n>` is the one key with unlimited uses,
  // because it upgrades every block in the yard in one purchase.
  if (voucherUses > voucher.uses) {
    violations.push({
      rule: "voucherShort",
      detail: {
        item: voucher.key,
        quantity: voucher.quantity,
        used: voucherUses,
        allowed: voucher.uses,
      },
      enforced: true,
    });
  }

  const budget = emptyBudget();

  for (const resource of RESOURCE_KEYS) {
    const production = harvest.allowance[resource] + income[resource];
    const grant = bootstrap ? TUTORIAL_GRANT[resource] : 0;

    budget[resource] =
      production + refunds[resource] + topup[resource] + grant - spend[resource] + slackFor(production);

    const before = poolAmount(pool.resources, resource);

    // `updateResources` would happily store a negative pool (`:40-42`).
    if (before + delta[resource] < 0) {
      violations.push({
        rule: "negativePool",
        detail: { resource, pool: before, delta: delta[resource] },
        enforced: true,
      });
    }

    // Only a *gain* needs a source (§2.6). A delta of zero or less is never a
    // violation, however far below it the budget sits: spending less than the
    // server charged is allowed (§4.1, the zero-delta Cannon Tower; §4.2 step
    // 6, the free wall), and a delta more negative than `-spend` is the honest
    // shape of a save that also fed a monster, since monsters, champions and
    // the academy move goo and putty outside this model.
    //
    // Without the `> 0` guard a save that merely bought something inside one
    // save window reads as a cheat: the budget goes negative by the price, and
    // a zero delta is then "above" it.
    if (delta[resource] > 0 && delta[resource] > budget[resource]) {
      violations.push({
        rule: "resourceBudget",
        detail: { resource, delta: delta[resource], budget: budget[resource] },
        enforced: resource === "r1" || resource === "r2",
      });
    }
  }

  /* ---- §2.7: storage caps ---------------------------------------------- */

  const derived = untouchedDerived(pool, stored);

  if (kind === "main") {
    const cap = storageCap({
      buildingdata: currentYard,
      storedata: stored.storedata,
      outposts: stored.outposts,
    });

    derived.r1max = cap;
    derived.r2max = cap;
    derived.r3max = cap;
    derived.r4max = cap;

    for (const resource of RESOURCE_KEYS) {
      const sent = finite(submittedResources?.[`${resource}max`]);
      if (sent !== null && sent !== cap) {
        violations.push({
          rule: "capMismatch",
          detail: { resource, sent, derived: cap },
          enforced: false,
        });
      }

      // A pool already over the cap is not a violation — sandbox yards and the
      // past are what they are — but a positive delta may not carry one from at
      // or below the cap to above it (`BASE.Fund` clamps, `BASE.as:4494-4536`).
      const before = poolAmount(pool.resources, resource);
      if (delta[resource] > 0 && before <= cap && before + delta[resource] > cap) {
        violations.push({
          rule: "overCap",
          detail: { resource, cap, pool: before },
          enforced: true,
        });
      }
    }
  }

  /* ---- §2.9: points and base value ------------------------------------- */

  if (kind === "main") {
    const computed = baseValueOf(currentYard);
    const highWater = Math.max(finite(stored.basevalue) ?? 0, computed);
    derived.basevalue = String(highWater);

    const sent = finite(submitted.basevalue);
    if (submitted.basevalue !== undefined && submitted.basevalue !== null && sent === null) {
      malformed("That save's base value could not be read.", ["basevalue is not a number"]);
    }
    if (sent !== null && sent !== highWater) {
      violations.push({
        rule: "basevalueMismatch",
        detail: { sent, derived: highWater },
        enforced: false,
      });
    }
  }

  if (submitted.points !== undefined && submitted.points !== null) {
    const sent = finite(submitted.points);
    if (sent === null) malformed("That save's points could not be read.", ["points is not a number"]);

    const before = finite(stored.points) ?? 0;
    const gained = (sent as number) - before;

    // Banking awards points equal to the amount banked, so the resource budget
    // is also the points budget (§6, item 12). It over-allows after tutorial
    // stage 200, where banking points are halved, and that is fine for an
    // upper bound.
    let pointsBudget = completionPoints;
    for (const resource of RESOURCE_KEYS) {
      const production = harvest.allowance[resource] + income[resource];
      pointsBudget += production + topup[resource] + slackFor(production);
    }

    if (gained < 0 || gained > pointsBudget) {
      violations.push({
        rule: "pointsJumped",
        detail: { delta: gained, budget: pointsBudget },
        enforced: true,
      });
    }
  }

  return {
    violations,
    derived,
    charged: { r1: spend.r1, r2: spend.r2, r3: spend.r3, r4: spend.r4 },
    budget,
    elapsed,
  };
};

/**
 * Quantity caps (§2.5).
 *
 * Only a type the submitted yard holds *more* of than the reference is checked,
 * so a yard that was already over its cap — a Town Hall that was downgraded, a
 * props change — is not refused for standing still. A type with an empty
 * `quantity` array is uncapped (`game-data/buildingCosts.ts:20-21`).
 *
 * Two readings come straight from `BASE.CanBuild` (`client/scripts/BASE.as:3718-3740`):
 * a Town Hall above the end of the array reads the array's last entry, and a
 * decoration is capped by `quantity[0]` alone and is uncapped outright when
 * that entry is 0, which is how every store decoration escapes a `[0]` row.
 */
const checkQuantityCaps = (
  reference: BuildingDataMap,
  submitted: BuildingDataMap,
  hall: number
): EconomyViolation[] => {
  const violations: EconomyViolation[] = [];
  const types = new Set(Object.values(submitted).map((building) => Number(building.t)));

  for (const type of types) {
    const have = countOfType(submitted, type);
    if (have <= countOfType(reference, type)) continue;

    const row = COSTS[pricingType(type)];
    const quantity = row?.quantity;
    if (!row || !quantity || quantity.length === 0) continue;

    const decoration = row.kind === "decoration";
    if (decoration && (quantity[0] ?? 0) === 0) continue;

    const index = decoration ? 0 : Math.min(Math.max(hall, 0), quantity.length - 1);
    const max = quantity[index] ?? 0;
    if (have <= max) continue;

    violations.push({
      rule: "capReached",
      detail: { type, have, max },
      enforced: true,
    });
  }

  return violations;
};
