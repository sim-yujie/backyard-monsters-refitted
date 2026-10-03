import { CHAMPION_CATALOGUE, championMaxHealth, type ChampionEntry } from "../../game-data/championCatalogue.js";
import { productionOf } from "../../game-data/buildingCosts.js";
import { housingSpace, LISTED_MONSTERS, maxTrainingLevel } from "../../game-data/monsterCatalogue.js";
import { mulberry32, type Rng } from "../../game-rules/combat/rng.js";
import type { ChampionData } from "../../schemas/ChampionSchema.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import { storageCap } from "../base/economy/resourceBudget.js";
import { ACADEMY_TYPE } from "../yard/academy.js";
import { BUNKER_TYPE, BUNKERABLE_MONSTERS, bunkerCapacity } from "../yard/bunker.js";
import { CHAMPION_CAGE_TYPE, CHAMPION_STATUS } from "../yard/champion.js";
import { derivedLevels } from "../yard/derivedLevels.js";
import { housingCapacity } from "../yard/housing.js";
import { LOCKER_TYPE, STARTER_MONSTER } from "../yard/locker.js";
import { layoutBotYard, type PlacedSpot } from "./layout.js";
import { yardAtPoints, type Persona, type ProgressionBuilding } from "./progression.js";

/**
 * The bot yard generator's entry (`docs/design/bot-neighbours.md` §4.2, issue
 * #237): every save slice a bot's yard needs, for a seed, a persona and a
 * target points value, except where its buildings stand.
 *
 * The buildings and their levels, the points and the base value come from the
 * progression (`progression.ts`). Around them this fills what a player of that
 * level would have, each from its own salted stream of the seed so the build
 * order never depends on it:
 *
 * - **Unlocks** (§4.2 step 3): every monster the Monster Locker's level allows,
 *   less one or two of the top tier the locker has reached; a tier below the
 *   locker's level is whole, so a bot that grows never loses an unlock. The
 *   Pokey is always unlocked, as for every player (`STARTER_MONSTER`).
 * - **Academy levels** by level band ({@link academyBandLevel},
 *   `[PLACEHOLDER]`), one less on some monsters, never past what the yard's
 *   best Monster Academy can train (level N to N+1 needs an academy at N,
 *   `yard/academy.ts`) or the monster's own top.
 * - **Bunkers** to 70-100% of their room with bunkerable unlocked monsters,
 *   **Housing** to 80-100% of `housingCapacity` with unlocked monsters
 *   (§4.2 step 3), measured at their academy levels.
 * - **The champion** in its cage once the yard has one, a raisable type picked
 *   by the seed, at a level by bot level ({@link championLevelFor},
 *   `[PLACEHOLDER]`), fed and at full health.
 * - **Loot** (§4.2 step 4, §4.6): each resource at a random 25-70% of the
 *   storage cap `[PLACEHOLDER]`, and each harvester's buffer part full.
 *
 * - **Where everything stands** (§4.2 step 2, `layout.ts`): every building's
 *   `X`/`Y`, a few decorations, and the yard expansions (`storedata.ENL`) the
 *   plot grows with.
 */

/** Storage held between these fractions of the cap (§4.6) `[PLACEHOLDER]`. */
export const LOOT_BAND = { min: 0.25, max: 0.7 } as const;

/** Bunkers filled to this share of their room (§4.2). */
export const BUNKER_FILL = { min: 0.7, max: 1 } as const;

/** Housing filled to this share of its capacity (§4.2). */
export const HOUSING_FILL = { min: 0.8, max: 1 } as const;

/** A harvester's buffer starts between these shares of its capacity `[PLACEHOLDER]`. */
export const HARVESTER_BUFFER = { min: 0.1, max: 0.6 } as const;

/** Salts that split the seed into independent streams, one per slice. */
const SALT = {
  unlocks: 0x9e3779b9,
  academy: 0x85ebca6b,
  champion: 0xc2b2ae35,
  bunkers: 0x27d4eb2f,
  housing: 0x165667b1,
  loot: 0xd3a2646c,
} as const;

/** A stream of the seed, independent of the progression's. */
const streamOf = (seed: number, salt: number): Rng => mulberry32((Math.floor(seed) ^ salt) >>> 0);

/** A uniform draw in `[min, max)`. */
const between = (rng: Rng, band: { min: number; max: number }): number =>
  band.min + (band.max - band.min) * rng.float();

/** One building of a bot's yard, placed. */
export interface BotBuilding extends ProgressionBuilding {
  /** Footprint origin, yard units (`layout.ts`). */
  X: number;
  Y: number;
  /** A Monster Bunker's garrison (`yard/bunker.ts`). */
  m?: Record<string, number>;
  /** A harvester's buffer and its producing flag (`catchUpHarvesters.ts`). */
  st?: number;
  pr?: number;
}

/** The four resources and their caps, as `save.resources` holds them. */
export interface BotResources {
  r1: number;
  r2: number;
  r3: number;
  r4: number;
  r1max: number;
  r2max: number;
  r3max: number;
  r4max: number;
}

/** Every slice the generator fills. */
export interface BotYard {
  /** `calculateBaseLevel(points, basevalue)`. */
  level: number;
  townHall: number;
  /** As the save stores them: strings. */
  points: string;
  basevalue: string;
  /** In id order. */
  buildings: BotBuilding[];
  /** Decorations, `{ id, t, X, Y }` as a placed one is stored (`yard/decor.ts`); ids from `DECORATION_ID_BASE`. */
  decorations: PlacedSpot[];
  /** The yard expansions: `{ ENL: { q } }`, or empty for none (a new save's `storedata` is `{}`). */
  storedata: { ENL?: { q: number } };
  resources: BotResources;
  lockerdata: Record<string, { t: 2 }>;
  academy: Record<string, { level: number }>;
  monsters: { housed: Record<string, number> };
  champion: ChampionData[];
  /** The cached Flinger and Catapult levels (`syncDerivedLevels`). */
  flinger: number;
  catapult: number;
}

/** What the generator is asked for. */
export interface BotYardRequest {
  /** `bot.seed`: one seed drives the whole yard. */
  seed: number;
  persona: Persona;
  /** Points plus base value to grow to (`targetInBand`). */
  targetPoints: number;
  /** Unix seconds: when the champion was last fed. */
  now: number;
}

/** The buildings as a `buildingdata`-shaped map, for the yard rules that read one. */
const asBuildingData = (buildings: readonly ProgressionBuilding[]): BuildingDataMap =>
  Object.fromEntries(
    buildings.map((building) => [String(building.id), { id: building.id, t: building.t, l: building.l }])
  ) as unknown as BuildingDataMap;

/** The highest level among the buildings of `type`, 0 when there is none. */
const topLevel = (buildings: readonly ProgressionBuilding[], type: number): number =>
  buildings.reduce((best, building) => (building.t === type ? Math.max(best, building.l) : best), 0);

/**
 * The monsters unlocked with a Monster Locker at `lockerLevel` (§4.2 step 3):
 * every listed surface monster up to that level, less one or two of the top
 * tier, picked by the seed per tier. The Pokey always stays.
 */
export const unlockedMonsters = (seed: number, lockerLevel: number): string[] => {
  const unlocked = new Set<string>([STARTER_MONSTER]);
  for (let tier = 1; tier <= lockerLevel; tier++) {
    const inTier = LISTED_MONSTERS.filter((entry) => entry.level === tier).map((entry) => entry.id);
    let held = new Set<string>();
    if (tier === lockerLevel) {
      const rng = streamOf(seed, SALT.unlocks + tier);
      const pool = inTier.filter((id) => id !== STARTER_MONSTER);
      const drop = Math.min(pool.length, 1 + rng.int(2));
      held = new Set(shuffled(rng, pool).slice(0, drop));
    }
    for (const id of inTier) if (!held.has(id)) unlocked.add(id);
  }
  return LISTED_MONSTERS.map((entry) => entry.id).filter((id) => unlocked.has(id));
};

/** A seeded Fisher-Yates copy. */
const shuffled = <T>(rng: Rng, items: readonly T[]): T[] => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
};

/**
 * The academy level a bot of `botLevel` trains its monsters to `[PLACEHOLDER]`:
 * 1 below level 15, then one more every few levels up to 6 at 38.
 */
export const academyBandLevel = (botLevel: number): number => {
  if (botLevel >= 38) return 6;
  if (botLevel >= 34) return 5;
  if (botLevel >= 28) return 4;
  if (botLevel >= 22) return 3;
  if (botLevel >= 15) return 2;
  return 1;
};

/**
 * Academy levels for the unlocked monsters: the band level, one less on about
 * half of them, capped by the best academy (N to N+1 needs level N) and the
 * monster's top. Every unlocked monster gets an entry, as an unlock writes one.
 */
export const academyLevelsFor = (
  seed: number,
  botLevel: number,
  academyLevel: number,
  unlocked: readonly string[]
): Record<string, { level: number }> => {
  const rng = streamOf(seed, SALT.academy);
  const band = academyBandLevel(botLevel);
  const academy: Record<string, { level: number }> = {};
  for (const id of unlocked) {
    const want = band - rng.int(2);
    const cap = Math.min(maxTrainingLevel(id), academyLevel + 1);
    academy[id] = { level: Math.max(1, Math.min(want, cap)) };
  }
  return academy;
};

/**
 * The champion's level for a bot of `botLevel` once it has a cage
 * `[PLACEHOLDER]`: 1 below level 26, then one more every three levels, 6 from
 * 38; the food bonus starts at 39.
 */
export const championLevelFor = (botLevel: number): { level: number; foodBonus: number } => {
  if (botLevel >= 38) return { level: 6, foodBonus: Math.min(3, Math.max(0, botLevel - 38)) };
  if (botLevel >= 35) return { level: 5, foodBonus: 0 };
  if (botLevel >= 32) return { level: 4, foodBonus: 0 };
  if (botLevel >= 29) return { level: 3, foodBonus: 0 };
  if (botLevel >= 26) return { level: 2, foodBonus: 0 };
  return { level: 1, foodBonus: 0 };
};

/** The champion types a cage can raise (Gorgo, Drull, Fomor; D17). */
const RAISABLE: readonly ChampionEntry[] = CHAMPION_CATALOGUE.filter((entry) => entry.raisable);

/** The bot's champion in its cage, fed at `now` and at full health. */
export const championFor = (seed: number, botLevel: number, now: number): ChampionData => {
  const entry = RAISABLE[streamOf(seed, SALT.champion).int(RAISABLE.length)]!;
  const { level, foodBonus } = championLevelFor(botLevel);
  return {
    t: entry.t,
    hp: championMaxHealth(entry, level, foodBonus),
    l: level,
    ft: now + entry.feedTime,
    fd: 0,
    fb: foodBonus,
    pl: entry.powerLevel,
    status: CHAMPION_STATUS.ACTIVE,
  };
};

/** Space one of `id` takes at its academy level. */
const spaceAt = (id: string, academy: Readonly<Record<string, { level: number }>>): number =>
  housingSpace(id, academy[id]?.level ?? 1) ?? 0;

/**
 * Monsters filling `room` to a share drawn from `band`: one to three of
 * `pool` in random proportions, topped up one at a time with whatever still
 * fits, the smallest monster of the pool last, and never left under the
 * band's floor while one more small monster fits the room.
 */
export const fillRoom = (
  rng: Rng,
  room: number,
  band: { min: number; max: number },
  pool: readonly string[],
  academy: Readonly<Record<string, { level: number }>>
): Record<string, number> => {
  const usable = pool.filter((id) => spaceAt(id, academy) > 0);
  if (room <= 0 || usable.length === 0) return {};
  const target = Math.floor(room * between(rng, band));
  const chosen = shuffled(rng, usable).slice(0, 1 + rng.int(Math.min(3, usable.length)));
  const shares = chosen.map(() => 0.2 + rng.float());
  const sum = shares.reduce((total, share) => total + share, 0);

  const contents: Record<string, number> = {};
  let used = 0;
  chosen.forEach((id, index) => {
    const count = Math.floor((target * shares[index]!) / sum / spaceAt(id, academy));
    if (count > 0) {
      contents[id] = count;
      used += count * spaceAt(id, academy);
    }
  });

  const smallest = [...usable].sort((a, b) => spaceAt(a, academy) - spaceAt(b, academy))[0]!;
  const add = (id: string) => {
    contents[id] = (contents[id] ?? 0) + 1;
    used += spaceAt(id, academy);
  };
  for (const id of [...chosen, smallest]) {
    while (used + spaceAt(id, academy) <= target) add(id);
  }
  // The last small monster may leave the fill just under the band: one more if it fits the room.
  const floor = Math.ceil(room * band.min);
  while (used < floor && used + spaceAt(smallest, academy) <= room) add(smallest);
  return contents;
};

/** Each resource at a random point of the band, and the caps (§4.6). */
export const resourcesInBand = (rng: Rng, cap: number): BotResources => {
  const amount = () => Math.floor(cap * between(rng, LOOT_BAND));
  return { r1: amount(), r2: amount(), r3: amount(), r4: amount(), r1max: cap, r2max: cap, r3max: cap, r4max: cap };
};

/**
 * A bot's whole yard for a target (see the file comment). Pure: the same
 * request always gives the same yard.
 */
export const generateBotYard = (request: BotYardRequest): BotYard => {
  const { seed, persona, targetPoints, now } = request;
  const yard = yardAtPoints(seed, persona, targetPoints);
  const buildingdata = asBuildingData(yard.buildings);
  const layout = layoutBotYard(
    seed,
    persona,
    yard.buildings.map((building) => ({ id: building.id, t: building.t, level: yard.builtAtLevel[building.id] ?? 1 })),
    yard.level
  );

  const unlocked = unlockedMonsters(seed, topLevel(yard.buildings, LOCKER_TYPE));
  const academy = academyLevelsFor(seed, yard.level, topLevel(yard.buildings, ACADEMY_TYPE), unlocked);

  const bunkerPool = unlocked.filter((id) => BUNKERABLE_MONSTERS.includes(id));
  const bunkerRng = streamOf(seed, SALT.bunkers);
  const lootRng = streamOf(seed, SALT.loot);
  const buildings: BotBuilding[] = yard.buildings.map((building, index) => {
    const { X, Y } = layout.buildings[index]!;
    if (building.t === BUNKER_TYPE) {
      const m = fillRoom(bunkerRng, bunkerCapacity(building.l), BUNKER_FILL, bunkerPool, academy);
      return { ...building, X, Y, m };
    }
    const stats = productionOf(building.t);
    if (stats) {
      const capacity = stats.capacity[building.l - 1] ?? 0;
      return { ...building, X, Y, st: Math.floor(capacity * between(lootRng, HARVESTER_BUFFER)), pr: 1 };
    }
    return { ...building, X, Y };
  });

  const housed = fillRoom(
    streamOf(seed, SALT.housing),
    housingCapacity({ buildingdata }, false),
    HOUSING_FILL,
    unlocked,
    academy
  );

  const hasCage = yard.buildings.some((building) => building.t === CHAMPION_CAGE_TYPE);
  const { flinger, catapult } = derivedLevels(buildingdata);

  return {
    level: yard.level,
    townHall: yard.townHall,
    points: String(yard.points),
    basevalue: String(yard.basevalue),
    buildings,
    decorations: layout.decorations,
    storedata: layout.expansion > 0 ? { ENL: { q: layout.expansion } } : {},
    resources: resourcesInBand(lootRng, storageCap({ buildingdata })),
    lockerdata: Object.fromEntries(unlocked.map((id) => [id, { t: 2 as const }])),
    academy,
    monsters: { housed },
    champion: hasCage ? [championFor(seed, yard.level, now)] : [],
    flinger,
    catapult,
  };
};
