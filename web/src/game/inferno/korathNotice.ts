import type { BaseLoadResponse } from "@/api/types";
import {
  activeChampion,
  buildingOfType,
  cageEgg,
  CHAMPION_CAGE_TYPE,
  CHAMPION_CHAMBER_TYPE,
  entryOfChampion,
} from "@/game/yard/championModel";

/**
 * "Korath unlocked" (Inferno WP 5.2, `docs/design/inferno.md` §2.9, owner
 * I10): shown once, on the main yard's next load after the player captures
 * their Inferno yard (`infernostate.korathNotice`), then reported with
 * `POST /bm/inferno/korath/seen`.
 *
 * Flash had no Inferno unlock for Korath; he came from the Monster Madness
 * event, whose "found Korath" popup picked one of four lines by the cage
 * (`MonsterMadnessPopupInfoGoal1Complete.getCopy`): no cage, a champion in it
 * with or without a Champion Chamber, or a free cage
 * (`mm_goal1_completed1`..`4`). The same four steps here, cut short (the
 * owner wants little text), plus the egg and the cage still being built,
 * which Flash did not have.
 */

/** What the player does next to raise Korath, and where the button goes. */
export type KorathStep =
  /** `mm_goal1_completed1`: no cage. */
  | { readonly kind: "buildCage" }
  | { readonly kind: "cageBuilding" }
  /** `mm_goal1_completed3`: the cage is free. */
  | { readonly kind: "openCage"; readonly cage: number }
  | { readonly kind: "egg"; readonly cage: number }
  /** `mm_goal1_completed4`: a champion in the cage, and a Chamber to freeze it in. */
  | { readonly kind: "openChamber"; readonly chamber: number; readonly champion: string }
  /** `mm_goal1_completed2`: a champion in the cage and no Chamber. */
  | { readonly kind: "buildChamber"; readonly champion: string };

/** The step for this yard. */
export const korathStep = (save: BaseLoadResponse): KorathStep => {
  const cage = buildingOfType(save, CHAMPION_CAGE_TYPE);
  if (!cage) return { kind: "buildCage" };
  if (cage.building) return { kind: "cageBuilding" };
  const active = activeChampion(save);
  if (active) {
    const champion = active.nm?.trim() || entryOfChampion(active)?.name || "Your champion";
    const chamber = buildingOfType(save, CHAMPION_CHAMBER_TYPE);
    return chamber ? { kind: "openChamber", chamber: chamber.id, champion } : { kind: "buildChamber", champion };
  }
  if (cageEgg(save)) return { kind: "egg", cage: cage.id };
  return { kind: "openCage", cage: cage.id };
};

/** The popup's title. */
export const KORATH_UNLOCKED_TITLE = "Korath unlocked";

/** `fp_wotcreward1`'s first line: Flash's word when Korath became the player's. */
export const KORATH_UNLOCKED_LINE = "Korath is now one of your own!";

/** The step's line and button. */
export const korathStepText = (step: KorathStep): { readonly line: string; readonly button: string } => {
  switch (step.kind) {
    case "buildCage":
      return { line: "Build a Champion Cage to raise him.", button: "Build Cage" };
    case "cageBuilding":
      return { line: "Raise him once your Champion Cage is built.", button: "OK" };
    case "openCage":
      // `btn_opencage`.
      return { line: "Open your Champion Cage to raise him.", button: "Open Cage" };
    case "egg":
      return { line: "Your cage holds an egg. Cancel it to raise him.", button: "Open Cage" };
    case "openChamber":
      return { line: `${step.champion} is in your cage. Freeze it in the Champion Chamber first.`, button: "Open Chamber" };
    case "buildChamber":
      return { line: `${step.champion} is in your cage. Build a Champion Chamber to freeze it first.`, button: "Build Chamber" };
  }
};
