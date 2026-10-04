import type { BaseLoadResponse, BuildingData, Layout } from "@/api/types";
import { readYard, type Yard } from "../yardModel";
import { computeCoverage, coverageTowers } from "./coverage";
import { Plan } from "./plan";
import { isDecoration, type PlanNode, type PlotBounds } from "./placement";
import { planTotals } from "./upgrades";

/**
 * Comparing the plan on screen with a saved layout (issue #9, design
 * `docs/design/yard-planner-redesign.md` §3 F12).
 *
 * Pure: it builds the saved layout as a yard of its own, for the second view,
 * and the two sides' statistics and differences, for the panel and the
 * highlights. Nothing here is written anywhere; compare is read-only.
 *
 * Decisions of 2026-09-29 (#9): the plan on screen, unsaved edits included,
 * against one saved slot; two views side by side with pan and zoom kept in
 * step; a slot's levels are read as Load reads them, the yard's current
 * levels plus the slot's plans; "moved" is the same building id at another
 * spot, and a building on one side only is highlighted there; a better figure
 * is green with a ▲.
 */

/**
 * The save as the slot arranges it: every building the slot names at the
 * slot's spot, at the level the yard has it now (the slot's own `l` is
 * advisory, as Load treats it); one the yard no longer has, from the slot's
 * record of it. A building the slot does not name is left out.
 */
export const slotSave = (save: BaseLoadResponse, layout: Layout): BaseLoadResponse => {
  const current = save.buildingdata ?? {};
  const buildingdata: Record<string, BuildingData> = {};
  for (const node of layout.nodes) {
    const building = current[String(node.id)];
    buildingdata[String(node.id)] = building
      ? { ...building, X: node.x, Y: node.y }
      : ({ id: node.id, t: node.t, X: node.x, Y: node.y, ...(node.l && node.l > 1 ? { l: node.l } : {}) } as BuildingData);
  }
  return { ...save, buildingdata };
};

/**
 * The slot as a plan: its yard, with the slot's planned upgrades set wherever
 * this yard can still do them (the rule Load applies, `Plan.setPlan`).
 */
export const slotPlan = (yard: Yard, layout: Layout): Plan => {
  const plan = Plan.fromYard(yard);
  for (const node of layout.nodes) {
    if (node.plan) plan.setPlan(node.id, node.plan.level);
  }
  return plan;
};

/** Both sides of a comparison, ready to draw. */
export interface SlotView {
  readonly yard: Yard;
  readonly plan: Plan;
}

export const slotView = (save: BaseLoadResponse, layout: Layout): SlotView => {
  const yard = readYard(slotSave(save, layout));
  return { yard, plan: slotPlan(yard, layout) };
};

/** One side's figures. */
export interface SideStats {
  /** Coverage shares, 0 to 1 (#55). */
  readonly land: number;
  readonly air: number;
  readonly landDeadZones: number;
  readonly airDeadZones: number;
  /** Every building's level added up, a planned level counting as reached. */
  readonly levels: number;
  /** Every resource the planned upgrades cost, added up. */
  readonly cost: number;
  /** Worker seconds of the planned upgrades. */
  readonly seconds: number;
  /** Buildings with no spot: the drawer's, or the ones the slot does not name. */
  readonly unplaced: number;
}

/** The figures for one arrangement of the yard's buildings. */
export const sideStats = (
  nodes: readonly PlanNode[],
  yard: Yard,
  plot: PlotBounds,
  unplaced: number,
): SideStats => {
  const placed = nodes.filter((node) => !node.fixed && !node.stored);
  const coverage = computeCoverage(coverageTowers(placed, yard.kind, yard.cellHeight), plot);
  const totals = planTotals(placed, yard);
  let levels = 0;
  for (const node of placed) levels += node.plan?.level ?? node.level;
  return {
    land: coverage.land.share,
    air: coverage.air.share,
    landDeadZones: coverage.land.deadZones.length,
    airDeadZones: coverage.air.deadZones.length,
    levels,
    cost: totals.needed.r1 + totals.needed.r2 + totals.needed.r3 + totals.needed.r4,
    seconds: totals.seconds,
    unplaced,
  };
};

/**
 * The yard's buildings a slot gives no spot: what Load would leave where it
 * stands and what a slot-only Apply is blocked on. Decorations and mushrooms
 * do not count, as neither blocks Apply.
 */
export const slotUnplaced = (yard: Yard, layout: Layout): number => {
  const named = new Set(layout.nodes.map((node) => node.id));
  let count = 0;
  for (const building of yard.buildings) {
    if (!named.has(building.id) && !isDecoration(building.type)) count++;
  }
  return count;
};

/** What differs between the plan and the slot, by building id. */
export interface LayoutDiff {
  /** On both sides, at different spots. */
  readonly moved: ReadonlySet<number>;
  /** Placed in the plan, not named by the slot. */
  readonly onlyPlan: ReadonlySet<number>;
  /** Named by the slot, not placed in the plan (in the drawer, or gone from the yard). */
  readonly onlySlot: ReadonlySet<number>;
}

export const diffLayouts = (planNodes: readonly PlanNode[], layout: Layout): LayoutDiff => {
  const placed = new Map<number, PlanNode>();
  for (const node of planNodes) if (!node.fixed && !node.stored) placed.set(node.id, node);
  const moved = new Set<number>();
  const onlySlot = new Set<number>();
  const named = new Set<number>();
  for (const node of layout.nodes) {
    named.add(node.id);
    const mine = placed.get(node.id);
    if (!mine) onlySlot.add(node.id);
    else if (mine.x !== node.x || mine.y !== node.y) moved.add(node.id);
  }
  const onlyPlan = new Set<number>();
  for (const id of placed.keys()) if (!named.has(id)) onlyPlan.add(id);
  return { moved, onlyPlan, onlySlot };
};

/** Which side a row favours, or neither. */
export type Better = "plan" | "slot" | null;

/** One row of the comparison table. */
export interface StatRow {
  readonly key: string;
  readonly label: string;
  readonly plan: number;
  readonly slot: number;
  readonly better: Better;
}

/**
 * Whether a bigger figure is the better one, per row. The coverage rows are
 * compared as the whole percentages the table prints, so "87%" against "87%"
 * is never shown as a win.
 */
const ROWS: readonly (readonly [key: keyof SideStats, label: string, higherIsBetter: boolean])[] = [
  ["land", "Land coverage", true],
  ["air", "Air coverage", true],
  ["landDeadZones", "Land dead zones", false],
  ["airDeadZones", "Air dead zones", false],
  ["levels", "Building levels", true],
  ["cost", "Planned upgrades cost", false],
  ["seconds", "Planned upgrades time", false],
  ["unplaced", "Unplaced buildings", false],
];

/** The table: a row per figure and the side it favours; a tie favours neither. */
export const statRows = (plan: SideStats, slot: SideStats): StatRow[] =>
  ROWS.map(([key, label, higher]) => {
    const a = plan[key];
    const b = slot[key];
    const shown = (value: number): number => (key === "land" || key === "air" ? Math.floor(value * 100) : value);
    const better: Better = shown(a) === shown(b) ? null : shown(a) > shown(b) === higher ? "plan" : "slot";
    return { key, label, plan: a, slot: b, better };
  });
