import type {
  AcademyData,
  BuildingHealthData,
  LockerData,
  ResourceCaps,
  Resources,
} from "@/api/types";
import { timeCost } from "@/game/yard/buildingCosts";
import { JobKind, trainingEndsAt as absoluteEnd, type YardJob } from "@/game/yard/jobs";
import { NEED_MORE_SILOS_PHRASE, overCap } from "@/game/yard/storage";
import type { Yard, YardBuilding } from "@/game/yard/yardModel";
import { academyLevel } from "./housing";
import {
  LISTED_MONSTERS,
  maxTrainingLevel,
  monsterEntry,
  trainingStep,
  type MonsterEntry,
  type PaidStep,
} from "./monsterCatalogue";

/**
 * What the Train tab shows, as data (`docs/design/yard-buildings.md` §6
 * "Train tab"; `docs/specs/monsters-and-hatchery.md` §4.1).
 *
 * The tab draws; this decides. The academies as slots, every unlocked
 * monster's level and next step, the one reason Train (or Instant) cannot be
 * pressed, and every price come from here, checked in the order the server
 * checks them (`trainGate`, `server/src/services/yard/academy.ts`): no
 * finished academy, the monster already training, not unlocked, fully
 * trained, no idle academy, the academy's level, then putty. The first that
 * fails is the one shown.
 *
 * Train sends no academy: the server takes the lowest-level idle academy that
 * can train the monster, the lower building id on a tie (issue #180), and
 * {@link academyFor} predicts which one that will be so the card can say so.
 *
 * Prices are the server's formulas, recomputed here for the label only: the
 * route charges its own figure (`server/src/services/yard/shiny.ts`).
 */

/** Monster Academy type id (`client/scripts/ACADEMY.as:8`). */
export const ACADEMY_TYPE = 26;

/** What the tab reads: the store's read side, or anything shaped like it. */
export interface TrainingContext {
  readonly yard: Yard;
  readonly save: {
    readonly academy?: AcademyData | null;
    readonly lockerdata?: LockerData | null;
    readonly buildinghealthdata?: BuildingHealthData | null;
    readonly savetime?: number;
    readonly currenttime?: number;
  };
  readonly resources: Resources;
  readonly credits: number;
  readonly caps: ResourceCaps | null;
  now(): number;
  jobs(): readonly YardJob[];
}

/** A training running now. */
export interface RunningTraining {
  readonly monster: MonsterEntry;
  /** The level it reaches. */
  readonly to: number;
  /** Unix seconds, server clock. */
  readonly endsAt: number;
  /** The whole training's length in seconds, when the save says. */
  readonly duration: number | null;
  /** The academy doing it: the one whose `upg` names it, or null. */
  readonly academyId: number | null;
}

/** Why an academy cannot take a training, or what it is doing. */
export type SlotState =
  | { readonly kind: "idle" }
  | { readonly kind: "training"; readonly training: RunningTraining }
  /** Being built, upgraded or fortified: the original has no Open button then. */
  | { readonly kind: "busy" }
  | { readonly kind: "damaged" };

/** One academy as a slot at the top of the tab. */
export interface AcademySlot {
  readonly id: number;
  /** 1-based, in building id order: "Academy 1". */
  readonly number: number;
  /** Its level; 0 while it is still being built. */
  readonly level: number;
  readonly state: SlotState;
}

/** One unlocked monster's row. */
export interface TrainRow {
  readonly monster: MonsterEntry;
  /** Its academy level now, 1..6. */
  readonly level: number;
  /** The top of its ladder: 5 for Zafreeti (C15), 6 for the rest. */
  readonly max: number;
  /** What the next level costs, `[putty, seconds]`; null at the top. */
  readonly step: PaidStep | null;
  /** The training running on it, if any. */
  readonly training: RunningTraining | null;
}

/** Why Train or Instant cannot be pressed, under the server's refusal keys. */
export type TrainGate =
  | { readonly reason: "noAcademy" }
  | { readonly reason: "training" }
  | { readonly reason: "locked" }
  | { readonly reason: "maxLevel" }
  | { readonly reason: "academyBusy" }
  | { readonly reason: "academyLevel"; readonly have: number; readonly need: number }
  | {
      readonly reason: "shortfall";
      readonly need: number;
      /** The price is above the putty cap: more silos, not more waiting (§5.2). */
      readonly overCap?: true;
    }
  | { readonly reason: "credits"; readonly need: number };

const finite = (raw: unknown): number | null => {
  const value = Number(raw);
  return raw != null && Number.isFinite(value) ? value : null;
};

/** Putty held, whole. */
const puttyOf = (resources: Resources): number => {
  const value = Number(resources.r3);
  return Number.isFinite(value) ? Math.floor(value) : 0;
};

/** The yard's academies in building id order: the order the server tries them in. */
export const academiesOf = (yard: Yard): YardBuilding[] =>
  yard.buildings.filter((building) => building.type === ACADEMY_TYPE).sort((a, b) => a.id - b.id);

/**
 * Whether the save counts a building as damaged: a health reading, the repair
 * flag or a `buildinghealthdata` entry (the server's `isDamaged`,
 * `server/src/services/yard/buildingJobs.ts`).
 */
const damaged = (building: YardBuilding, context: TrainingContext): boolean =>
  building.hp !== null ||
  building.raw.rE === 1 ||
  (context.save.buildinghealthdata != null &&
    String(building.id) in context.save.buildinghealthdata);

/**
 * `monster`'s running training, or null. Its end is the store's `train` job
 * when there is one (so a legacy relative time is read as the server reads
 * it), else the stored `time`.
 */
export const runningTraining = (context: TrainingContext, id: string): RunningTraining | null => {
  const entry = context.save.academy?.[id];
  const time = finite(entry?.time);
  const monster = monsterEntry(id);
  if (time === null || time <= 0 || !monster) return null;
  const job = context.jobs().find((one) => one.kind === JobKind.TRAIN && one.id === id);
  const savedAt = context.save.savetime ?? context.save.currenttime ?? context.now();
  const academy = academiesOf(context.yard).find((building) => building.raw["upg"] === id);
  return {
    monster,
    to: academyLevel(context.save.academy, id) + 1,
    endsAt: job?.endsAt ?? absoluteEnd(time, savedAt),
    duration: finite(entry?.duration),
    academyId: academy?.id ?? null,
  };
};

/** Every training running now, soonest first. */
export const runningTrainings = (context: TrainingContext): RunningTraining[] =>
  Object.keys(context.save.academy ?? {})
    .map((id) => runningTraining(context, id))
    .filter((training): training is RunningTraining => training !== null)
    .sort((a, b) => a.endsAt - b.endsAt || a.monster.id.localeCompare(b.monster.id));

/**
 * One academy's state. A training shows on its academy even while that
 * academy is being upgraded or repaired; an `upg` naming a monster that is not
 * training reads as idle (`client/scripts/BUILDING26.as:26-31`).
 */
const slotState = (building: YardBuilding, context: TrainingContext): SlotState => {
  const upg = building.raw["upg"];
  const training = typeof upg === "string" && upg ? runningTraining(context, upg) : null;
  if (training) return { kind: "training", training };
  if (building.level < 1 || building.countdown !== null) return { kind: "busy" };
  if (damaged(building, context)) return { kind: "damaged" };
  return { kind: "idle" };
};

/** The academies as slots, in building id order. */
export const academySlots = (context: TrainingContext): AcademySlot[] =>
  academiesOf(context.yard).map((building, index) => ({
    id: building.id,
    number: index + 1,
    level: building.level,
    state: slotState(building, context),
  }));

/** Trainings no academy names (an old save): shown on their own so they can still be finished. */
export const orphanTrainings = (context: TrainingContext): RunningTraining[] =>
  runningTrainings(context).filter((training) => training.academyId === null);

/** Whether `lockerdata` says `id` is unlocked (`t: 2`). */
const unlocked = (context: TrainingContext, id: string): boolean =>
  Number(context.save.lockerdata?.[id]?.t) === 2;

/** Every unlocked monster in list order, each with its level and next step. */
export const trainRows = (context: TrainingContext): TrainRow[] =>
  LISTED_MONSTERS.filter((monster) => unlocked(context, monster.id)).map((monster) => {
    const level = academyLevel(context.save.academy, monster.id);
    const max = maxTrainingLevel(monster.id);
    return {
      monster,
      level,
      max,
      step: level < max ? (trainingStep(monster.id, level) ?? null) : null,
      training: runningTraining(context, monster.id),
    };
  });

/**
 * The academy the server will train `level` → `level + 1` at: of the idle
 * ones whose level is at least `level` (`ACADEMY.as:66`), the lowest, the
 * lower building id on a tie, so a high academy stays free for a monster only
 * it can train (issue #180; `trainGate`, `server/src/services/yard/academy.ts`).
 * Null when none.
 */
export const academyFor = (context: TrainingContext, level: number): AcademySlot | null =>
  academySlots(context)
    .filter((slot) => slot.state.kind === "idle" && slot.level >= level)
    .reduce<AcademySlot | null>((low, slot) => (low && low.level <= slot.level ? low : slot), null);

/** The gates Train and Instant share, in the server's order, or null. */
const commonGate = (monster: MonsterEntry, context: TrainingContext): TrainGate | null => {
  const slots = academySlots(context);
  if (!slots.some((slot) => slot.level >= 1)) return { reason: "noAcademy" };
  if (runningTraining(context, monster.id)) return { reason: "training" };
  if (!unlocked(context, monster.id)) return { reason: "locked" };
  const level = academyLevel(context.save.academy, monster.id);
  if (level >= maxTrainingLevel(monster.id) || !trainingStep(monster.id, level)) {
    return { reason: "maxLevel" };
  }
  const idle = slots.filter((slot) => slot.state.kind === "idle");
  if (idle.length === 0) return { reason: "academyBusy" };
  if (!idle.some((slot) => slot.level >= level)) {
    return { reason: "academyLevel", have: Math.max(...idle.map((slot) => slot.level)), need: level };
  }
  return null;
};

/** Why Train cannot be pressed for `monster`, or null. Putty comes last, as on the server. */
export const trainGate = (monster: MonsterEntry, context: TrainingContext): TrainGate | null => {
  const common = commonGate(monster, context);
  if (common) return common;
  const price = trainingStep(monster.id, academyLevel(context.save.academy, monster.id))?.[0] ?? 0;
  const missing = price - puttyOf(context.resources);
  if (missing <= 0) return null;
  return overCap(price, context.caps?.r3)
    ? { reason: "shortfall", need: missing, overCap: true }
    : { reason: "shortfall", need: missing };
};

/**
 * Instant's Shiny price for a step: `timeCost(seconds) + ceil(sqrt(putty / 2)^0.75)`,
 * no putty charged (`client/scripts/ACADEMYPOPUP.as:129-137`;
 * `instantTrainPrice`, `server/src/services/yard/shiny.ts`).
 */
export const instantPrice = (step: PaidStep): number =>
  timeCost(step[1]) + Math.ceil(Math.sqrt(step[0] / 2) ** 0.75);

/** Why Instant cannot be pressed: Train's gates without putty, then Shiny. */
export const instantGate = (monster: MonsterEntry, context: TrainingContext): TrainGate | null => {
  const common = commonGate(monster, context);
  if (common) return common;
  const step = trainingStep(monster.id, academyLevel(context.save.academy, monster.id));
  const price = step ? instantPrice(step) : 0;
  return context.credits < price ? { reason: "credits", need: price - context.credits } : null;
};

/**
 * Finish now on a training: `timeCost(time − now)`, free at five minutes or
 * less (the generic `SP4`, `client/scripts/ACADEMYPOPUP.as:435-438`). The price
 * only falls as the training runs, so the server never charges more than the
 * button says.
 */
export const finishPrice = (training: RunningTraining, now: number): number =>
  timeCost(Math.max(0, training.endsAt - now));

/**
 * What Cancel gives back: the step's full putty price, less what the storage
 * cap turns away, as the server clamps it (T3). A pool already over its cap
 * takes nothing and loses nothing.
 */
export const cancelRefund = (
  training: RunningTraining,
  context: TrainingContext,
): { readonly refund: number; readonly lost: number } => {
  const price = trainingStep(training.monster.id, training.to - 1)?.[0] ?? 0;
  const have = puttyOf(context.resources);
  const cap = context.caps?.r3;
  const refund =
    typeof cap === "number" ? Math.max(have, Math.min(have + price, cap)) - have : price;
  return { refund, lost: price - refund };
};

/** A gate as its reason line: "Needs Monster Academy level 3". */
export const gateText = (gate: TrainGate): string => {
  switch (gate.reason) {
    case "noAcademy":
      return "Build a Monster Academy";
    case "training":
      return "Already training";
    case "locked":
      return "Unlock it in the Monster Locker first";
    case "maxLevel":
      return "Fully trained";
    case "academyBusy":
      return "Every academy is busy";
    case "academyLevel":
      return `Needs Monster Academy level ${gate.need}`;
    case "shortfall":
      return gate.overCap
        ? NEED_MORE_SILOS_PHRASE
        : `Need ${gate.need.toLocaleString("en-US")} more putty`;
    case "credits":
      return "Not enough Shiny";
  }
};
