import type { BaseLoadResponse, ResourceCaps, Resources } from "@/api/types";
import { purseOf } from "@/game/siege/siege";
import type { YardKind } from "./buildingCosts";

/**
 * The main yard's Inferno buildings (Inferno WP 6.1, `docs/design/inferno.md`
 * §2.9): the Quake Tower (129), the Magma Tower (132), the Siege Factory (133)
 * and the Siege Lab (134). The server's `services/yard/surfaceInferno.ts`
 * holds the same rules; this is what the build menu and the building panel
 * read of them.
 *
 * - They are not in the menu at all until the cave is at level 5 (Flash
 *   `block`s them until then, `INFERNOPORTAL.checkBuildingUnlocks`,
 *   `client/scripts/INFERNOPORTAL.as:249-256`).
 * - The Descent must be passed (`409 infernoLocked`).
 * - The hall that counts is the Inferno yard's Under Hall, which the load's
 *   `infernostate.underHall` carries; every step's `re` holds the Under Hall
 *   entry ({@link UNDER_HALL_REQUIREMENT}), met by that level.
 * - They are paid from, and refunded to, the Inferno purse (`iresources`),
 *   in Bone, Coal, Sulfur and Magma.
 */
export const SURFACE_INFERNO_TYPES: ReadonlySet<number> = new Set([129, 132, 133, 134]);

/** Flash's `INFERNOQUAKETOWER.UNDERHALL_ID`: a `re` entry the Under Hall's level meets. */
export const UNDER_HALL_REQUIREMENT = 999;

/** Whether a `type` on a yard of `kind` is one of the main yard's Inferno buildings. */
export const isSurfaceInferno = (type: number, kind: YardKind): boolean =>
  kind === "main" && SURFACE_INFERNO_TYPES.has(type);

/** What the menu and panel read of the player's way into the Inferno. */
export interface SurfaceInfernoStanding {
  /** The cave is at its last level: the buildings show in the menu. */
  readonly unlocked: boolean;
  readonly descentPassed: boolean;
  /** The Inferno yard's Under Hall level; 0 with none. */
  readonly underHall: number;
}

/** The standing the main yard's load carries; nothing unlocked without an `infernostate`. */
export const surfaceInfernoStanding = (save: Pick<BaseLoadResponse, "infernostate">): SurfaceInfernoStanding => {
  const state = save.infernostate;
  const underHall = Math.floor(Number(state?.underHall));
  return {
    unlocked: state !== undefined && state.cave.level >= state.cave.maxLevel,
    descentPassed: state?.descent.passed === true,
    underHall: Number.isFinite(underHall) && underHall > 0 ? underHall : 0,
  };
};

/** The Inferno purse as the gates read it: held amounts and caps. */
export const purseFunds = (save: Pick<BaseLoadResponse, "iresources">): { resources: Resources; caps: ResourceCaps } => {
  const { held, caps } = purseOf(save.iresources);
  return { resources: { ...held }, caps: { ...caps } };
};

/** `inferno_building_requirement` (`english.json`): the Descent not yet passed. */
export const INFERNO_LOCKED_MESSAGE =
  "You must capture an Inferno base before you can construct Inferno buildings in your Main Yard.";
