import type { EntityManager } from "@mikro-orm/core";
import { infernoConfig } from "../../config/InfernoConfig.js";
import { Save } from "../../database/models/save.model.js";
import { BaseType } from "../../enums/Base.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { readInfernoProgress } from "../inferno/infernoProgress.js";
import { townHallLevel, yardKindOf, type ResourceAmounts } from "../yardplanner/costs.js";
import { capsOf, funded, PURSE_KEYS, purseOf, withPurse, type PurseAmounts } from "./siege.js";
import { yardRefusedErr } from "./yardErrors.js";

/**
 * The Inferno buildings of the main yard (Inferno WP 6.1, `docs/design/inferno.md`
 * §2.9): the Quake Tower (129), the Magma Tower (132), the Siege Factory (133)
 * and the Siege Lab (134), Flash's `BASE.isInfernoBuilding` on the main yard
 * less the two Spurtz Cannons, which this project leaves out
 * (`client/scripts/BASE.as:5461-5463`).
 *
 * Flash keeps them `block`ed in the main build menu until the cave reaches
 * level 5 (`INFERNOPORTAL.checkBuildingUnlocks`, `INFERNOPORTAL.as:249-256`),
 * and then `BASE.CanBuild` (`BASE.as:3696-3712`) holds them to the Inferno:
 *
 * - the Descent must be passed (`inferno_building_requirement`): `409 infernoLocked`;
 * - the hall that counts is the player's Inferno Under Hall
 *   (`StatGet(UNDERHALL_LEVEL)`), not the Town Hall: `quantity[]` is read at
 *   its level, and none at all means `base_builderr_noinfstate`: `409 underHall`;
 * - every step's `re` holds `[999, 1, 1]`, the Under Hall entry
 *   (`UNDER_HALL_REQUIREMENT`), met by that same level (`BASE.as:3762-3765`);
 *   the Factory's also holds the Siege Lab;
 * - they cost Inferno resources: `BASE.Charge`/`BASE.Fund` with the Inferno
 *   flag take from and give back to the main save's `iresources`
 *   (`BFOUNDATION.as:1693-1697`, `:2282-2293`, `:2417-2428`, `:2556-2567`),
 *   so build, upgrade, their cancels and recycling all go through the purse.
 *
 * Upgrades read the Under Hall entry too (`BASE.CanUpgrade`, `:3884-3890`).
 * Instant builds and upgrades price in Shiny from the same cost rows, as on
 * any building. The Under Hall level is the Inferno yard's own (its Under
 * Hall, as last saved), so unlike Flash's stat it needs no visit there first.
 */

/** The main yard's Inferno buildings. */
export const SURFACE_INFERNO_TYPES: ReadonlySet<number> = new Set([129, 132, 133, 134]);

/** What the gates read: the Descent and the player's Inferno Under Hall level. */
export interface InfernoStanding {
  readonly descentPassed: boolean;
  /** The Inferno yard's Under Hall level; 0 with no Inferno yard. */
  readonly underHall: number;
}

/** A player with no Inferno: nothing unlocks. */
export const NO_INFERNO_STANDING: InfernoStanding = { descentPassed: false, underHall: 0 };

/**
 * The parts of a save the Inferno gates read. `infernoStanding` is no column:
 * a route that may touch one of these buildings attaches it
 * ({@link withInfernoStanding}); without it every gate refuses.
 */
export interface SurfaceInfernoSave {
  type?: string;
  iresources?: JsonObject | null;
  infernoStanding?: InfernoStanding;
}

/** Whether a building of `type` on this yard is a main-yard Inferno building. */
export const isSurfaceInferno = (save: { type?: string | null }, type: number): boolean =>
  yardKindOf(save) === "main" && SURFACE_INFERNO_TYPES.has(type);

/** The Under Hall level of an Inferno yard's buildings; 0 without one. */
export const underHallLevelOf = (buildingdata: BuildingDataMap | null | undefined): number =>
  townHallLevel(buildingdata, "inferno");

/**
 * The player's standing: the Descent from `inferno_progress`, the Under Hall
 * from their Inferno yard's row. Nothing unlocks while the new Inferno is
 * switched off.
 */
export const readInfernoStanding = async (
  em: EntityManager,
  userid: number,
  main: { baseid_inferno?: number | null }
): Promise<InfernoStanding> => {
  if (!infernoConfig.enabled) return NO_INFERNO_STANDING;
  const progress = await readInfernoProgress(em, userid);
  return {
    descentPassed: progress.descentPassedAt !== null,
    underHall: await readUnderHall(em, userid, progress, main),
  };
};

/**
 * The Under Hall level of the player's Inferno yard, as last saved; 0 with
 * none. The load answer's `infernostate.underHall` reads it too, so the build
 * menu counts by the same hall.
 */
export const readUnderHall = async (
  em: EntityManager,
  userid: number,
  progress: { infernoBaseid: string | null },
  main: { baseid_inferno?: number | null }
): Promise<number> => {
  const baseid = progress.infernoBaseid ?? (Number(main.baseid_inferno) > 0 ? String(main.baseid_inferno) : null);
  if (!baseid) return 0;
  const yard = await em.findOne(Save, { baseid, type: BaseType.INFERNO, userid });
  return yard ? underHallLevelOf(yard.buildingdata) : 0;
};

/**
 * `save` with the player's standing attached when building or upgrading a
 * `type` that needs it; `save` itself otherwise, so ordinary routes read
 * nothing more.
 */
export const withInfernoStanding = async <S extends { type?: string; baseid_inferno?: number | null }>(
  em: EntityManager,
  userid: number,
  save: S,
  type: number
): Promise<S & { infernoStanding?: InfernoStanding }> =>
  isSurfaceInferno(save, type) ? { ...save, infernoStanding: await readInfernoStanding(em, userid, save) } : save;

/* ── The gates ────────────────────────────────────────────────────────── */

/** `inferno_building_requirement` (`english.json`). */
const LOCKED_MESSAGE = "You must capture an Inferno base before you can construct Inferno buildings in your Main Yard.";

/**
 * Builds' first gate for these types (`BASE.as:3697-3711`): the Descent, then
 * an Under Hall at all. Returns the Under Hall level, the hall the rest of the
 * gates count by.
 */
export const surfaceInfernoHall = (save: SurfaceInfernoSave): number => {
  const standing = save.infernoStanding ?? NO_INFERNO_STANDING;
  if (!standing.descentPassed) throw yardRefusedErr("infernoLocked", LOCKED_MESSAGE);
  if (standing.underHall <= 0) {
    throw yardRefusedErr("underHall", "Under Hall Level 1 required.", { underHall: { have: 0, need: 1 } });
  }
  return standing.underHall;
};

/** The Under Hall level the `re` check reads; 0 without a standing. */
export const standingUnderHall = (save: SurfaceInfernoSave): number => save.infernoStanding?.underHall ?? 0;

/** `409 underHall`: an Under Hall entry or count the player's Under Hall does not reach. */
export const underHallErr = (gate: { have: number; need: number }) =>
  yardRefusedErr("underHall", `Under Hall Level ${gate.need} required.`, { underHall: gate });

/* ── The purse ────────────────────────────────────────────────────────── */

/** The purse in a report: holdings and caps, as the siege routes report it. */
export const purseReport = (iresources: JsonObject | null | undefined): PurseAmounts & { caps: PurseAmounts } => ({
  ...purseOf(iresources),
  caps: capsOf(iresources),
});

/** What the purse lacks for `cost`, per resource. */
export const purseShortfall = (iresources: JsonObject | null | undefined, cost: ResourceAmounts): ResourceAmounts => {
  const held = purseOf(iresources);
  return {
    r1: Math.max(cost.r1 - held.r1, 0),
    r2: Math.max(cost.r2 - held.r2, 0),
    r3: Math.max(cost.r3 - held.r3, 0),
    r4: Math.max(cost.r4 - held.r4, 0),
  };
};

/**
 * `409 shortfall` for an Inferno price: the shortfall in Bone, Coal, Sulfur
 * and Magma, with `purse: "inferno"` so the client names them.
 */
export const purseShortfallErr = (shortfall: ResourceAmounts) =>
  yardRefusedErr("shortfall", "You do not have enough Inferno resources for that.", {
    shortfall,
    purse: "inferno",
  });

/** `iresources` less `cost`, or `409 shortfall` when it holds less. */
export const chargePurse = (iresources: JsonObject | null | undefined, cost: ResourceAmounts): JsonObject => {
  const short = purseShortfall(iresources, cost);
  if (PURSE_KEYS.some((key) => short[key] > 0)) throw purseShortfallErr(short);
  const held = purseOf(iresources);
  return withPurse(iresources, {
    r1: held.r1 - cost.r1,
    r2: held.r2 - cost.r2,
    r3: held.r3 - cost.r3,
    r4: held.r4 - cost.r4,
  });
};

/**
 * `iresources` with `amounts` given back up to the caps (`BASE.Fund` with the
 * Inferno flag, `funded`), and what that let through.
 */
export const fundPurse = (
  iresources: JsonObject | null | undefined,
  amounts: Partial<ResourceAmounts>
): { iresources: JsonObject; credited: ResourceAmounts } => {
  const held = purseOf(iresources);
  const caps = capsOf(iresources);
  const after: PurseAmounts = {
    r1: funded(held.r1, caps.r1, amounts.r1 ?? 0),
    r2: funded(held.r2, caps.r2, amounts.r2 ?? 0),
    r3: funded(held.r3, caps.r3, amounts.r3 ?? 0),
    r4: funded(held.r4, caps.r4, amounts.r4 ?? 0),
  };
  return {
    iresources: withPurse(iresources, after),
    credited: {
      r1: after.r1 - held.r1,
      r2: after.r2 - held.r2,
      r3: after.r3 - held.r3,
      r4: after.r4 - held.r4,
    },
  };
};
