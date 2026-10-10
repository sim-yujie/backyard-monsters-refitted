import type { AcademyData } from "@/api/types";
import { timeCost } from "@/game/yard/buildingCosts";
import { JobKind, LAB_TYPE } from "@/game/yard/jobs";
import { NEED_MORE_SILOS_PHRASE, overCap } from "@/game/yard/storage";
import type { Yard, YardBuilding } from "@/game/yard/yardModel";
import { academyLevel } from "./housing";
import {
  LAB_ABILITIES,
  labAbility,
  labStep,
  monsterEntry,
  type LabAbility,
  type MonsterEntry,
  type PaidStep,
} from "./monsterCatalogue";
import type { TrainingContext } from "./training";

/**
 * What the Lab tab shows, as data (`docs/design/yard-buildings.md` §6 "Lab
 * tab"; `docs/specs/monsters-and-hatchery.md` §4.2).
 *
 * The tab draws; this decides. The Lab's state, the ten monsters with an
 * ability with their rank and next rank, what the ability does now and next,
 * the one reason Start (or Instant) cannot be pressed, and every price come
 * from here, checked in the order the server checks them (`researchGate`,
 * `server/src/services/yard/lab.ts`): no Lab, the Lab being built, upgraded
 * or damaged, the Lab already researching, the monster not unlocked, fully
 * researched, the Lab's level (rank N needs Lab level N), the monster's level
 * (rank N needs the monster at level N + 1), then putty. The first that fails
 * is the one shown.
 *
 * Prices are the server's formulas, recomputed here for the label only: the
 * route charges its own figure (`server/src/services/yard/shiny.ts`).
 */

/** The top rank of every ability (`client/scripts/MONSTERLAB.as:77-188`). */
export const MAX_RANK = 3;

/** What the tab reads: the Train tab's context (the store's read side). */
export type LabContext = TrainingContext;

/** A research running now. */
export interface RunningResearch {
  readonly ability: LabAbility;
  readonly monster: MonsterEntry;
  /** The rank it reaches. */
  readonly rank: number;
  /** Unix seconds, server clock. */
  readonly endsAt: number;
  /** The research's whole length in seconds: the rank's table time. */
  readonly duration: number;
  readonly labId: number;
}

/** What the Lab is doing, or why it cannot take a research. */
export type LabState =
  | { readonly kind: "idle" }
  | { readonly kind: "researching"; readonly research: RunningResearch }
  /** Being built, upgraded or fortified: the original has no Open button then. */
  | { readonly kind: "busy" }
  | { readonly kind: "damaged" };

/** The yard's Monster Lab. */
export interface LabSlot {
  readonly id: number;
  /** Its level; 0 while it is still being built. */
  readonly level: number;
  readonly state: LabState;
}

/** One ability's row. */
export interface LabRow {
  readonly ability: LabAbility;
  readonly monster: MonsterEntry;
  /** Its rank now, 0..3. */
  readonly rank: number;
  /** What the next rank costs, `[putty, seconds]`; null at rank 3. */
  readonly step: PaidStep | null;
  /** The research running on it, if any. */
  readonly research: RunningResearch | null;
}

/** Why Start or Instant cannot be pressed, under the server's refusal keys. */
export type LabGate =
  | { readonly reason: "noLab" }
  | { readonly reason: "busy" }
  | { readonly reason: "damaged" }
  | { readonly reason: "labBusy" }
  | { readonly reason: "locked" }
  | { readonly reason: "maxRank" }
  | { readonly reason: "labLevel"; readonly have: number; readonly need: number }
  | {
      readonly reason: "monsterLevel";
      readonly monster: string;
      readonly have: number;
      readonly need: number;
    }
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
const puttyOf = (context: LabContext): number => {
  const value = Number(context.resources.r3);
  return Number.isFinite(value) ? Math.floor(value) : 0;
};

/** A monster's Lab rank, 0..3; 0 when absent. */
export const powerupRank = (academy: AcademyData | null | undefined, id: string): number => {
  const rank = Math.floor(Number(academy?.[id]?.powerup));
  return Number.isFinite(rank) && rank > 0 ? Math.min(rank, MAX_RANK) : 0;
};

/**
 * The research a Lab building holds, read as the server reads it (`labResearch`,
 * `server/src/services/yard/lab.ts`): `upg` a monster with an ability, `upt`
 * a finish time, `upl` a rank 1..3. Anything less is stale and ignored.
 */
export const researchOn = (building: YardBuilding): RunningResearch | null => {
  const id = building.raw["upg"];
  const endsAt = finite(building.raw["upt"]);
  const rank = finite(building.raw["upl"]);
  const ability = typeof id === "string" ? labAbility(id) : undefined;
  const monster = typeof id === "string" ? monsterEntry(id) : undefined;
  if (!ability || !monster || endsAt === null || endsAt <= 0) return null;
  if (rank === null || !Number.isInteger(rank) || rank < 1 || rank > MAX_RANK) return null;
  return {
    ability,
    monster,
    rank,
    endsAt,
    duration: ability.costs[rank - 1]?.[1] ?? 0,
    labId: building.id,
  };
};

/** The yard's Lab: the one researching when there is one, else the first by id (the server's `labOf`). */
export const labBuilding = (yard: Yard): YardBuilding | null => {
  const labs = yard.buildings.filter((building) => building.type === LAB_TYPE).sort((a, b) => a.id - b.id);
  return labs.find((lab) => researchOn(lab) !== null) ?? labs[0] ?? null;
};

/**
 * The running research, or null. Its end is the store's `research` job when
 * there is one, else the Lab's `upt`: both read the same absolute time.
 */
export const runningResearch = (context: LabContext): RunningResearch | null => {
  const lab = labBuilding(context.yard);
  const research = lab ? researchOn(lab) : null;
  if (!research) return null;
  const job = context.jobs().find((one) => one.kind === JobKind.RESEARCH && one.id === research.monster.id);
  return job?.endsAt != null ? { ...research, endsAt: job.endsAt } : research;
};

/**
 * Whether the save counts a building as damaged: a health reading, the repair
 * flag or a `buildinghealthdata` entry (the server's `isDamaged`).
 */
const damaged = (building: YardBuilding, context: LabContext): boolean =>
  building.hp !== null ||
  building.raw.rE === 1 ||
  (context.save.buildinghealthdata != null && String(building.id) in context.save.buildinghealthdata);

/**
 * The Lab and its state, or null when the yard has none. A research shows
 * even while the Lab is damaged: it keeps running (`MONSTERLAB.Tick`, `:198-206`).
 */
export const labSlot = (context: LabContext): LabSlot | null => {
  const lab = labBuilding(context.yard);
  if (!lab) return null;
  const research = runningResearch(context);
  const state: LabState = research
    ? { kind: "researching", research }
    : lab.level < 1 || lab.countdown !== null
      ? { kind: "busy" }
      : damaged(lab, context)
        ? { kind: "damaged" }
        : { kind: "idle" };
  return { id: lab.id, level: lab.level, state };
};

/** Whether `lockerdata` says `id` is unlocked (`t: 2`). */
const unlocked = (context: LabContext, id: string): boolean =>
  Number(context.save.lockerdata?.[id]?.t) === 2;

/** The ten monsters with an ability, in the Lab's list order (`MONSTERLABPOPUP.as:452`). */
export const labRows = (context: LabContext): LabRow[] => {
  const research = runningResearch(context);
  return [...LAB_ABILITIES]
    .sort((a, b) => a.order - b.order)
    .flatMap((ability) => {
      const monster = monsterEntry(ability.id);
      if (!monster) return [];
      const rank = powerupRank(context.save.academy, ability.id);
      return [
        {
          ability,
          monster,
          rank,
          step: rank < MAX_RANK ? (labStep(ability.id, rank + 1) ?? null) : null,
          research: research?.monster.id === ability.id ? research : null,
        },
      ];
    });
};

/**
 * The gates that belong to the monster itself, in the server's order: not
 * unlocked, fully researched, the Lab's level, the monster's level. The row
 * shows this one; the Lab's own state is shown once, at the top.
 */
export const monsterGate = (ability: LabAbility, context: LabContext): LabGate | null => {
  if (!unlocked(context, ability.id)) return { reason: "locked" };
  const rank = powerupRank(context.save.academy, ability.id);
  if (rank >= MAX_RANK) return { reason: "maxRank" };
  const next = rank + 1;
  const labLevel = labSlot(context)?.level ?? 0;
  if (next > labLevel) return { reason: "labLevel", have: labLevel, need: next };
  const level = academyLevel(context.save.academy, ability.id);
  if (level < next + 1) return { reason: "monsterLevel", monster: ability.id, have: level, need: next + 1 };
  return null;
};

/** The gates Start and Instant share, in the server's order, or null. */
const commonGate = (ability: LabAbility, context: LabContext): LabGate | null => {
  const slot = labSlot(context);
  if (!slot) return { reason: "noLab" };
  switch (slot.state.kind) {
    case "busy":
      return { reason: "busy" };
    case "damaged":
      return { reason: "damaged" };
    case "researching":
      return { reason: "labBusy" };
    case "idle":
      return monsterGate(ability, context);
  }
};

/** Why Start cannot be pressed for `ability`, or null. Putty comes last, as on the server. */
export const researchGate = (ability: LabAbility, context: LabContext): LabGate | null => {
  const common = commonGate(ability, context);
  if (common) return common;
  const price = labStep(ability.id, powerupRank(context.save.academy, ability.id) + 1)?.[0] ?? 0;
  const missing = price - puttyOf(context);
  if (missing <= 0) return null;
  return overCap(price, context.caps?.r3)
    ? { reason: "shortfall", need: missing, overCap: true }
    : { reason: "shortfall", need: missing };
};

/**
 * Instant's Shiny price for a rank: `timeCost(seconds)` with no free minutes
 * plus `ceil(sqrt(putty / 2)^0.75)`, no putty charged
 * (`MONSTERLAB.GetShinyCost`, `client/scripts/MONSTERLAB.as:69-73`;
 * `instantResearchPrice`, `server/src/services/yard/shiny.ts`).
 */
export const instantPrice = (step: PaidStep): number =>
  timeCost(step[1], false) + Math.ceil(Math.sqrt(step[0] / 2) ** 0.75);

/** Why Instant cannot be pressed: Start's gates without putty, then Shiny. */
export const instantGate = (ability: LabAbility, context: LabContext): LabGate | null => {
  const common = commonGate(ability, context);
  if (common) return common;
  const step = labStep(ability.id, powerupRank(context.save.academy, ability.id) + 1);
  const price = step ? instantPrice(step) : 0;
  return context.credits < price ? { reason: "credits", need: price - context.credits } : null;
};

/**
 * Finish now on the research: `timeCost(upt − now)`, free at five minutes or
 * less (the generic `SP4` on the Lab, `MONSTERLABPOPUP.as:429-432`). The price
 * only falls as the research runs, so the server never charges more than the
 * button says.
 */
export const finishPrice = (research: RunningResearch, now: number): number =>
  timeCost(Math.max(0, research.endsAt - now));

/**
 * What Cancel gives back: the rank's full putty price, less what the storage
 * cap turns away, as the server clamps it (T3).
 */
export const cancelRefund = (
  research: RunningResearch,
  context: LabContext,
): { readonly refund: number; readonly lost: number } => {
  const price = labStep(research.monster.id, research.rank)?.[0] ?? 0;
  const have = puttyOf(context);
  const cap = context.caps?.r3;
  const refund =
    typeof cap === "number" ? Math.max(have, Math.min(have + price, cap)) - have : price;
  return { refund, lost: price - refund };
};

/** A gate as its reason line: "Needs Lab level 2", "Needs Octo-ooze at level 3". */
export const gateText = (gate: LabGate): string => {
  switch (gate.reason) {
    case "noLab":
      return "Build a Monster Lab";
    case "busy":
      return "The Lab is being built or upgraded";
    case "damaged":
      return "Repair the Lab first";
    case "labBusy":
      return "The Lab is already researching";
    case "locked":
      return "Unlock it in the Monster Locker first";
    case "maxRank":
      return "Fully researched";
    case "labLevel":
      return `Needs Lab level ${gate.need}`;
    case "monsterLevel":
      return `Needs ${monsterEntry(gate.monster)?.name ?? gate.monster} at level ${gate.need}`;
    case "shortfall":
      return gate.overCap
        ? NEED_MORE_SILOS_PHRASE
        : `Need ${gate.need.toLocaleString("en-US")} more putty`;
    case "credits":
      return "Not enough Shiny";
  }
};

/* ── What an ability does ─────────────────────────────────────────────────── */

const percent = (value: number): string => `${Math.round(value * 100)}%`;
const times = (value: number): string => `${value}×`;

/**
 * Each ability's effect in plain words: what it is called and how one rank's
 * value reads. The values are `MONSTERLAB._powerupProps[id].effect`
 * (`client/scripts/MONSTERLAB.as:77-188`); how the original printed each is
 * `MONSTERLABPOPUP.as:215-250` (Eye-ra as a percentage, Bandito as a speed,
 * Fang, Project X and Wormzer as multiples of the monster's damage).
 */
const EFFECTS: Readonly<Record<string, { readonly label: string; readonly value: (v: number) => string }>> = {
  C3: { label: "Blink range", value: String },
  C4: { label: "Extra targets", value: String },
  C7: { label: "Whirlwind speed", value: times },
  C8: { label: "Venom", value: (v) => `${percent(v)} of its damage` },
  C5: { label: "Airburst bonus", value: percent },
  C9: { label: "Invisibility", value: (v) => `${v} s cloak delay` },
  C11: { label: "Acid on death", value: (v) => `${times(v)} its damage` },
  C13: { label: "Pop-up splash", value: (v) => `${times(v)} its damage` },
  C14: { label: "Fireball bounces", value: String },
  C12: { label: "Rocket range", value: String },
};

/** What one rank of an ability gives, "Blink range 300"; rank 0 is "none". */
export const effectAt = (ability: LabAbility, rank: number): string => {
  const effect = EFFECTS[ability.id] ?? { label: ability.effectLabel, value: String };
  const value = ability.effect[rank - 1];
  return rank < 1 || value === undefined ? "none" : effect.value(value);
};

/**
 * The effect now and next in plain words: "Blink range: none → 150",
 * "Blink range: 150 → 300", or "Blink range: 450 (top rank)" at rank 3.
 */
export const effectLine = (ability: LabAbility, rank: number): string => {
  const label = EFFECTS[ability.id]?.label ?? ability.effectLabel;
  const now = effectAt(ability, rank);
  return rank >= MAX_RANK
    ? `${label}: ${now} (top rank)`
    : `${label}: ${now} → ${effectAt(ability, rank + 1)}`;
};
