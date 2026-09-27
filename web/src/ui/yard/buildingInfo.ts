import { BOMBS, MR2_CAPACITY, TOWER_STATS } from "@/game/combat/rules";
import { BUILDING_COST_ROWS } from "@/game/yard/buildingCostData";
import { maxLevel, quantityOf, rowOf } from "@/game/yard/buildingCosts";
import type { YardBuilding } from "@/game/yard/yardModel";
import { resourceKeyOf, type ResourceKey } from "@/ui/resourceIcon";

/**
 * The per-type rows at the top of the building panel
 * (`docs/design/yard-buildings.md` §3.1 "Per-type info rows").
 *
 * Every figure is read from a generated table, never typed here: tower range
 * and damage from `TOWER_STATS` (§10 Q1), Flinger payload from
 * `MR2_CAPACITY`, harvester and silo ladders from the cost table's `stats`,
 * Town Hall unlocks from each type's `quantity`, Catapult bombs from the bomb
 * table. The one exception is the Flinger's reach in cells, which is a code
 * literal on the server and is mirrored in {@link FLINGER_REACH}.
 *
 * A row carries its value now and, where the next level changes it, its value
 * after the upgrade, so the panel can draw "190 → 200". Nothing here touches
 * the DOM; amounts stay numbers so the panel spells them with the shared
 * resource helper.
 */

/**
 * A value on a row: plain text; an amount (of one resource when `resource` is
 * set, of every resource when not), spelled by the panel with the shared
 * helper; or a set of resources, drawn as their icons.
 */
export type InfoValue =
  | { readonly text: string }
  | { readonly amount: number; readonly resource?: ResourceKey; readonly suffix?: string }
  | { readonly resources: readonly ResourceKey[] };

export interface InfoRow {
  readonly label: string;
  readonly now: InfoValue;
  /** The value one level up, when the next level exists and changes it. */
  readonly next?: InfoValue;
  /** The next level is worse on this row (a Tesla Tower's level 2 hits softer): not drawn as a gain. */
  readonly down?: true;
}

/** A list row: Town Hall unlocks, which do not fit "now → next". */
export interface InfoList {
  readonly label: string;
  readonly items: readonly string[];
}

export interface BuildingInfo {
  readonly rows: readonly InfoRow[];
  readonly list: InfoList | null;
}

const FLINGER_TYPE = 5;
const SILO_TYPE = 6;
const TOWN_HALL_TYPE = 14;
const CATAPULT_TYPE = 51;

/**
 * A main yard's Flinger reach in map cells, by Flinger level 1 to 4
 * (`getMainYardRange`, `server/src/services/maproom/v2/rangeCheck.ts:87-101`).
 */
export const FLINGER_REACH: readonly number[] = [4, 6, 8, 10];

/** The harvesters and the resource each one makes. */
const HARVESTER_RESOURCE: Readonly<Record<number, ResourceKey>> = {
  1: "r1",
  2: "r2",
  3: "r3",
  4: "r4",
};

/**
 * Damage per second as the original's upgrade text spells it:
 * `int(damage × 40 / rate)` (`client/scripts/BTOWER.as:144-147`).
 */
export const damagePerSecond = (damage: number, rate: number): number =>
  rate > 0 ? Math.trunc((damage * 40) / rate) : 0;

const text = (value: string): InfoValue => ({ text: value });

const sameValue = (a: InfoValue, b: InfoValue): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * A row, with `next` dropped when it is missing or unchanged. `numbers` are
 * the two values compared, when they are numbers, so a drop is marked.
 */
const row = (
  label: string,
  now: InfoValue,
  next?: InfoValue | null,
  numbers?: readonly [now: number, next: number | undefined],
): InfoRow => {
  if (!next || sameValue(now, next)) return { label, now };
  const down = numbers && numbers[1] !== undefined && numbers[1] < numbers[0];
  return down ? { label, now, next, down: true } : { label, now, next };
};

/** The level the info reads: a building still being built reads as the level 1 it will be. */
const shownLevel = (building: YardBuilding): number => Math.max(building.level, 1);

/** Whether a level one above exists for the type. */
const nextLevelOf = (building: YardBuilding): number | null => {
  const level = shownLevel(building);
  return level < maxLevel(building.type) ? level + 1 : null;
};

/** Range and damage per second, now and next. */
const towerRows = (building: YardBuilding): InfoRow[] => {
  const ladder = TOWER_STATS[building.type];
  if (!ladder || ladder.length === 0) return [];
  const level = Math.min(shownLevel(building), ladder.length);
  const nextLevel = nextLevelOf(building);
  const now = ladder[level - 1];
  const next = nextLevel !== null && nextLevel <= ladder.length ? ladder[nextLevel - 1] : undefined;
  if (!now) return [];

  const rows: InfoRow[] = [];
  if (now.range !== undefined) {
    rows.push(
      row(
        "Range",
        text(now.range.toLocaleString("en-US")),
        next?.range !== undefined ? text(next.range.toLocaleString("en-US")) : null,
        [now.range, next?.range],
      ),
    );
  }
  if (now.damage !== undefined && now.rate !== undefined) {
    const perSecond = (damage: number, rate: number) =>
      text(`${damagePerSecond(damage, rate).toLocaleString("en-US")}/s`);
    rows.push(
      row(
        "Damage",
        perSecond(now.damage, now.rate),
        next?.damage !== undefined && next.rate !== undefined
          ? perSecond(next.damage, next.rate)
          : null,
        [
          damagePerSecond(now.damage, now.rate),
          next?.damage !== undefined && next.rate !== undefined
            ? damagePerSecond(next.damage, next.rate)
            : undefined,
        ],
      ),
    );
  }
  return rows;
};

/** Room in monster space, from the Map Room 2 capacity ladders (Flinger, Bunker). */
const capacityRow = (building: YardBuilding, label: string): InfoRow | null => {
  const ladder = MR2_CAPACITY[building.type];
  if (!ladder) return null;
  const level = Math.min(shownLevel(building), ladder.length);
  const nextLevel = nextLevelOf(building);
  const now = ladder[level - 1];
  const next = nextLevel !== null ? ladder[nextLevel - 1] : undefined;
  if (now === undefined) return null;
  return row(
    label,
    text(now.toLocaleString("en-US")),
    next !== undefined ? text(next.toLocaleString("en-US")) : null,
  );
};

const flingerRows = (building: YardBuilding): InfoRow[] => {
  const level = shownLevel(building);
  const nextLevel = nextLevelOf(building);
  const reach = (at: number) => {
    const cells = FLINGER_REACH[Math.min(at, FLINGER_REACH.length) - 1] ?? 0;
    return text(`${cells} cells`);
  };
  const rows = [row("Attack range", reach(level), nextLevel !== null ? reach(nextLevel) : null)];
  const capacity = capacityRow(building, "Fling capacity");
  if (capacity) rows.push(capacity);
  return rows;
};

/** The resources whose bombs a catapult at this level fires. */
export const bombResources = (catapultLevel: number): ResourceKey[] => {
  const keys: ResourceKey[] = [];
  for (const bomb of BOMBS) {
    const key = resourceKeyOf(bomb.resource);
    if (bomb.catapultLevel <= catapultLevel && !keys.includes(key)) keys.push(key);
  }
  return keys;
};

const catapultRows = (building: YardBuilding): InfoRow[] => {
  const level = shownLevel(building);
  const nextLevel = nextLevelOf(building);
  return [
    row(
      "Bombs",
      { resources: bombResources(level) },
      nextLevel !== null ? { resources: bombResources(nextLevel) } : null,
    ),
  ];
};

/** A harvester's rate per hour and buffer, or a silo's storage, now and next. */
const economyRows = (building: YardBuilding): InfoRow[] => {
  const stats = rowOf(building.type)?.[6];
  if (!stats) return [];
  const level = shownLevel(building);
  const nextLevel = nextLevelOf(building);
  const at = (ladder: readonly number[], lvl: number | null) =>
    lvl === null ? undefined : ladder[lvl - 1];

  if (building.type === SILO_TYPE) {
    const now = at(stats.capacity, level);
    if (now === undefined) return [];
    const next = at(stats.capacity, nextLevel);
    // Room in every pool at once, so no one resource's icon.
    const value = (amount: number): InfoValue => ({ amount, suffix: " to each resource" });
    return [row("Storage added", value(now), next !== undefined ? value(next) : null)];
  }

  const resource = HARVESTER_RESOURCE[building.type];
  if (!resource) return [];
  const rate = (lvl: number | null): InfoValue | undefined => {
    const produce = at(stats.produce, lvl);
    const cycle = at(stats.cycleTime, lvl);
    if (produce === undefined || !cycle) return undefined;
    return { resource, amount: Math.round((produce * 3_600) / cycle), suffix: "/h" };
  };
  const buffer = (lvl: number | null): InfoValue | undefined => {
    const capacity = at(stats.capacity, lvl);
    return capacity === undefined ? undefined : { resource, amount: capacity };
  };
  const rows: InfoRow[] = [];
  const rateNow = rate(level);
  if (rateNow) rows.push(row("Makes", rateNow, rate(nextLevel)));
  const bufferNow = buffer(level);
  if (bufferNow) rows.push(row("Holds", bufferNow, buffer(nextLevel)));
  return rows;
};

/** Kinds a Town Hall's `quantity` ladder counts that the player builds. */
const COUNTED_KINDS: ReadonlySet<string> = new Set([
  "resource",
  "special",
  "tower",
  "wall",
  "trap",
]);

/**
 * What raising the Town Hall from `level` lets the yard build: every type
 * whose cap rises, as "Cannon Tower +1", or "Flinger (new)" when the type was
 * not allowed at all before.
 */
export const townHallUnlocks = (level: number): string[] => {
  const items: string[] = [];
  for (const [type, name, kind] of BUILDING_COST_ROWS) {
    if (!COUNTED_KINDS.has(kind) || type === TOWN_HALL_TYPE) continue;
    const before = quantityOf(type, level);
    const after = quantityOf(type, level + 1);
    if (after <= before) continue;
    items.push(before === 0 ? `${name} (new)` : `${name} +${after - before}`);
  }
  return items;
};

/** The health row: current and maximum, as the save and the HP ladder give them. */
const healthRow = (building: YardBuilding): InfoRow | null => {
  if (building.maxHp === null) return null;
  const max = building.maxHp.toLocaleString("en-US");
  const current = building.hp === null ? max : building.hp.toLocaleString("en-US");
  return { label: "Health", now: text(`${current} / ${max}`) };
};

/** Every info row for one building. */
export const buildingInfo = (building: YardBuilding): BuildingInfo => {
  const rows: InfoRow[] = [];
  const health = healthRow(building);
  if (health) rows.push(health);

  switch (building.type) {
    case FLINGER_TYPE:
      rows.push(...flingerRows(building));
      break;
    case CATAPULT_TYPE:
      rows.push(...catapultRows(building));
      break;
    default: {
      rows.push(...towerRows(building));
      if (TOWER_STATS[building.type]) {
        const room = capacityRow(building, "Holds monsters");
        if (room) rows.push(room);
      }
      rows.push(...economyRows(building));
    }
  }

  let list: InfoList | null = null;
  if (building.type === TOWN_HALL_TYPE && nextLevelOf(building) !== null) {
    const items = townHallUnlocks(shownLevel(building));
    list = {
      label: `Town Hall ${shownLevel(building) + 1} unlocks`,
      items: items.length > 0 ? items : ["No new buildings"],
    };
  }

  return { rows, list };
};
