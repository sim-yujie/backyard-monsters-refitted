import type {
  BaseLoadResponse,
  CompletedJob,
  InfernoResourcesData,
  SiegeData,
} from "@/api/types";
import {
  SIEGE_MAX_LEVEL,
  SIEGE_WEAPON_DATA,
  siegeBuildCost,
  siegeData,
  siegeLevel,
  siegeUpgradeCost,
  siegeValue,
  type SiegeCost,
  type SiegeId,
  type SiegeStat,
  type SiegeWeaponData,
} from "@/game/combat/rules/siege";
import { timeCost } from "@/game/yard/buildingCosts";
import { JobKind, SIEGE_FACTORY_TYPE, SIEGE_LAB_TYPE, type YardJob } from "@/game/yard/jobs";
import type { Yard, YardBuilding } from "@/game/yard/yardModel";

/**
 * What the Siege screen shows, as data (Inferno WP 6.4): Flash's Chaos Lab and
 * Chaos Factory popup (`client/scripts/com/monsters/siege/SiegeBuildingPopup.as`).
 *
 * The screen draws; this decides. The notice shown instead of the lists, the
 * rows of each tab, what the selected weapon's right side offers and every
 * price come from here, in the popup's order, which is also the server's
 * (`server/src/services/yard/siege.ts`, WP 6.3): the Lab's one weapon at a
 * time, then level N needing a level N Lab; the Factory's one weapon made or
 * held at a time. Prices are the server's formulas, recomputed for the labels
 * only: the routes charge their own figures.
 *
 * The purse is the Inferno one (`iresources`), not the yard's: Bone, Coal,
 * Sulfur and Magma.
 */

export type SiegeSite = "lab" | "factory";

/** The building each tab belongs to. */
export const SITE_TYPE: Readonly<Record<SiegeSite, number>> = {
  lab: SIEGE_LAB_TYPE,
  factory: SIEGE_FACTORY_TYPE,
};

/** Flash's names for them (`btn_siegelab`, `btn_siegefactory`). */
export const SITE_NAME: Readonly<Record<SiegeSite, string>> = {
  lab: "Chaos Lab",
  factory: "Chaos Factory",
};

/** The tab a building opens, or null for any other building. */
export const siteOfType = (type: number): SiegeSite | null =>
  type === SIEGE_LAB_TYPE ? "lab" : type === SIEGE_FACTORY_TYPE ? "factory" : null;

/** What the screen reads: the yard store's read side. */
export interface SiegeContext {
  readonly yard: Yard;
  readonly save: {
    readonly siege?: SiegeData | null;
    readonly iresources?: InfernoResourcesData | null;
  };
  readonly credits: number;
  now(): number;
  jobs(): readonly YardJob[];
}

/* ── Weapons and the purse ──────────────────────────────────────────────── */

export interface SiegeStock {
  /** 0 (not researched) to 10. */
  readonly level: number;
  /** Made and not yet used: 0 or 1. */
  readonly quantity: number;
}

/** A weapon's level and quantity as the server's `siegeStock` reads them; 0 when absent. */
export const stockOf = (siege: SiegeData | null | undefined, id: string): SiegeStock => {
  const entry = siege?.[id];
  const quantity = Math.floor(Number(entry?.quantity));
  return {
    level: siegeLevel(Number(entry?.level)),
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 0,
  };
};

export const PURSE_KEYS = ["r1", "r2", "r3", "r4"] as const;
export type PurseKey = (typeof PURSE_KEYS)[number];
export type PurseAmounts = Readonly<Record<PurseKey, number>>;

export interface Purse {
  readonly held: PurseAmounts;
  readonly caps: PurseAmounts;
}

const whole = (raw: unknown): number => {
  const value = Math.floor(Number(raw));
  return Number.isFinite(value) && value > 0 ? value : 0;
};

/** The Inferno purse, floored as Flash loads it (`BASE.as:906-913`); 0 when unreadable. */
export const purseOf = (iresources: InfernoResourcesData | null | undefined): Purse => ({
  held: {
    r1: whole(iresources?.r1),
    r2: whole(iresources?.r2),
    r3: whole(iresources?.r3),
    r4: whole(iresources?.r4),
  },
  caps: {
    r1: whole(iresources?.r1max),
    r2: whole(iresources?.r2max),
    r3: whole(iresources?.r3max),
    r4: whole(iresources?.r4max),
  },
});

/* ── Buildings and jobs ─────────────────────────────────────────────────── */

/** A job a Lab or Factory is running. */
export interface SiegeJob {
  readonly site: SiegeSite;
  readonly weapon: SiegeWeaponData;
  /** Unix seconds, server clock. */
  readonly endsAt: number;
  /** The job's whole length in seconds: the cost's time at the weapon's level. */
  readonly duration: number;
  readonly buildingId: number;
}

/** A building's job as the server's `siegeJob` reads it: the first readable `unlockingWeapons` entry. */
const jobOn = (building: YardBuilding): { weapon: SiegeWeaponData; endsAt: number } | null => {
  const jobs = building.raw["unlockingWeapons"];
  if (!jobs || typeof jobs !== "object" || Array.isArray(jobs)) return null;
  for (const [id, end] of Object.entries(jobs as Record<string, unknown>)) {
    const weapon = siegeData(id);
    const endsAt = Number(end);
    if (weapon && Number.isFinite(endsAt) && endsAt > 0) return { weapon, endsAt };
  }
  return null;
};

/** The yard's Lab or Factory: the one with a job when there is one, else the first by id (the server's `siegeBuildingOf`). */
export const siegeBuilding = (yard: Yard, site: SiegeSite): YardBuilding | null => {
  const found = yard.buildings.filter((one) => one.type === SITE_TYPE[site]).sort((a, b) => a.id - b.id);
  return found.find((one) => jobOn(one) !== null) ?? found[0] ?? null;
};

/** The cost of the job a site runs on a weapon at `level`: the next level's research, or one weapon. */
export const jobCost = (site: SiegeSite, weapon: SiegeWeaponData, level: number): SiegeCost | null =>
  site === "lab" ? siegeUpgradeCost(weapon, level) : siegeBuildCost(weapon, level);

/**
 * The job running at a site, or null. Its end is the store's `siege` job when
 * there is one (the same absolute time, kept by the store's clock).
 */
export const runningJob = (context: SiegeContext, site: SiegeSite): SiegeJob | null => {
  const building = siegeBuilding(context.yard, site);
  const job = building ? jobOn(building) : null;
  if (!building || !job) return null;
  const level = stockOf(context.save.siege, job.weapon.id).level;
  const stored = context.jobs().find((one) => one.kind === JobKind.SIEGE && one.buildingId === building.id);
  return {
    site,
    weapon: job.weapon,
    endsAt: stored?.endsAt ?? job.endsAt,
    duration: jobCost(site, job.weapon, level)?.time ?? 0,
    buildingId: building.id,
  };
};

/* ── What the tab shows instead of its lists ────────────────────────────── */

export type SiteNotice = "notBuilt" | "upgrading" | "damaged" | "noWeapon";

/**
 * Why a tab shows a notice instead of its lists, in the popup's order
 * (`SiegeBuildingPopup.as:179-206`): not built (or still being built),
 * upgrading or fortifying, under half health, and on the Factory no weapon
 * researched yet. The server refuses every start for the first three.
 */
export const siteNotice = (context: SiegeContext, site: SiegeSite): SiteNotice | null => {
  const building = siegeBuilding(context.yard, site);
  if (!building || building.level < 1 || Number(building.raw.cB) > 0) return "notBuilt";
  if (Number(building.raw.cU) > 0 || Number(building.raw.cF) > 0) return "upgrading";
  if (building.hp !== null && building.maxHp !== null && building.hp < building.maxHp * 0.5) return "damaged";
  if (site === "factory" && !SIEGE_WEAPON_DATA.some((weapon) => stockOf(context.save.siege, weapon.id).level > 0)) {
    return "noWeapon";
  }
  return null;
};

/** The notices' words, Flash's (`english.json`). */
export const noticeText = (site: SiegeSite, notice: SiteNotice): string => {
  const name = SITE_NAME[site];
  switch (notice) {
    case "notBuilt":
      return `${name} not built yet. It can be built from the Buildings tab within the Buildings menu.`;
    case "upgrading":
      return `Your ${name} is upgrading. You can't use it until the upgrade is finished.`;
    case "damaged":
      return `Your ${name} is damaged! You must repair it before it can be used.`;
    case "noWeapon":
      return "No weapons unlocked yet. Click the Chaos Lab tab to start unlocking a Chaos Weapon.";
  }
};

/* ── The list ───────────────────────────────────────────────────────────── */

export interface SiegeRow {
  readonly weapon: SiegeWeaponData;
  readonly level: number;
  readonly quantity: number;
  /** The job running on this weapon at this tab's building. */
  readonly job: SiegeJob | null;
}

/**
 * A tab's rows (`SiegeBuildingPopup.as:151-172`): the Lab lists all three in
 * Flash's order; the Factory only those researched, sorted by id.
 */
export const siegeRows = (context: SiegeContext, site: SiegeSite): SiegeRow[] => {
  const job = runningJob(context, site);
  const rows = SIEGE_WEAPON_DATA.map((weapon) => ({
    weapon,
    ...stockOf(context.save.siege, weapon.id),
    job: job?.weapon.id === weapon.id ? job : null,
  }));
  if (site === "lab") return rows;
  return rows.filter((row) => row.level > 0).sort((a, b) => (a.weapon.id < b.weapon.id ? -1 : 1));
};

/* ── The right side ─────────────────────────────────────────────────────── */

/** Why the right side shows a warning instead of the offer, under the server's refusal keys. */
export type SiegeWarning =
  | { readonly reason: "labBusy" }
  | { readonly reason: "labLevel"; readonly have: number; readonly need: number }
  | { readonly reason: "factoryBusy" }
  | { readonly reason: "holding" };

/** What the selected weapon's right side offers. */
export type SiegeOffer =
  /** This weapon's job: Finish Now, the time bar and Cancel. */
  | { readonly kind: "running"; readonly job: SiegeJob }
  /** The Lab at level 10: nothing below the stats. */
  | { readonly kind: "max" }
  /** The Factory holds this one: Open Map. */
  | { readonly kind: "holding" }
  | { readonly kind: "warning"; readonly warning: SiegeWarning }
  /** The instant box and the cost box with its Start button. */
  | {
      readonly kind: "start";
      readonly verb: "unlock" | "upgrade" | "build";
      readonly cost: SiegeCost;
      /** Shiny to do it at once, no resources. */
      readonly instant: number;
    };

/**
 * The right side for `id` (`UpdateShowCurrentWeaponLab`, `:467-512`;
 * `UpdateShowCurrentWeaponFactory`, `:514-551`), the site's notice aside.
 */
export const siegeOffer = (context: SiegeContext, site: SiegeSite, id: SiegeId): SiegeOffer => {
  const weapon = siegeData(id)!;
  const stock = stockOf(context.save.siege, id);
  const job = runningJob(context, site);
  if (job?.weapon.id === id) return { kind: "running", job };

  if (site === "lab") {
    if (stock.level >= SIEGE_MAX_LEVEL) return { kind: "max" };
    if (job) return { kind: "warning", warning: { reason: "labBusy" } };
    const have = siegeBuilding(context.yard, "lab")?.level ?? 0;
    const need = stock.level + 1;
    if (have < need) return { kind: "warning", warning: { reason: "labLevel", have, need } };
    const cost = siegeUpgradeCost(weapon, stock.level)!;
    return { kind: "start", verb: stock.level === 0 ? "unlock" : "upgrade", cost, instant: instantPrice(cost) };
  }

  if (stock.quantity > 0) return { kind: "holding" };
  if (job) return { kind: "warning", warning: { reason: "factoryBusy" } };
  if (SIEGE_WEAPON_DATA.some((other) => stockOf(context.save.siege, other.id).quantity > 0)) {
    return { kind: "warning", warning: { reason: "holding" } };
  }
  const cost = siegeBuildCost(weapon, stock.level);
  if (!cost) return { kind: "max" };
  return { kind: "start", verb: "build", cost, instant: instantPrice(cost) };
};

/** A warning's words, Flash's (`msg_oneweaponupgrade`, `msg_upgraderequiredlevel`, `msg_oneweapon`). */
export const warningText = (warning: SiegeWarning): string => {
  switch (warning.reason) {
    case "labBusy":
      return "The Chaos Lab can only upgrade or unlock one weapon at a time.";
    case "labLevel":
      return `Upgrade Requires: Chaos Lab Level ${warning.need}`;
    case "factoryBusy":
    case "holding":
      return "The Chaos Factory can only build or hold one weapon at a time.";
  }
};

/* ── Prices ─────────────────────────────────────────────────────────────── */

/** `ceil(sqrt(total / 2)^0.75)` Shiny for `total` resources (`BRAU`, the server's `resourcesPrice`). */
export const resourcesPrice = (total: number): number =>
  total > 0 ? Math.ceil(Math.sqrt(total / 2) ** 0.75) : 0;

/** Doing a job at once, no resources: `GetInstantBuyCost` (`STORE.as:155-185`). */
export const instantPrice = (cost: SiegeCost): number =>
  timeCost(cost.time) + resourcesPrice(cost.r1 + cost.r2 + cost.r3 + cost.r4);

/** Finishing a running job now (`getInstantUpgradeCost`): free at five minutes or less. */
export const finishPrice = (job: SiegeJob, now: number): number => timeCost(job.endsAt - now);

/** What a start is short of. */
export interface SiegeShortfall {
  /** Each resource's shortfall, whole, as the server's `409 shortfall` spells it. */
  readonly short: PurseAmounts;
  /** The raw shortfall summed: "You need #v1# more resources". */
  readonly missing: number;
  /** Shiny the server's top-up charges for it. */
  readonly topUp: number;
  /** A cap is below the cost: no top-up can help (`msg_morepodsunlock`). */
  readonly overCap: boolean;
}

/**
 * What the purse is short of for `cost`, or null when every resource is held
 * at the unrounded cost (`SiegeWeapon.hasResourcesToUpgrade`).
 */
export const shortfallOf = (cost: SiegeCost, purse: Purse): SiegeShortfall | null => {
  const raw = PURSE_KEYS.map((key) => Math.max(cost[key] - purse.held[key], 0));
  const missing = raw.reduce((sum, amount) => sum + amount, 0);
  if (missing <= 0) return null;
  const [r1 = 0, r2 = 0, r3 = 0, r4 = 0] = raw.map((amount) => Math.ceil(amount));
  return {
    short: { r1, r2, r3, r4 },
    missing,
    topUp: resourcesPrice(missing),
    overCap: PURSE_KEYS.some((key) => purse.caps[key] < cost[key]),
  };
};

/** The words of the shortfall confirm, Flash's `buildoptions_err_moreresources`. */
export const shortfallText = (shortfall: Pick<SiegeShortfall, "missing" | "topUp">): [string, string] => [
  `You need ${Math.ceil(shortfall.missing).toLocaleString("en-US")} more resources to build.`,
  `Get the resources and start building for ${shortfall.topUp.toLocaleString("en-US")} Shiny?`,
];

/** Flash's `msg_morepodsunlock`. */
export const CAPACITY_TEXT =
  "You need to build more or upgrade your Resource Pods in your Inferno Yard to hold enough resources to unlock this.";

/* ── The stat bars ──────────────────────────────────────────────────────── */

/** Each weapon's stat labels, in its `stats` order (`label_<id>_stat1..3`). */
const STAT_LABELS: Readonly<Record<SiegeId, readonly string[]>> = {
  decoy: ["Damage:", "Attraction Range:", "Countdown:"],
  vacuum: ["Loot Rate:", "Durability:", "Duration:"],
  jars: ["Range:", "Durability:"],
};

export interface StatLine {
  readonly label: string;
  /** The figure shown. */
  readonly value: number;
  /** "(+diff)" toward the next level, on the Lab only; null when not shown. */
  readonly diff: number | null;
  /** The bar's filled part and the next level's part behind it, 0..1 of the level 10 figure. */
  readonly now: number;
  readonly next: number;
}

const valuesOf = (weapon: SiegeWeaponData, stat: SiegeStat): readonly number[] => weapon[stat];

/**
 * Up to three stat bars (`UpdateShowCurrentWeapon`, `:403-461`): at level 0
 * the first level's figure with only the next bar; on the Lab the figure now
 * with its "(+diff)" and the next level's bar behind; the Factory the figure
 * now alone. The bars are fractions of the level 10 figure
 * (`SiegeWeaponProperty.getProgressForLevel`).
 */
export const statLines = (weapon: SiegeWeaponData, level: number, site: SiegeSite): StatLine[] =>
  weapon.stats.slice(0, 3).map((stat, index) => {
    const values = valuesOf(weapon, stat);
    const top = siegeValue(values, SIEGE_MAX_LEVEL) || 1;
    const at = (lvl: number): number => siegeValue(values, lvl) ?? 0;
    const label = STAT_LABELS[weapon.id][index] ?? "";
    if (level <= 0) return { label, value: at(1), diff: null, now: 0, next: at(1) / top };
    if (site === "factory") return { label, value: at(level), diff: null, now: at(level) / top, next: 0 };
    if (level >= SIEGE_MAX_LEVEL) return { label, value: at(SIEGE_MAX_LEVEL), diff: null, now: 1, next: 0 };
    const diff = at(level + 1) - at(level);
    return { label, value: at(level), diff: diff === 0 ? null : diff, now: at(level) / top, next: at(level + 1) / top };
  });

/** Flash's descriptions (`w_<id>desc`). */
export const WEAPON_DESCRIPTION: Readonly<Record<SiegeId, string>> = {
  decoy:
    "Marilyn Monstroe uses her feminine wiles to attract defending monsters, including those housed in bunkers. Then she delivers a kiss of death in the form of a massive explosion.",
  vacuum:
    "Using patented hyper-vacuum technology, the Loot-O-Tron 5000 latches onto enemy Town Halls and sucks the resources right out of them.",
  jars: "Your victory will be sweet as you slap empty Candy Jars on your foe's defensive towers, rendering them useless until they can shoot their way out of the glass.",
};

/** The list icon (`siege_icon_<id>.png`) and the 400x175 video, converted from Flash's FLV. */
export const weaponArt = (id: SiegeId): { icon: string; video: string; poster: string } => ({
  icon: `/assets/popups/siege_icon_${id}.png`,
  video: `/assets/assets/videos/${id}400x175.mp4`,
  poster: `/assets/assets/videos/${id}400x175.jpg`,
});

/* ── Keeping the save's copy right ──────────────────────────────────────── */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * The `siege` and `iresources` an answer leaves, or nothing. Neither is a
 * yard-state field (that shape is frozen), so the store patches them from
 * the two places they ride: each `completed` entry of kind `siege` (`detail:
 * { building, level, quantity }`) and a siege route's `report`, whose
 * `siege` and `purse` are the weapons and the purse after it.
 */
export const siegeSlices = (
  save: Pick<BaseLoadResponse, "siege" | "iresources">,
  completed: readonly CompletedJob[] | undefined,
  report: unknown,
): Pick<BaseLoadResponse, "siege" | "iresources"> => {
  const patched: { siege?: SiegeData } = {};
  const touch = (): SiegeData => (patched.siege ??= { ...(save.siege ?? {}) });
  for (const job of completed ?? []) {
    if (job.kind !== JobKind.SIEGE || !siegeData(String(job.id))) continue;
    const level = Number(job.detail["level"]);
    const quantity = Number(job.detail["quantity"]);
    const entry = { ...(touch()[String(job.id)] ?? {}) };
    if (Number.isFinite(level)) entry.level = level;
    if (Number.isFinite(quantity)) entry.quantity = quantity;
    touch()[String(job.id)] = entry;
  }

  const slices: Pick<BaseLoadResponse, "siege" | "iresources"> = {};
  if (isRecord(report) && (report["site"] === "lab" || report["site"] === "factory")) {
    const weapons = report["siege"];
    if (isRecord(weapons)) {
      for (const weapon of SIEGE_WEAPON_DATA) {
        const stock = weapons[weapon.id];
        if (!isRecord(stock)) continue;
        touch()[weapon.id] = { ...(touch()[weapon.id] ?? {}), level: Number(stock["level"]), quantity: Number(stock["quantity"]) };
      }
    }
    const purse = report["purse"];
    if (isRecord(purse)) {
      const caps = isRecord(purse["caps"]) ? purse["caps"] : {};
      const next: InfernoResourcesData = { ...(save.iresources ?? {}) };
      for (const key of PURSE_KEYS) {
        if (Number.isFinite(Number(purse[key]))) next[key] = Number(purse[key]);
        if (Number.isFinite(Number(caps[key]))) next[`${key}max`] = Number(caps[key]);
      }
      slices.iresources = next;
    }
  }
  if (patched.siege) slices.siege = patched.siege;
  return slices;
};
