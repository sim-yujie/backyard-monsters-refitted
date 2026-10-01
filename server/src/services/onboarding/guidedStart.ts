import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { costOf } from "../../game-data/buildingCosts.js";
import { stepAmounts } from "../base/economy/resourceBudget.js";
import { yardKindOf, type ResourceAmounts } from "../yardplanner/costs.js";
import { planBuild, type BuildRequest, type BuildSave } from "../yard/build.js";
import { finishBuildingJob, runningCountdown } from "../yard/buildingJobs.js";
import { readHoused } from "../yard/production.js";
import { yardRefusedErr } from "../yard/yardErrors.js";
import { guideOpen, type GrantRecord, type Onboarding } from "./state.js";

/**
 * The guided start's rules on the server (`docs/design/tutorial.md` §2, §8.3,
 * §8.4; issue #227): the fixed order of macro steps, what each step checks
 * before it moves on, and the grants: the four top-ups, the four free
 * finishes and the free Pokeys.
 *
 * Pure: every function takes the caught-up save and its onboarding record and
 * returns what should change, or throws the refusal. The routes
 * (`controllers/yard/guide.ts`, and `/bm/yard/build` for the guided build)
 * hand back the new record as `slices.onboarding` with the effect it pays
 * for, so a grant and its ledger entry land in the one locked transaction
 * (anti-cheat rule 2), and the step moves on in it too (rule 3).
 *
 * The practice camp's row (`practiceCamp.ts`) is the routes' business: the
 * rules here only say when it opens, resets and goes.
 */

/** The macro steps, in order (§2.3). The client splits each into micro steps. */
export const GUIDE_STEPS = [
  "welcome",
  "collect",
  "build-sniper",
  "finish-sniper",
  "raid",
  "build-housing",
  "finish-housing",
  "pokeys",
  "build-maproom",
  "finish-maproom",
  "build-flinger",
  "finish-flinger",
  "open-map",
  "pick-camp",
  "attack",
  "attack-result",
  "home-goals",
  "finish-now",
  "protection",
] as const;

export type GuideStep = (typeof GUIDE_STEPS)[number];

/** The buildings the guide pays for, by the name its steps use. */
export const GUIDE_BUILDINGS = {
  sniper: 21,
  housing: 15,
  maproom: 11,
  flinger: 5,
} as const;

export type GuideBuildingName = keyof typeof GUIDE_BUILDINGS;

/** The Pokey, the free army (§2.3 step 8). */
export const POKEY = "C1";

/** Housed Pokeys the guide tops up to, never above (anti-cheat rule 5). */
export const FREE_POKEYS = 15;

/** Damage protection at the end, or at a skip (Q11): seven days. */
export const PROTECTION_SECONDS = 7 * 24 * 60 * 60;

/** `tutorialstage` once the guide is over (Flash's last stage). */
export const TUTORIAL_DONE_STAGE = 205;

const nameOf = (type: number): GuideBuildingName | undefined =>
  (Object.keys(GUIDE_BUILDINGS) as GuideBuildingName[]).find((name) => GUIDE_BUILDINGS[name] === type);

/** The step that builds `type`, e.g. `build-sniper`; undefined for a type the guide does not build. */
export const buildStepOf = (type: number): GuideStep | undefined => {
  const name = nameOf(type);
  return name ? (`build-${name}` as GuideStep) : undefined;
};

/** The step that finishes `type`, e.g. `finish-sniper`. */
export const finishStepOf = (type: number): GuideStep | undefined => {
  const name = nameOf(type);
  return name ? (`finish-${name}` as GuideStep) : undefined;
};

/** The building type a `build-*` or `finish-*` step is about. */
export const typeOfStep = (step: string | undefined): number | undefined => {
  const match = /^(?:build|finish)-(\w+)$/.exec(step ?? "");
  const name = match?.[1] as GuideBuildingName | undefined;
  return name && name in GUIDE_BUILDINGS ? GUIDE_BUILDINGS[name] : undefined;
};

/** The step after `step` in the fixed order. */
export const nextStep = (step: GuideStep): GuideStep => {
  const at = GUIDE_STEPS.indexOf(step);
  return GUIDE_STEPS[Math.min(at + 1, GUIDE_STEPS.length - 1)]!;
};

/* ── Refusals ─────────────────────────────────────────────────────────────── */

/** The guide is over (done, skipped) or never ran (legacy): rule 6. */
export const guideClosedErr = () =>
  yardRefusedErr("guideClosed", "The guided start is over for this account.");

/** The request names a step the guide is not at: a replayed or out-of-order request (rule 3). */
export const wrongStepErr = (at: string | undefined, asked?: string) =>
  yardRefusedErr("wrongStep", "That is not the guided start's current step.", {
    step: at ?? null,
    ...(asked !== undefined && { asked }),
  });

/** A grant already in the ledger (rule 2). */
export const alreadyGrantedErr = (key: string) =>
  yardRefusedErr("alreadyGranted", "Bob has already given you that.", { grant: key });

/** The step's own condition is not met yet. */
const notYetErr = (message: string) => yardRefusedErr("notYet", message);

/** The guide must be running (`active`); `pending` only starts with `welcome`. */
const requireActive = (onboarding: Onboarding): void => {
  if (!guideOpen(onboarding)) throw guideClosedErr();
  if (onboarding.guide.state !== "active") throw wrongStepErr("welcome");
};

/** The current step, `welcome` while the guide has not started. */
export const currentStep = (onboarding: Onboarding): GuideStep => {
  const step = onboarding.guide.step;
  if (onboarding.guide.state === "pending") return "welcome";
  return (GUIDE_STEPS as readonly string[]).includes(step ?? "") ? (step as GuideStep) : "welcome";
};

/* ── Small readers ───────────────────────────────────────────────────────── */

/** A built building of `type` that is not under construction. */
const finishedOfType = (buildings: BuildingDataMap | null | undefined, type: number): boolean =>
  Object.values(buildings ?? {}).some(
    (building) => Number(building?.t) === type && !(Number(building?.cB) > 0)
  );

/** The ledger's record under `key`, when it is a building grant. */
export const grantOf = (onboarding: Onboarding, key: string): GrantRecord | undefined => {
  const grant = onboarding.grants[key];
  return grant && !Array.isArray(grant) ? grant : undefined;
};

/** Ids of every building the guide paid for (`fund:<type>`): the ones cancelling is refused for. */
export const fundedBuildingIds = (onboarding: Onboarding): number[] =>
  Object.entries(onboarding.grants)
    .filter(([key]) => key.startsWith("fund:"))
    .map(([, grant]) => (!Array.isArray(grant) && typeof grant?.id === "number" ? grant.id : null))
    .filter((id): id is number => id !== null);

/* ── guide/advance ───────────────────────────────────────────────────────── */

/** What the route needs to know about the world outside the save for an advance. */
export interface AdvanceFacts {
  /** Whether the practice camp's row says it was destroyed (steps `attack`, `attack-result`). */
  campDestroyed?: boolean;
}

/** What an advance decided. */
export interface AdvancePlan {
  onboarding: Onboarding;
  /** The step it moved to, or `done`. */
  step: GuideStep | "done";
  /** The camp goes now (a win). */
  removeCamp: boolean;
  /** `protected` and `tutorialstage` to write (the last step). */
  finish?: { protected: number; tutorialstage: number };
}

/** Steps `guide/advance` moves on from; the rest move inside their grant route. */
export const ADVANCE_STEPS: ReadonlySet<GuideStep> = new Set<GuideStep>([
  "welcome",
  "collect",
  "raid",
  "open-map",
  "pick-camp",
  "attack",
  "attack-result",
  "home-goals",
  "finish-now",
  "protection",
]);

/**
 * `guide/advance {from}`: checks `from` is the stored step and its condition
 * (§8.3 table), and moves on.
 *
 * - `welcome`: the guide goes `pending` to `active`.
 * - `raid`: a finished Sniper Tower stands; sets `raidSeen` (goal D1).
 * - `open-map`: the camp is open.
 * - `attack` and `attack-result`: the camp destroyed, it goes and the step is
 *   `home-goals`; not destroyed, the step is `attack-result` (the free retry).
 * - `protection`: the guide is `done`, with seven days of protection.
 */
export const planAdvance = (
  save: { buildingdata?: BuildingDataMap | null; protected?: number | null },
  current: Onboarding,
  from: string,
  now: number,
  facts: AdvanceFacts = {}
): AdvancePlan => {
  if (!guideOpen(current)) throw guideClosedErr();
  const at = currentStep(current);
  if (from !== at) throw wrongStepErr(at, from);
  if (!ADVANCE_STEPS.has(at)) throw wrongStepErr(at, from);
  if (at !== "welcome" && current.guide.state !== "active") throw wrongStepErr("welcome", from);

  const onboarding: Onboarding = structuredClone(current);
  let step: GuideStep | "done" = nextStep(at);
  let removeCamp = false;
  let finish: AdvancePlan["finish"];

  switch (at) {
    case "welcome":
      onboarding.guide.state = "active";
      onboarding.guide.startedAt = now;
      break;
    case "raid":
      if (!finishedOfType(save.buildingdata, GUIDE_BUILDINGS.sniper)) {
        throw notYetErr("Your Sniper Tower is not finished yet.");
      }
      onboarding.raidSeen ??= now;
      break;
    case "open-map":
      if (onboarding.camp.state !== "open") throw notYetErr("The practice camp is not open.");
      break;
    case "pick-camp":
      if (onboarding.camp.state !== "open") throw notYetErr("The practice camp is not open.");
      break;
    case "attack":
    case "attack-result":
      if (facts.campDestroyed) {
        step = "home-goals";
        removeCamp = true;
        onboarding.camp = { ...onboarding.camp, state: "removed", removedAt: now };
      } else {
        step = "attack-result";
      }
      break;
    case "protection":
      step = "done";
      finish = endGuide(onboarding, save, now, "done");
      break;
    default:
      break;
  }
  if (step !== "done") onboarding.guide.step = step;
  return { onboarding, step, removeCamp, ...(finish && { finish }) };
};

/** Ends the guide (`done` or `skipped`) on `onboarding`; returns what the save gets. */
const endGuide = (
  onboarding: Onboarding,
  save: { protected?: number | null },
  now: number,
  state: "done" | "skipped"
): { protected: number; tutorialstage: number } => {
  onboarding.guide = {
    state,
    ...(onboarding.guide.startedAt !== undefined && { startedAt: onboarding.guide.startedAt }),
    endedAt: now,
  };
  return {
    protected: Math.max(Number(save.protected) || 0, now + PROTECTION_SECONDS),
    tutorialstage: TUTORIAL_DONE_STAGE,
  };
};

/* ── The guided build (`/bm/yard/build` at a build step) ──────────────────── */

/**
 * Whether `/bm/yard/build` for `type` is the guide's build: the guide is
 * active at `build-<type>` on the main yard, and has not paid for it yet.
 */
export const isGuidedBuild = (save: BuildSave, onboarding: Onboarding, type: number): boolean =>
  onboarding.guide.state === "active" &&
  onboarding.guide.step !== undefined &&
  onboarding.guide.step === buildStepOf(type) &&
  yardKindOf(save) === "main" &&
  grantOf(onboarding, `fund:${type}`) === undefined;

/**
 * The guide pays for its building (§2.4): `BASE.Fund` before a tutorial build
 * (`client/scripts/TUTORIAL.as:396-400`), done without handing resources
 * over. The build's gates are the ordinary `planBuild`'s, measured against
 * the yard topped up to the cost; the debit is cut to `min(held, cost)` per
 * resource, and the difference is the grant, recorded as `fund:<type>` with
 * the new building's id. The step moves to `finish-<type>`.
 */
export const planGuidedBuild = (
  save: BuildSave,
  current: Onboarding,
  request: BuildRequest,
  now: number
) => {
  const step = buildStepOf(request.type);
  if (!guideOpen(current)) throw guideClosedErr();
  requireActive(current);
  if (!step || current.guide.step !== step) throw wrongStepErr(current.guide.step);
  const key = `fund:${request.type}`;
  if (grantOf(current, key)) throw alreadyGrantedErr(key);

  const row = costOf(request.type, yardKindOf(save));
  const cost = row?.costs[0] ? stepAmounts(row.costs[0]) : { r1: 0, r2: 0, r3: 0, r4: 0 };
  const held = heldOf(save.resources);
  const topped: ResourceAmounts = {
    r1: Math.max(held.r1, cost.r1),
    r2: Math.max(held.r2, cost.r2),
    r3: Math.max(held.r3, cost.r3),
    r4: Math.max(held.r4, cost.r4),
  };
  const plan = planBuild({ ...save, resources: { ...(save.resources ?? {}), ...topped } }, request, now);

  const debit: ResourceAmounts = {
    r1: Math.min(held.r1, cost.r1),
    r2: Math.min(held.r2, cost.r2),
    r3: Math.min(held.r3, cost.r3),
    r4: Math.min(held.r4, cost.r4),
  };
  const onboarding: Onboarding = structuredClone(current);
  onboarding.grants[key] = {
    r1: cost.r1 - debit.r1,
    r2: cost.r2 - debit.r2,
    r3: cost.r3 - debit.r3,
    r4: cost.r4 - debit.r4,
    id: plan.report.id,
    at: now,
  };
  onboarding.guide.step = finishStepOf(request.type)!;
  return { ...plan, debit, onboarding };
};

const heldOf = (resources: JsonObject | null | undefined): ResourceAmounts => {
  const one = (key: string): number => {
    const value = Number(resources?.[key]);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  };
  return { r1: one("r1"), r2: one("r2"), r3: one("r3"), r4: one("r4") };
};

/* ── guide/finish ────────────────────────────────────────────────────────── */

/** `report` of `guide/finish`. */
export interface GuideFinishReport {
  id: number;
  t: number;
  /** Whether the construction was finished now; false when it had already finished. */
  finished: boolean;
  points: number;
  step: GuideStep;
}

/**
 * `guide/finish {id}`: the free Finish now (§2.3 steps 4, 7, 10, 12). Only at
 * `finish-<type>`, only on the building recorded in `fund:<type>`, and only
 * its construction (`cB`): the catch-up's own completion, Shiny 0. For the
 * Map Room this is the one-off exception to D16 (Q3): it never goes through
 * `speedup`, which refuses a Map Room. A construction that ran out by itself
 * meanwhile is recorded and moves on without finishing anything.
 *
 * After the Flinger the step is `open-map` and the route opens the camp.
 */
export const planGuidedFinish = (
  save: { type?: string; buildingdata?: BuildingDataMap | null },
  current: Onboarding,
  id: number,
  now: number
) => {
  requireActive(current);
  const type = typeOfStep(current.guide.step);
  if (type === undefined || current.guide.step !== finishStepOf(type)) {
    throw wrongStepErr(current.guide.step);
  }
  const key = `finish:${type}`;
  if (grantOf(current, key)) throw alreadyGrantedErr(key);
  const fund = grantOf(current, `fund:${type}`);
  if (!fund || fund.id !== id) {
    throw yardRefusedErr("notGuideBuilding", "That is not the building Bob paid for.", { id });
  }
  const building = save.buildingdata?.[String(id)];
  if (!building || Number(building.t) !== type) {
    throw yardRefusedErr("notGuideBuilding", "That is not the building Bob paid for.", { id });
  }

  let next: BuildingData = building;
  let points = 0;
  const running = runningCountdown(building) === "cB";
  if (running) {
    const done = finishBuildingJob(building, "cB", now, yardKindOf(save));
    next = done.building;
    points = done.job.detail.points;
  }

  const onboarding: Onboarding = structuredClone(current);
  onboarding.grants[key] = { id, at: now };
  const step = nextStep(current.guide.step as GuideStep);
  onboarding.guide.step = step;
  const openCamp = type === GUIDE_BUILDINGS.flinger;
  if (openCamp) onboarding.camp = { state: "open", openedAt: now };

  const report: GuideFinishReport = { id, t: type, finished: running, points, step };
  return {
    report,
    buildingdata: running ? { ...save.buildingdata, [String(id)]: next } : undefined,
    points,
    onboarding,
    openCamp,
  };
};

/* ── guide/army ──────────────────────────────────────────────────────────── */

/** `report` of `guide/army`. */
export interface GuideArmyReport {
  /** Pokeys added to housing. */
  added: number;
  /** Housed Pokeys now. */
  housed: number;
  /** Whether this was the free retry (the camp's health was reset). */
  retry: boolean;
  step: GuideStep;
}

/**
 * `guide/army`: housed Pokeys topped up to {@link FREE_POKEYS}, never above
 * (rule 5). At `pokeys` it is Bob's gift and the step moves to
 * `build-maproom`; at `attack-result`, with the camp not destroyed, it is the
 * free retry (§5.6): the route resets the camp's health, and the step goes
 * back to `pick-camp`. Each call is one entry in `grants.army`.
 */
export const planGuideArmy = (
  save: { monsters?: JsonObject | null },
  current: Onboarding,
  now: number,
  facts: AdvanceFacts = {}
) => {
  requireActive(current);
  const at = current.guide.step;
  if (at === "pokeys") {
    if ((current.grants.army ?? []).length > 0) throw alreadyGrantedErr("army");
  } else if (at === "attack-result") {
    if (facts.campDestroyed) throw notYetErr("You already beat the practice camp.");
  } else {
    throw wrongStepErr(at);
  }

  const housed = readHoused(save.monsters);
  const have = housed[POKEY] ?? 0;
  const added = Math.max(0, FREE_POKEYS - have);
  const monsters: JsonObject = {
    ...(save.monsters ?? {}),
    housed: { ...housed, [POKEY]: have + added },
  };

  const onboarding: Onboarding = structuredClone(current);
  onboarding.grants.army = [...(onboarding.grants.army ?? []), { added, at: now }];
  const retry = at === "attack-result";
  const step: GuideStep = retry ? "pick-camp" : "build-maproom";
  onboarding.guide.step = step;

  const report: GuideArmyReport = { added, housed: have + added, retry, step };
  return { report, monsters, onboarding, retry };
};

/* ── guide/skip ──────────────────────────────────────────────────────────── */

/**
 * `guide/skip`: final (rule 6). The guide is `skipped`; anything granted stays,
 * nothing more is. Seven days of protection all the same (Q11), and the camp
 * goes if it was open.
 */
export const planGuideSkip = (
  save: { protected?: number | null },
  current: Onboarding,
  now: number
) => {
  if (!guideOpen(current)) throw guideClosedErr();
  const onboarding: Onboarding = structuredClone(current);
  const removeCamp = onboarding.camp.state === "open";
  if (removeCamp) onboarding.camp = { ...onboarding.camp, state: "removed", removedAt: now };
  const finish = endGuide(onboarding, save, now, "skipped");
  return { onboarding, removeCamp, finish };
};
