import type { HccPresetsWire } from "@/api/types";
import { hccLimits, HCC_MAX_STACKS, STACK_SIZE } from "./hatchPlan";

/**
 * The HCC's presets as the client reads them (beta 9; the rules are the
 * server's, `server/src/services/yard/hccPresets.ts`).
 *
 * Two lists live on the player's main save: `home`, the main yard's, and
 * `out`, one list every outpost shares. A preset is a numbered sequence of
 * `[monster, count]` stacks, sent in that order. The main yard offers 2, 4 or
 * 6 by its HCC's level and a preset holds what its queue holds (7 boxes of 20
 * at level 1, 10 of 20 at 2, 10 of 30 at 3); an outpost offers its own HCC's
 * count (6 when run from a level 3 main yard), each up to 10 boxes of 20.
 */

/** Which list a yard uses. */
export type PresetList = "home" | "out";

/** One list's presets by slot, as the save holds them (no validation beyond shape). */
export const presetListOf = (
  wire: HccPresetsWire | null | undefined,
  list: PresetList,
): [string, number][][] => {
  const raw: unknown = wire?.[list];
  if (!Array.isArray(raw)) return [];
  return raw.map((preset: unknown) =>
    Array.isArray(preset)
      ? preset
          .filter((stack): stack is [string, number] => Array.isArray(stack) && typeof stack[0] === "string")
          .map(([id, count]): [string, number] => [id, Math.max(0, Math.floor(Number(count)) || 0)])
          .filter(([, count]) => count > 0)
      : [],
  );
};

/** Boxes (queue stacks) a preset fills when each holds `size`. */
export const boxesOf = (preset: readonly (readonly [string, number])[], size: number): number =>
  preset.reduce((sum, [, count]) => sum + Math.ceil(count / size), 0);

/** What a list offers in a yard: its slots, and the boxes and box size of one preset. */
export interface PresetLimits {
  readonly slots: number;
  readonly boxes: number;
  readonly size: number;
}

/**
 * The limits where the tab is: `level` is the yard's own HCC; `homeLevel` the
 * main yard's when this outpost is run from home (0 otherwise).
 */
export const presetLimits = (list: PresetList, level: number, homeLevel = 0): PresetLimits => {
  if (list === "out") {
    return { slots: hccLimits(homeLevel >= 3 ? homeLevel : level).presets, boxes: HCC_MAX_STACKS, size: STACK_SIZE };
  }
  const limits = hccLimits(level);
  return { slots: limits.presets, boxes: limits.stacks, size: limits.size };
};
