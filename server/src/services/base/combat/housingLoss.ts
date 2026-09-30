import { monsterName } from "../../../game-rules/combat/index.js";
import { BaseType } from "../../../enums/Base.js";
import { MapRoomVersion } from "../../../enums/MapRoom.js";
import type { BuildingData, BuildingDataMap } from "../../../types/BuildingData.js";
import type { JsonObject } from "../../../types/JsonObject.js";
import { HOUSING_TYPE, academyLevels, isMapRoom3Monsters } from "../../yard/catchUpMonsters.js";
import { cullHousing, housingCapacity } from "../../yard/housing.js";
import { isMR3Structure } from "../../maproom/v3/utils/isMR3Structure.js";

/**
 * A Housing that falls in an attack takes its housed monsters with it (issue
 * #160; the owner's rules of 2026-09-30).
 *
 * Flash put each housed monster in a random living Housing and killed the
 * ones in a Housing that was destroyed (`client/scripts/BUILDING15.as:93-104`),
 * then culled what no longer fit the Housings left standing, one of every
 * type still present per pass (`HOUSING.Cull()`, `HOUSING.as:161-199`). The
 * server does the same without the dice:
 *
 * 1. **The share.** Each fallen Housing takes its share of every stack:
 *    `fallen ÷ standing`, rounded per type to the nearest, halves up (4
 *    Housings, 1 fallen: 10 Pokeys lose 3, 1 Octo-ooze loses 0). A Housing
 *    counts when it is built (not under construction) and was standing when
 *    the battle began; it fell when the server's replay leaves it at 0.
 * 2. **The overflow.** What is left is culled as the catch-up culls
 *    (`cullHousing`) against the Housings still standing (health above 0) at
 *    their current level, a Housing mid-upgrade at its old one, Housing
 *    Expansion included while it runs.
 *
 * It applies when the attack lands, on the final save (`baseSave.ts`) and
 * when the server finishes an abandoned attack (`finaliseAttack.ts`), to the
 * housed roster on the row then: a Map Room 1 or 2 main yard or a Map Room 2
 * outpost, each its own `monsters.housed`. Nothing else is touched: bunker
 * garrisons (`bunkerGarrison.ts`), the champion, the hatchery queues and the
 * monsters away. Nothing is refunded. With no Housing fallen it does nothing;
 * the load's own cull still handles every other drop in capacity.
 *
 * Pure: the caller reads the rows and writes the result.
 */

export type Counts = Record<string, number>;

export interface HousingLoss {
  /** Built Housings the battle brought down. */
  readonly fallen: number;
  /** Monsters lost, per type: the share and the overflow together. */
  readonly lost: Counts;
  /** The housed roster kept. */
  readonly housed: Counts;
}

/** The id the engine knows an entry by: its `id`, else its key (`buildEngineYard`). */
const engineIdOf = (key: string, entry: BuildingData): string => String(entry.id ?? key);

/** Standing in a health map: above 0, or absent from it and from the entry's own `hp`. */
const standsIn = (
  health: Readonly<Record<string, unknown>> | null | undefined,
  key: string,
  entry: BuildingData
): boolean => {
  const value = health?.[engineIdOf(key, entry)] ?? entry.hp;
  return value === undefined || value === null || Number(value) > 0;
};

/** Positive whole counts only. */
const countsOf = (housed: unknown): Counts => {
  const counts: Counts = {};
  if (!housed || typeof housed !== "object" || Array.isArray(housed)) return counts;
  for (const [id, value] of Object.entries(housed as Record<string, unknown>)) {
    const count = Math.floor(Number(value));
    if (Number.isFinite(count) && count > 0) counts[id] = count;
  }
  return counts;
};

/**
 * What a battle's fallen Housings cost the housed roster, or null when none fell.
 *
 * @param input.buildingdata - The defender's `buildingdata`.
 * @param input.before - `buildinghealthdata` as the battle began.
 * @param input.after - The replay's `buildinghealthdata` (0 is fallen).
 * @param input.housed - `monsters.housed` on the row as the attack lands.
 * @param input.levels - Academy level per monster id, for the space each takes.
 * @param input.expansion - Whether Housing Expansion is running.
 */
export const housingLossOf = (input: {
  buildingdata: BuildingDataMap | null | undefined;
  before: Readonly<Record<string, unknown>> | null | undefined;
  after: Readonly<Record<string, unknown>> | null | undefined;
  housed: unknown;
  levels: Readonly<Record<string, number>>;
  expansion: boolean;
}): HousingLoss | null => {
  let standing = 0;
  let fallen = 0;
  for (const [key, entry] of Object.entries(input.buildingdata ?? {})) {
    if (!entry || typeof entry !== "object" || Number(entry.t) !== HOUSING_TYPE) continue;
    if (Number(entry.cB ?? 0) > 0) continue;
    if (!standsIn(input.before, key, entry)) continue;
    standing++;
    if (!standsIn(input.after, key, entry)) fallen++;
  }
  if (fallen === 0) return null;

  // 1. The share, `count × fallen ÷ standing` to the nearest, halves up, in whole numbers.
  const kept = countsOf(input.housed);
  const lost: Counts = {};
  for (const [id, count] of Object.entries(kept)) {
    const share = Math.floor((2 * count * fallen + standing) / (2 * standing));
    if (share <= 0) continue;
    lost[id] = share;
    if (count - share > 0) kept[id] = count - share;
    else delete kept[id];
  }

  // 2. The overflow, against the Housings left standing.
  const capacity = housingCapacity(
    { buildingdata: input.buildingdata, buildinghealthdata: input.after as never },
    input.expansion,
    0
  );
  const culled = cullHousing(kept, capacity, input.levels);
  for (const [id, count] of Object.entries(culled.culled)) lost[id] = (lost[id] ?? 0) + count;

  return { fallen, lost, housed: culled.housed };
};

/** Housing Expansion running at `now` (`storedata.EXH`), as `recycle.ts` reads it. */
export const expansionRunning = (storedata: JsonObject | null | undefined, now: number): boolean =>
  Number((storedata?.EXH as JsonObject | undefined)?.e) > now;

/** How many monsters a loss took. */
export const lostCount = (loss: HousingLoss | null | undefined): number =>
  Object.values(loss?.lost ?? {}).reduce((total, count) => total + count, 0);

/** The yards whose housing falls with it: Map Room 1 and 2 main yards and Map Room 2 outposts. */
export const losesHousedMonsters = (row: {
  type?: string | null;
  mapversion?: number | null;
  wmid?: number | null;
  monsters?: JsonObject | null;
}): boolean =>
  (row.type === BaseType.MAIN || row.type === BaseType.OUTPOST) &&
  row.mapversion !== MapRoomVersion.V3 &&
  !isMR3Structure(Number(row.wmid)) &&
  !isMapRoom3Monsters(row.monsters);

/**
 * Lands a battle's Housing losses on the defender's row, in place: its
 * `monsters.housed` becomes what was kept. Returns the loss, or null when the
 * yard does not lose housed monsters or no Housing fell.
 *
 * @param defender - The defender's row; `monsters` is replaced when anything was lost.
 * @param battle.before - The row's `buildinghealthdata` as the battle began.
 * @param battle.after - The replay's `buildinghealthdata`.
 * @param owner - Where the academy levels and Housing Expansion live: the
 *   outpost owner's main save, or the main yard itself.
 * @param now - Server seconds.
 */
export const landHousingLoss = (
  defender: {
    type?: string | null;
    mapversion?: number | null;
    wmid?: number | null;
    buildingdata?: BuildingDataMap | null;
    monsters?: JsonObject | null;
  },
  battle: {
    before: Readonly<Record<string, unknown>> | null | undefined;
    after: Readonly<Record<string, unknown>> | null | undefined;
  },
  owner: { academy?: JsonObject | null; storedata?: JsonObject | null } | null | undefined,
  now: number
): HousingLoss | null => {
  if (!losesHousedMonsters(defender)) return null;
  const loss = housingLossOf({
    buildingdata: defender.buildingdata,
    before: battle.before,
    after: battle.after,
    housed: defender.monsters?.housed,
    levels: academyLevels(owner?.academy),
    expansion: expansionRunning(owner?.storedata, now),
  });
  if (!loss || lostCount(loss) === 0) return loss;
  defender.monsters = { ...(defender.monsters ?? {}), housed: loss.housed };
  return loss;
};

/** "Pokeys", "D.A.V.E.": a name as more than one of it. */
const plural = (name: string): string => (/[sxX.]$/.test(name) ? name : `${name}s`);

/** "3 Pokeys, 2 Bolts and 1 Octo-ooze". */
const listOf = (counts: Counts): string => {
  const parts = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([id, count]) => `${count} ${count === 1 ? monsterName(id) : plural(monsterName(id))}`);
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
};

/**
 * The attack report's line for the loss, e.g. "A Housing fell: 3 Pokeys and
 * 1 Octo-ooze were lost.", in the report's own monster names (`report.ts`);
 * null when nothing was lost.
 */
export const housingLossLine = (loss: HousingLoss | null | undefined): string | null => {
  const total = lostCount(loss);
  if (!loss || total === 0) return null;
  const fell = loss.fallen === 1 ? "A Housing fell" : `${loss.fallen} Housings fell`;
  return `${fell}: ${listOf(loss.lost)} ${total === 1 ? "was" : "were"} lost.`;
};

/**
 * The stored report with the loss's line before its result line, where the
 * report's other outcome lines go (`attackReport`); as it was with no loss.
 */
export const reportWithHousingLoss = (report: unknown, loss: HousingLoss | null | undefined): unknown => {
  const line = housingLossLine(loss);
  if (!line || typeof report !== "string") return report;
  const lines = report.split("\n");
  const result = lines.findLastIndex((text) => text.startsWith("Result:"));
  lines.splice(result === -1 ? lines.length : result, 0, line);
  return lines.join("\n");
};
