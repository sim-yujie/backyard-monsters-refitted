import {
  SIEGE_MAX_LEVEL,
  chargedCost,
  siegeBuildCost,
  siegeData,
  siegeLevel,
  siegeUpgradeCost,
  type SiegeCost,
  type SiegeId,
  type SiegeWeaponData,
} from "../../game-rules/combat/siege.js";
import type { BuildingData, BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { levelOf } from "../yardplanner/costs.js";
import { damageOf } from "./repair.js";
import { resourcesPrice, timeCost } from "./shiny.js";
import { yardBadRequestErr, yardRefusedErr } from "./yardErrors.js";

/**
 * The Siege Lab and the Siege Factory (Inferno WP 6.3, `docs/design/inferno.md`
 * §2.9, S6): `POST /bm/yard/siege/{lab,factory}/{start,cancel,finish,instant}`.
 * Flash calls them the Chaos Lab and the Chaos Factory.
 *
 * The rules are Flash's `com/monsters/siege/` (`SiegeBuilding.as`,
 * `SiegeLab.as`, `SiegeFactory.as`, the popup's gates in
 * `SiegeBuildingPopup.as:151-560`, the prices in `SiegeWeapon.as`), with the
 * figures from the shared `game-rules/combat/siege.ts` (WP 6.2):
 *
 * - **The Lab researches** a weapon's next level, 1 to 10, one weapon at a
 *   time; level N needs a level N Lab (`_lvl - 1 < level` refuses,
 *   `SiegeBuildingPopup.as:491`). Done, the weapon's `level` goes up one
 *   (`SiegeLab.UpgradeWeapon`).
 * - **The Factory makes** one weapon of a researched type at its level. It
 *   makes or holds one weapon at a time across all three (`availableWeapon`,
 *   `:533-543`). Done, the weapon's `quantity` is 1 (`SiegeFactory.UpgradeWeapon`);
 *   an attack spends it (`siegeAfter`, `services/base/combat/abandonedAttack.ts`).
 * - **Both** are usable once built, not upgrading or fortifying (the
 *   building panel offers no Open button then, `BUILDINGINFO.as:113-128`), at
 *   half health or more (`SiegeLab.Show`, `SiegeFactory.Show`).
 *
 * **Costs are Inferno resources**, the main save's `iresources` purse, as
 * Flash charged and funded with its Inferno flag (`BASE.Charge` and `Fund`'s
 * last argument, `SiegeLab.as:74-77`). Start needs every resource in hand at
 * the unrounded cost (`numResourcesToUpgradeNeeded`) and takes it floored
 * (`BASE.Charge`, `BASE.as:4418`). Short, the player may buy the shortfall
 * with Shiny (`buyResourcesAndUpgrade`, `BRAU`/`BRAB`) when the purse can hold
 * the cost (`hasCapacityToUpgrade`: each `rNmax` at least the cost), else it
 * is refused (`msg_morepodsunlock`). A cancel funds the cost back floored and
 * up to `rNmax`, never lowering a purse already over it (`BASE.Fund`,
 * `:4483-4530`).
 *
 * One deliberate change: Flash's shortfall purchase funded
 * `upgradeCosts.rN - BASE._iresources.rN`, a number less a `SecNum` object,
 * which is NaN, and `Fund(NaN)` fills the resource to its cap. So it filled
 * all four resources to the cap and then charged the cost. Here it funds the
 * shortfall only, which is what it charged Shiny for.
 *
 * **Shiny**: finish a running job for `GetTimeCost(seconds left)`, free at
 * five minutes or less (`getInstantUpgradeCost`); do one at once for
 * `GetInstantBuyCost(cost)` = `GetTimeCost(time) + GetResourceCost(r1..r4)`,
 * no resources taken (`InstantUpgrade`, `IBSW`); buy a shortfall for
 * `GetResourceCost(the shortfall)` (no time in it, so no time term).
 *
 * **Storage** is Flash's: a weapon is `siege[id] = { level, quantity }`
 * (`SiegeWeapon.exportVariables`), and a running job is the building's
 * `unlockingWeapons = { [id]: end }`, unix seconds, the absolute form Flash's
 * `SiegeBuilding.Setup` reads first. Completion on the clock is the
 * catch-up's ({@link catchUpSiege}), which also pauses a job over a window its
 * building spends destroyed: Flash only ticks it `if (!_destroyed)`
 * (`SiegeBuilding.Tick`).
 *
 * Everything here is pure: it reads the caught-up save the yard action
 * wrapper hands it and returns what should change, or throws the refusal.
 * The plans charge and fund the purse themselves (the wrapper's pool is the
 * surface one); Shiny and its lock are the wrapper's.
 */

/** `SiegeFactory.ID`. */
export const SIEGE_FACTORY_TYPE = 133;

/** `SiegeLab.ID` (`b_siegeworks`). */
export const SIEGE_LAB_TYPE = 134;

/** Which of the two a route works on. */
export type SiegeSite = "lab" | "factory";

const TYPE_OF: Readonly<Record<SiegeSite, number>> = { lab: SIEGE_LAB_TYPE, factory: SIEGE_FACTORY_TYPE };

/** Flash's own names for them (`english.json`). */
const NAME_OF: Readonly<Record<SiegeSite, string>> = { lab: "Chaos Lab", factory: "Chaos Factory" };

export const PURSE_KEYS = ["r1", "r2", "r3", "r4"] as const;
type PurseKey = (typeof PURSE_KEYS)[number];

/** Inferno resources, r1..r4 (Bone, Coal, Sulfur, Magma). */
export type PurseAmounts = Record<PurseKey, number>;

/** The slice of a save the siege routes read. */
export interface SiegeSave {
  /** `BaseType`: the health ladder is the yard kind's. */
  type?: string;
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
  /** The weapons, `{ [id]: { level, quantity } }`. */
  siege?: JsonObject | null;
  /** The Inferno purse: `r1..r4` and `r1max..r4max`. */
  iresources?: JsonObject | null;
}

/* ── Weapons ──────────────────────────────────────────────────────────── */

/** One weapon's record. */
export interface SiegeStock {
  /** 0 (not researched) to 10. */
  level: number;
  /** Weapons made and not yet used: 0 or 1. */
  quantity: number;
}

/** A weapon's entry as an object, `{}` when absent or unreadable. */
const entryOf = (siege: JsonObject | null | undefined, id: string): JsonObject => {
  const entry = siege?.[id];
  return entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as JsonObject) : {};
};

/** A weapon's level and quantity as `SiegeWeapon.importVariables` reads them; 0 when absent. */
export const siegeStock = (siege: JsonObject | null | undefined, id: string): SiegeStock => {
  const entry = entryOf(siege, id);
  const quantity = Math.floor(Number(entry.quantity));
  return {
    level: siegeLevel(Number(entry.level)),
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 0,
  };
};

/** `siege` with weapon `id` at `stock`, its other fields kept. */
const withStock = (siege: JsonObject | null | undefined, id: string, stock: SiegeStock): JsonObject => ({
  ...(siege ?? {}),
  [id]: { ...entryOf(siege, id), level: stock.level, quantity: stock.quantity },
});

/** Every weapon's record, for the client: all three, level 0 included. */
export const siegeView = (siege: JsonObject | null | undefined): Record<SiegeId, SiegeStock> => ({
  decoy: siegeStock(siege, "decoy"),
  vacuum: siegeStock(siege, "vacuum"),
  jars: siegeStock(siege, "jars"),
});

/** A weapon a route may name, or `400 badRequest`. */
const weaponOrThrow = (weapon: string): SiegeWeaponData => {
  const data = siegeData(weapon);
  if (!data) throw yardBadRequestErr("That is not a siege weapon.", { weapon });
  return data;
};

/** What finishing a job does to the weapon: the Lab adds a level, the Factory makes one. */
const finished = (site: SiegeSite, stock: SiegeStock): SiegeStock =>
  site === "lab"
    ? { ...stock, level: Math.min(stock.level + 1, SIEGE_MAX_LEVEL) }
    : { ...stock, quantity: 1 };

/** The cost of the job a site would run, or is running, on a weapon now. */
const jobCost = (site: SiegeSite, weapon: SiegeWeaponData, stock: SiegeStock): SiegeCost | null =>
  site === "lab" ? siegeUpgradeCost(weapon, stock.level) : siegeBuildCost(weapon, stock.level);

/* ── The purse ────────────────────────────────────────────────────────── */

/** The purse's holdings, floored as Flash loads them (`BASE.as:906-909`); 0 when unreadable. */
export const purseOf = (iresources: JsonObject | null | undefined): PurseAmounts => {
  const held = (key: PurseKey): number => {
    const value = Math.floor(Number(iresources?.[key]));
    return Number.isFinite(value) && value > 0 ? value : 0;
  };
  return { r1: held("r1"), r2: held("r2"), r3: held("r3"), r4: held("r4") };
};

/** The purse's caps, `int(rNmax)` (`BASE.as:910-913`); 0 when unreadable. */
export const capsOf = (iresources: JsonObject | null | undefined): PurseAmounts => {
  const cap = (key: PurseKey): number => {
    const value = Math.trunc(Number(iresources?.[`${key}max`]));
    return Number.isFinite(value) && value > 0 ? value : 0;
  };
  return { r1: cap("r1"), r2: cap("r2"), r3: cap("r3"), r4: cap("r4") };
};

/** `iresources` with new holdings, its caps and anything else kept. */
export const withPurse = (iresources: JsonObject | null | undefined, purse: PurseAmounts): JsonObject => ({
  ...(iresources ?? {}),
  ...purse,
});

/**
 * What `BASE.Fund` with the Inferno flag adds to `held` for `amount`
 * (`BASE.as:4483-4530`): floored, up to the cap; nothing to a purse already
 * at or over it.
 */
export const funded = (held: number, cap: number, amount: number): number => {
  if (held >= cap) return held;
  return Math.min(held + Math.max(0, Math.floor(amount)), cap);
};

/* ── Buildings and jobs ───────────────────────────────────────────────── */

/** A job a Lab or Factory is running. */
export interface SiegeJob {
  weapon: SiegeId;
  /** When it ends, unix seconds. */
  endsAt: number;
}

/** A building's `unlockingWeapons` as an object, or null (Flash's `is Array` check, `SiegeBuilding.Setup`). */
const jobsOf = (building: BuildingData | null | undefined): JsonObject | null => {
  const jobs = building?.["unlockingWeapons"];
  return jobs && typeof jobs === "object" && !Array.isArray(jobs) ? (jobs as JsonObject) : null;
};

/** Every readable job on a building, in key order. */
const readJobs = (building: BuildingData | null | undefined): SiegeJob[] =>
  Object.entries(jobsOf(building) ?? {}).flatMap(([weapon, end]) => {
    const endsAt = Number(end);
    return siegeData(weapon) && Number.isFinite(endsAt) && endsAt > 0
      ? [{ weapon: weapon as SiegeId, endsAt }]
      : [];
  });

/** The job a building is running, or null: the first, as `upgradingWeapon` reads it. */
export const siegeJob = (building: BuildingData | null | undefined): SiegeJob | null =>
  readJobs(building)[0] ?? null;

/** The building with no job fields left. */
const withoutJobs = (building: BuildingData): BuildingData => {
  const { unlockingWeapons: _jobs, unlockingWeapons2: _legacy, ...rest } = building;
  return rest as BuildingData;
};

/** Whether a building entry carries any job field. */
const hasJobFields = (building: BuildingData): boolean =>
  building["unlockingWeapons"] !== undefined || building["unlockingWeapons2"] !== undefined;

/** One Lab or Factory in the yard. */
interface SiegeBuilding {
  key: string;
  id: number;
  building: BuildingData;
  /** Its level; 0 while it is still being built. */
  level: number;
}

/**
 * The yard's Lab or Factory: the one with a job when there is one, else the
 * first by id. Flash keeps one of each (`quantity` 1, `GLOBAL._bSiegeLab`).
 */
const siegeBuildingOf = (save: SiegeSave, site: SiegeSite): SiegeBuilding | null => {
  const found = Object.entries(save.buildingdata ?? {})
    .filter(([, building]) => Number(building?.t) === TYPE_OF[site])
    .map(([key, building]) => ({ key, id: Number(building.id ?? key), building, level: levelOf(building) }))
    .filter((entry) => Number.isFinite(entry.id))
    .sort((a, b) => a.id - b.id);
  return found.find((entry) => siegeJob(entry.building) !== null) ?? found[0] ?? null;
};

/**
 * The Lab or Factory, usable: `409 noSiegeLab` / `409 noSiegeFactory` none,
 * or one still being built (`msg_siegeworks_notbuilt`); `409 busy {id}`
 * upgrading or fortifying (`msg_sworks_upgrading`); `409 damaged {id}` under
 * half health (`msg_sworks_damaged`).
 */
const usableOrThrow = (save: SiegeSave, site: SiegeSite): SiegeBuilding => {
  const found = siegeBuildingOf(save, site);
  const name = NAME_OF[site];
  if (!found || found.level < 1 || Number(found.building.cB) > 0) {
    throw yardRefusedErr(
      site === "lab" ? "noSiegeLab" : "noSiegeFactory",
      `${name} not built yet. It can be built from the Buildings tab within the Buildings menu.`
    );
  }
  const { id, building } = found;
  if (Number(building.cU) > 0 || Number(building.cF) > 0) {
    throw yardRefusedErr("busy", `Your ${name} is upgrading. You can't use it until the upgrade is finished.`, {
      id,
    });
  }
  const damage = damageOf(save, found.key, building);
  if (damage && damage.health < damage.max * 0.5) {
    throw yardRefusedErr("damaged", `Your ${name} is damaged! You must repair it before it can be used.`, {
      id,
    });
  }
  return found;
};

/** What a start or an instant would do, once the gates have passed. */
interface SiegeGate {
  site: SiegeSite;
  found: SiegeBuilding;
  weapon: SiegeWeaponData;
  stock: SiegeStock;
  cost: SiegeCost;
}

/**
 * The Lab's checks for researching `weapon`, in the popup's order
 * (`UpdateShowCurrentWeaponLab`, `SiegeBuildingPopup.as:467-512`): `400
 * badRequest`; the Lab usable; `409 labBusy {weapon}` this weapon already
 * researching; `409 maxLevel {weapon, level}` at level 10; `409 labBusy
 * {weapon}` another weapon researching (`msg_oneweaponupgrade`); `409
 * labLevel {have, need}` the Lab below the level to be reached
 * (`msg_upgraderequiredlevel`).
 */
const labGate = (save: SiegeSave, id: string): SiegeGate => {
  const weapon = weaponOrThrow(id);
  const found = usableOrThrow(save, "lab");
  const stock = siegeStock(save.siege, weapon.id);
  const running = siegeJob(found.building);
  const busy = () =>
    yardRefusedErr("labBusy", "The Chaos Lab can only upgrade or unlock one weapon at a time.", {
      weapon: running!.weapon,
    });

  if (running?.weapon === weapon.id) throw busy();
  if (stock.level >= SIEGE_MAX_LEVEL) {
    throw yardRefusedErr("maxLevel", "That weapon is at its highest level.", {
      weapon: weapon.id,
      level: stock.level,
    });
  }
  if (running) throw busy();
  const need = stock.level + 1;
  if (found.level < need) {
    throw yardRefusedErr("labLevel", `Upgrade Requires: Chaos Lab Level ${need}`, { have: found.level, need });
  }
  return { site: "lab", found, weapon, stock, cost: siegeUpgradeCost(weapon, stock.level)! };
};

/**
 * The Factory's checks for making `weapon`, in the popup's order
 * (`UpdateShowCurrentWeaponFactory`, `SiegeBuildingPopup.as:514-551`): `400
 * badRequest`; the Factory usable; `409 locked {weapon}` not researched (the
 * Factory lists only weapons with a level, `:158-171`); `409 factoryBusy
 * {weapon}` this one being made; `409 holding {weapon}` this one already
 * made; `409 factoryBusy {weapon}` another being made; `409 holding {weapon}`
 * another made and not yet used (`msg_oneweapon`).
 */
const factoryGate = (save: SiegeSave, id: string): SiegeGate => {
  const weapon = weaponOrThrow(id);
  const found = usableOrThrow(save, "factory");
  const stock = siegeStock(save.siege, weapon.id);
  if (stock.level < 1) {
    throw yardRefusedErr("locked", "Research that weapon in the Chaos Lab first.", { weapon: weapon.id });
  }
  const running = siegeJob(found.building);
  const oneWeapon = "The Chaos Factory can only build or hold one weapon at a time.";
  if (running?.weapon === weapon.id) throw yardRefusedErr("factoryBusy", oneWeapon, { weapon: weapon.id });
  if (stock.quantity > 0) throw yardRefusedErr("holding", oneWeapon, { weapon: weapon.id });
  if (running) throw yardRefusedErr("factoryBusy", oneWeapon, { weapon: running.weapon });
  const held = (["decoy", "vacuum", "jars"] as const).find((other) => siegeStock(save.siege, other).quantity > 0);
  if (held) throw yardRefusedErr("holding", oneWeapon, { weapon: held });
  return { site: "factory", found, weapon, stock, cost: siegeBuildCost(weapon, stock.level)! };
};

const gateOf = (save: SiegeSave, site: SiegeSite, weapon: string): SiegeGate =>
  site === "lab" ? labGate(save, weapon) : factoryGate(save, weapon);

/** The running job, or `409 noSiege*` / `409 notBusy`. */
const runningOrThrow = (save: SiegeSave, site: SiegeSite): { found: SiegeBuilding; job: SiegeJob } => {
  const found = siegeBuildingOf(save, site);
  const job = siegeJob(found?.building);
  if (!found || !job) {
    throw yardRefusedErr(
      "notBusy",
      site === "lab" ? "The Chaos Lab is not researching." : "The Chaos Factory is not building a weapon."
    );
  }
  return { found, job };
};

/** `buildingdata` with one building replaced. */
const withBuilding = (save: SiegeSave, found: SiegeBuilding, building: BuildingData): BuildingDataMap => ({
  ...(save.buildingdata ?? {}),
  [found.key]: building,
});

/* ── Reports ──────────────────────────────────────────────────────────── */

/** What every siege route reports besides its own fields: the weapons and the purse after it. */
export interface SiegeStateReport {
  siege: Record<SiegeId, SiegeStock>;
  /** The Inferno purse's holdings and caps. */
  purse: PurseAmounts & { caps: PurseAmounts };
}

const stateReport = (siege: JsonObject | null | undefined, iresources: JsonObject | null | undefined) => ({
  siege: siegeView(siege),
  purse: { ...purseOf(iresources), caps: capsOf(iresources) },
});

/** `report` of `start`. */
export interface SiegeStartReport extends SiegeStateReport {
  site: SiegeSite;
  weapon: SiegeId;
  /** The Lab or Factory doing it. */
  building: number;
  /** When it ends, unix seconds. */
  endsAt: number;
  /** Inferno resources taken, floored. */
  cost: PurseAmounts;
  /** Shiny paid for the shortfall; 0 when nothing was short. */
  credits: number;
}

/** `report` of `cancel`. */
export interface SiegeCancelReport extends SiegeStateReport {
  site: SiegeSite;
  weapon: SiegeId;
  /** Inferno resources actually returned, after the cap. */
  refund: PurseAmounts;
}

/** `report` of `finish` and `instant`. */
export interface SiegeShinyReport extends SiegeStateReport {
  site: SiegeSite;
  weapon: SiegeId;
  /** Shiny charged. */
  credits: number;
}

/* ── Plans ────────────────────────────────────────────────────────────── */

/**
 * Starts researching (`lab`) or making (`factory`) `weapon`: the cost out of
 * the purse now and the building's `unlockingWeapons = { [weapon]: now + time }`
 * (`StartUpgradingWeapon`).
 *
 * With every resource in hand at the unrounded cost, that is all. Short, the
 * purse must be able to hold the cost (`409 capacity {need, caps}`,
 * `msg_morepodsunlock`), and `topUp` must name the Shiny the shortfall costs
 * (`409 shortfall {shortfall, topUp}` otherwise, as the Starter Kit asks it,
 * `starterKit.ts`); then the shortfall is bought and the cost taken, leaving
 * each short resource at 0.
 */
export const planSiegeStart = (
  save: SiegeSave,
  site: SiegeSite,
  id: string,
  now: number,
  topUp?: number
) => {
  const { found, weapon, cost } = gateOf(save, site, id);
  const held = purseOf(save.iresources);
  const caps = capsOf(save.iresources);
  const charged = chargedCost(cost);
  const short = PURSE_KEYS.map((key) => Math.max(cost[key] - held[key], 0));
  const missing = short.reduce((sum, amount) => sum + amount, 0);

  let credits = 0;
  if (missing > 0) {
    if (PURSE_KEYS.some((key) => caps[key] < cost[key])) {
      throw yardRefusedErr(
        "capacity",
        "You need to build more or upgrade your Resource Pods in your Inferno Yard to hold enough resources to unlock this.",
        { need: { r1: charged.r1, r2: charged.r2, r3: charged.r3, r4: charged.r4 }, caps }
      );
    }
    credits = resourcesPrice(missing);
    if (topUp !== credits) {
      const [r1, r2, r3, r4] = short.map((amount) => Math.ceil(amount));
      throw yardRefusedErr("shortfall", "You do not have enough Inferno resources for that.", {
        shortfall: { r1, r2, r3, r4 },
        topUp: credits,
      });
    }
  }

  const after: PurseAmounts = {
    r1: Math.max(held.r1 - charged.r1, 0),
    r2: Math.max(held.r2 - charged.r2, 0),
    r3: Math.max(held.r3 - charged.r3, 0),
    r4: Math.max(held.r4 - charged.r4, 0),
  };
  const endsAt = now + cost.time;
  const iresources = withPurse(save.iresources, after);
  const report: SiegeStartReport = {
    site,
    weapon: weapon.id,
    building: found.id,
    endsAt,
    cost: { r1: charged.r1, r2: charged.r2, r3: charged.r3, r4: charged.r4 },
    credits,
    ...stateReport(save.siege, iresources),
  };

  return {
    report,
    slices: {
      buildingdata: withBuilding(save, found, {
        ...withoutJobs(found.building),
        unlockingWeapons: { [weapon.id]: endsAt },
      }),
      iresources,
    },
    shiny: credits,
  };
};

/**
 * Cancels the running job: it goes, and the cost of the job at the weapon's
 * level now comes back into the purse, floored and up to each cap
 * (`CancelUpgradingWeapon`). Progress is lost; Shiny paid for a shortfall is
 * not returned.
 */
export const planSiegeCancel = (save: SiegeSave, site: SiegeSite) => {
  const { found, job } = runningOrThrow(save, site);
  const weapon = siegeData(job.weapon)!;
  const cost = jobCost(site, weapon, siegeStock(save.siege, job.weapon));
  const held = purseOf(save.iresources);
  const caps = capsOf(save.iresources);
  const after: PurseAmounts = {
    r1: funded(held.r1, caps.r1, cost?.r1 ?? 0),
    r2: funded(held.r2, caps.r2, cost?.r2 ?? 0),
    r3: funded(held.r3, caps.r3, cost?.r3 ?? 0),
    r4: funded(held.r4, caps.r4, cost?.r4 ?? 0),
  };
  const iresources = withPurse(save.iresources, after);
  const report: SiegeCancelReport = {
    site,
    weapon: job.weapon,
    refund: {
      r1: after.r1 - held.r1,
      r2: after.r2 - held.r2,
      r3: after.r3 - held.r3,
      r4: after.r4 - held.r4,
    },
    ...stateReport(save.siege, iresources),
  };

  return {
    report,
    slices: { buildingdata: withBuilding(save, found, withoutJobs(found.building)), iresources },
  };
};

/**
 * Finishes the running job now for `GetTimeCost(end − now)` Shiny, free at
 * five minutes or less (`InstantUpgrade` with the job running,
 * `getInstantUpgradeCost`).
 */
export const planSiegeFinish = (save: SiegeSave, site: SiegeSite, now: number) => {
  const { found, job } = runningOrThrow(save, site);
  const credits = timeCost(job.endsAt - now);
  const siege = withStock(save.siege, job.weapon, finished(site, siegeStock(save.siege, job.weapon)));
  const report: SiegeShinyReport = {
    site,
    weapon: job.weapon,
    credits,
    ...stateReport(siege, save.iresources),
  };

  return {
    report,
    slices: { siege, buildingdata: withBuilding(save, found, withoutJobs(found.building)) },
    shiny: credits,
  };
};

/**
 * Does the job at once for `GetInstantBuyCost(cost)` Shiny, the time term
 * free at five minutes or less, and no resources (`InstantUpgrade`, `IBSW`).
 * The popup offered it beside Start, so Start's checks apply bar the
 * resources; the building is not taken.
 */
export const planSiegeInstant = (save: SiegeSave, site: SiegeSite, id: string) => {
  const { weapon, stock, cost } = gateOf(save, site, id);
  const credits = timeCost(cost.time) + resourcesPrice(cost.r1 + cost.r2 + cost.r3 + cost.r4);
  const siege = withStock(save.siege, weapon.id, finished(site, stock));
  const report: SiegeShinyReport = {
    site,
    weapon: weapon.id,
    credits,
    ...stateReport(siege, save.iresources),
  };

  return { report, slices: { siege }, shiny: credits };
};

/* ── Goal rewards ─────────────────────────────────────────────────────── */

/**
 * Whether the Factory can take a goal's weapon (SW4-SW12): Flash's
 * `hasRoom`, a Factory built (`GLOBAL._bSiegeFactory`, set once it is
 * `Constructed`), making none (`upgradingWeapon`) and holding none
 * (`hasBuiltWeapon`) (`QUESTS.as:1772-1777`). Unlike the Factory's own
 * routes, an upgrade or damage does not stop it.
 */
export const siegeRewardRoom = (save: SiegeSave): boolean => {
  const found = siegeBuildingOf(save, "factory");
  if (!found || found.level < 1 || Number(found.building.cB) > 0) return false;
  if (siegeJob(found.building)) return false;
  return !(["decoy", "vacuum", "jars"] as const).some((id) => siegeStock(save.siege, id).quantity > 0);
};

/**
 * `siege` with one `weapon` made: the goal reward's
 * `CompleteUpgradingWeapon(id, false)`, which sets its `quantity` to 1 at the
 * level it has (`SiegeFactory.UpgradeWeapon`).
 */
export const withRewardWeapon = (siege: JsonObject | null | undefined, weapon: SiegeId): JsonObject =>
  withStock(siege, weapon, { ...siegeStock(siege, weapon), quantity: 1 });

/* ── Upgrade and recycle ──────────────────────────────────────────────── */

/** Why a Lab or Factory may not be upgraded or recycled now. */
export type SiegeHold = "unlocking" | "upgrading" | "building" | "holding";

/**
 * What stops a Lab or Factory being upgraded or recycled, or null: the Lab
 * while it researches (`SiegeLab.Upgrade`, `Recycle`: unlocking a level 0
 * weapon, else upgrading one), the Factory while it makes a weapon or holds
 * one (`SiegeFactory.Upgrade`, `Recycle`, `hasBuiltWeapon`).
 */
export const siegeHold = (
  building: BuildingData,
  siege: JsonObject | null | undefined
): { hold: SiegeHold; weapon: SiegeId } | null => {
  const type = Number(building.t);
  if (type !== SIEGE_LAB_TYPE && type !== SIEGE_FACTORY_TYPE) return null;
  const job = siegeJob(building);
  if (type === SIEGE_LAB_TYPE) {
    if (!job) return null;
    return { hold: siegeStock(siege, job.weapon).level > 0 ? "upgrading" : "unlocking", weapon: job.weapon };
  }
  if (job) return { hold: "building", weapon: job.weapon };
  const held = (["decoy", "vacuum", "jars"] as const).find((id) => siegeStock(siege, id).quantity > 0);
  return held ? { hold: "holding", weapon: held } : null;
};

/** Flash's words for an upgrade refused by {@link siegeHold} (`msg_sworks_cantupgrade1/2`). */
export const siegeUpgradeMessage = (hold: SiegeHold): string => {
  switch (hold) {
    case "unlocking":
      return "You cannot upgrade the Lab while a weapon is being unlocked.";
    case "upgrading":
      return "You cannot upgrade your Lab while you are upgrading a Chaos weapon.";
    case "building":
      // `msg_sfactory_cantupgrade1` has no text in Flash's `english.json`.
      return "You cannot upgrade the Chaos Factory while it is building a Chaos Weapon.";
    case "holding":
      return "You cannot upgrade the Chaos Factory while it has a Chaos Weapon. First deploy the weapon.";
  }
};

/** Flash's words for a recycle refused by {@link siegeHold} (`msg_sworks_cantrecycle1/2`, `msg_sfactory_cantrecycle1/2`). */
export const siegeRecycleMessage = (hold: SiegeHold): string => {
  switch (hold) {
    case "unlocking":
      return "You can not recycle this building as it's currently unlocking. First open it and cancel the unlock.";
    case "upgrading":
      return "You can not recycle this building as it's currently upgrading. First open it and cancel the upgrade.";
    case "building":
      return "You can not recycle this building as it's currently building a Chaos Weapon. First open it and cancel the weapon.";
    case "holding":
      return "You can not recycle this building as it currently has a Chaos Weapon. First deploy the weapon.";
  }
};

/* ── Catch-up ─────────────────────────────────────────────────────────── */

/** A siege job the catch-up finished. */
export interface SiegeCompletedJob {
  kind: "siege";
  /** The weapon. */
  id: SiegeId;
  /** The building's type: 134 researched it, 133 made it. */
  t: number;
  /** Unix seconds at which it ended. */
  at: number;
  detail: {
    /** The Lab or Factory. */
    building: number;
    /** The weapon's level and quantity now. */
    level: number;
    quantity: number;
  };
}

/**
 * Catch-up step for the Lab and the Factory: a job ends on its building's
 * `unlockingWeapons` end time, which the player may be away for.
 *
 * - **Paused while destroyed**: Flash ticks a job only `if (!_destroyed)`
 *   (`SiegeBuilding.Tick`), and a building loaded at 0 health is destroyed
 *   (`BFOUNDATION.as:3141-3144`) until a repair is started (`Repair`). So a
 *   job whose building starts the window at 0 health and not repairing has
 *   its end pushed back by the whole window. Runs before the repairs step,
 *   which heals the health it reads.
 * - **Legacy form**: Flash's own saves wrote `unlockingWeapons2`, seconds
 *   left (`SiegeBuilding.Export`); one with no `unlockingWeapons` is made
 *   absolute from the window's start, once.
 * - **Completion** once the end has passed: the Lab's weapon a level up, the
 *   Factory's made, the job gone, and a `completed` entry. Unreadable job
 *   fields are dropped.
 *
 * Pure apart from mutating the save it is handed. Idempotent at the same `now`.
 */
export const catchUpSiege = (save: SiegeSave, from: number, now: number): SiegeCompletedJob[] => {
  const jobs: SiegeCompletedJob[] = [];
  for (const [key, building] of Object.entries(save.buildingdata ?? {})) {
    const type = Number(building?.t);
    if ((type !== SIEGE_LAB_TYPE && type !== SIEGE_FACTORY_TYPE) || !hasJobFields(building)) continue;
    const site: SiegeSite = type === SIEGE_LAB_TYPE ? "lab" : "factory";

    let running = readJobs(building);
    if (!jobsOf(building)) {
      const legacy = building["unlockingWeapons2"];
      running =
        legacy && typeof legacy === "object" && !Array.isArray(legacy)
          ? Object.entries(legacy as JsonObject).flatMap(([weapon, left]) => {
              const seconds = Number(left);
              return siegeData(weapon) && Number.isFinite(seconds) ? [{ weapon: weapon as SiegeId, endsAt: from + seconds }] : [];
            })
          : [];
    }

    const damage = damageOf(save, key, building);
    const destroyed = damage !== null && damage.health <= 0 && !damage.repairing;
    const pause = destroyed ? Math.max(now - from, 0) : 0;
    const id = Number(building.id ?? key);
    const left: JsonObject = {};
    for (const job of running) {
      const endsAt = job.endsAt + pause;
      if (endsAt > now) {
        left[job.weapon] = endsAt;
        continue;
      }
      const stock = finished(site, siegeStock(save.siege, job.weapon));
      save.siege = withStock(save.siege, job.weapon, stock);
      jobs.push({ kind: "siege", id: job.weapon, t: type, at: endsAt, detail: { building: id, ...stock } });
    }

    const cleared = withoutJobs(building);
    save.buildingdata = {
      ...save.buildingdata,
      [key]: Object.keys(left).length > 0 ? { ...cleared, unlockingWeapons: left } : cleared,
    };
  }
  return jobs;
};
