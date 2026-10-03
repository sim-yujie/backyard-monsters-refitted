import { describe, expect, test } from "bun:test";
import { championEntry, championMaxHealth } from "../../game-data/championCatalogue.js";
import { housingSpace, LISTED_MONSTERS, maxTrainingLevel, monsterEntry } from "../../game-data/monsterCatalogue.js";
import { mulberry32 } from "../../game-rules/combat/rng.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import { storageCap } from "../base/economy/resourceBudget.js";
import { ACADEMY_TYPE } from "../yard/academy.js";
import { BUNKER_TYPE, BUNKERABLE_MONSTERS, bunkerCapacity } from "../yard/bunker.js";
import { CHAMPION_CAGE_TYPE } from "../yard/champion.js";
import { housingCapacity } from "../yard/housing.js";
import { LOCKER_TYPE, STARTER_MONSTER } from "../yard/locker.js";
import { checkNodePlacement } from "../yardplanner/validateLayout.js";
import { expansionFor } from "./layout.js";
import { PERSONAS, targetInBand } from "./progression.js";
import {
  BUNKER_FILL,
  championLevelFor,
  fillRoom,
  generateBotYard,
  HOUSING_FILL,
  LOOT_BAND,
  unlockedMonsters,
  type BotYard,
} from "./yardGenerator.js";

/** The bot yard generator's entry (issue #237, `docs/design/bot-neighbours.md` §4.2). */

const NOW = 1_800_000_000;

const buildingDataOf = (yard: BotYard): BuildingDataMap =>
  Object.fromEntries(
    yard.buildings.map((building) => [String(building.id), { id: building.id, t: building.t, l: building.l }])
  ) as unknown as BuildingDataMap;

const topLevel = (yard: BotYard, type: number): number =>
  yard.buildings.reduce((best, building) => (building.t === type ? Math.max(best, building.l) : best), 0);

/** Space a set of monsters takes at the yard's academy levels. */
const spaceOf = (yard: BotYard, contents: Readonly<Record<string, number>>): number =>
  Object.entries(contents).reduce(
    (total, [id, count]) => total + (housingSpace(id, yard.academy[id]?.level ?? 1) ?? 0) * count,
    0
  );

/** Every fill rule of §4.2 steps 3 and 4. */
const expectFilled = (yard: BotYard) => {
  const unlocked = new Set(Object.keys(yard.lockerdata));
  const locker = topLevel(yard, LOCKER_TYPE);
  const academyLevel = topLevel(yard, ACADEMY_TYPE);

  // Unlocks: the Pokey, and nothing past the locker's level.
  expect(unlocked.has(STARTER_MONSTER)).toBe(true);
  for (const id of unlocked) {
    expect(monsterEntry(id)!.blocked).toBe(false);
    if (id !== STARTER_MONSTER) expect(monsterEntry(id)!.level).toBeLessThanOrEqual(locker);
  }

  // Academy: every unlocked monster, within the academy and the monster's top.
  expect(new Set(Object.keys(yard.academy))).toEqual(unlocked);
  for (const [id, { level }] of Object.entries(yard.academy)) {
    expect(level).toBeGreaterThanOrEqual(1);
    expect(level).toBeLessThanOrEqual(Math.min(maxTrainingLevel(id), academyLevel + 1));
  }

  // Bunkers: bunkerable unlocked monsters, 70-100% of the room.
  for (const building of yard.buildings) {
    if (building.t !== BUNKER_TYPE) continue;
    const room = bunkerCapacity(building.l);
    const used = spaceOf(yard, building.m ?? {});
    for (const id of Object.keys(building.m ?? {})) {
      expect(unlocked.has(id)).toBe(true);
      expect(BUNKERABLE_MONSTERS).toContain(id);
    }
    expect(used).toBeLessThanOrEqual(room);
    expect(used).toBeGreaterThanOrEqual(Math.ceil(room * BUNKER_FILL.min));
  }

  // Housing: unlocked monsters, 80-100% of the capacity.
  const capacity = housingCapacity({ buildingdata: buildingDataOf(yard) }, false);
  const housed = spaceOf(yard, yard.monsters.housed);
  for (const id of Object.keys(yard.monsters.housed)) expect(unlocked.has(id)).toBe(true);
  expect(housed).toBeLessThanOrEqual(capacity);
  if (capacity > 0) expect(housed).toBeGreaterThanOrEqual(Math.ceil(capacity * HOUSING_FILL.min));

  // Champion: in its cage exactly when there is a cage, at its level, healthy.
  const hasCage = yard.buildings.some((building) => building.t === CHAMPION_CAGE_TYPE);
  expect(yard.champion.length).toBe(hasCage ? 1 : 0);
  for (const champion of yard.champion) {
    const entry = championEntry(champion.t)!;
    const { level, foodBonus } = championLevelFor(yard.level);
    expect(entry.raisable).toBe(true);
    expect(champion.l).toBe(level);
    expect(champion.fb).toBe(foodBonus);
    expect(champion.hp).toBe(championMaxHealth(entry, level, foodBonus));
    expect(champion.status).toBe(0);
    expect(champion.ft).toBeGreaterThan(NOW);
  }

  // Loot: every resource in the band of the cap.
  const cap = storageCap({ buildingdata: buildingDataOf(yard) });
  for (const key of ["r1", "r2", "r3", "r4"] as const) {
    expect(yard.resources[key]).toBeGreaterThanOrEqual(Math.floor(cap * LOOT_BAND.min));
    expect(yard.resources[key]).toBeLessThanOrEqual(Math.ceil(cap * LOOT_BAND.max));
    expect(yard.resources[`${key}max`]).toBe(cap);
  }
};

/** Where everything stands (§4.2 step 2): the Yard Planner's Apply check on the plot the yard holds. */
const expectPlaced = (yard: BotYard, seed: number) => {
  const expansion = expansionFor(seed, yard.level);
  expect(yard.storedata).toEqual(expansion > 0 ? { ENL: { q: expansion } } : {});
  const nodes = [...yard.buildings, ...yard.decorations].map((spot) => ({ id: spot.id, t: spot.t, x: spot.X, y: spot.Y }));
  expect(() => checkNodePlacement(nodes, expansion)).not.toThrow();
};

describe("generateBotYard", () => {
  test(
    "every level 1-40 x 20 seeds hits its level, fills inside every band and fits the plot",
    () => {
      for (let level = 1; level <= 40; level++) {
        for (let index = 0; index < 20; index++) {
          const seed = level * 6007 + index * 3001;
          const yard = generateBotYard({
            seed,
            persona: PERSONAS[index % PERSONAS.length]!,
            targetPoints: targetInBand(level, (index + 0.5) / 20),
            now: NOW,
          });
          expect({ level, index, got: yard.level }).toEqual({ level, index, got: level });
          expectFilled(yard);
          expectPlaced(yard, seed);
        }
      }
    },
    { timeout: 60_000 }
  );

  test("the same request gives the same yard", () => {
    const request = { seed: 424242, persona: "army" as const, targetPoints: targetInBand(36, 0.2), now: NOW };
    expect(generateBotYard(request)).toEqual(generateBotYard(request));
  });

  test("a growing bot keeps its unlocks, its champion type and its buildings where they stood", () => {
    for (let seed = 0; seed < 10; seed++) {
      const persona = PERSONAS[seed % PERSONAS.length]!;
      const young = generateBotYard({ seed, persona, targetPoints: targetInBand(24, 0.5), now: NOW });
      const old = generateBotYard({ seed, persona, targetPoints: targetInBand(38, 0.5), now: NOW });
      for (const id of Object.keys(young.lockerdata)) expect(old.lockerdata[id]).toBeDefined();
      if (young.champion[0]) expect(old.champion[0]!.t).toBe(young.champion[0].t);
      const later = new Map(old.buildings.map((building) => [building.id, building]));
      for (const building of young.buildings) {
        const grown = later.get(building.id)!;
        expect({ t: grown.t, X: grown.X, Y: grown.Y }).toEqual({ t: building.t, X: building.X, Y: building.Y });
      }
    }
  });

  test("points and base value are the save's strings", () => {
    const yard = generateBotYard({ seed: 1, persona: "towers", targetPoints: targetInBand(12, 0.5), now: NOW });
    expect(typeof yard.points).toBe("string");
    expect(typeof yard.basevalue).toBe("string");
    expect(Number(yard.points) + Number(yard.basevalue)).toBeGreaterThan(0);
  });
});

describe("unlockedMonsters", () => {
  test("only the Pokey without a locker", () => {
    expect(unlockedMonsters(5, 0)).toEqual([STARTER_MONSTER]);
  });

  test("holds back one or two of the top tier, never a lower one", () => {
    for (let seed = 0; seed < 50; seed++) {
      for (let locker = 1; locker <= 4; locker++) {
        const unlocked = new Set(unlockedMonsters(seed, locker));
        for (let tier = 1; tier <= locker; tier++) {
          const ids = LISTED_MONSTERS.filter((entry) => entry.level === tier).map((entry) => entry.id);
          const missing = ids.filter((id) => !unlocked.has(id)).length;
          if (tier < locker) expect(missing).toBe(0);
          else expect([1, 2]).toContain(missing);
        }
      }
    }
  });
});

describe("fillRoom", () => {
  test("lands inside the band with big monsters too", () => {
    const academy = { C1: { level: 1 }, C12: { level: 1 }, C5: { level: 1 } };
    for (let seed = 0; seed < 200; seed++) {
      const room = 380 + seed * 3;
      const contents = fillRoom(mulberry32(seed), room, BUNKER_FILL, ["C1", "C5", "C12"], academy);
      const used = Object.entries(contents).reduce(
        (total, [id, count]) => total + (housingSpace(id, 1) ?? 0) * count,
        0
      );
      expect(used).toBeLessThanOrEqual(room);
      expect(used).toBeGreaterThanOrEqual(Math.ceil(room * BUNKER_FILL.min));
    }
  });

  test("an empty room or pool fills nothing", () => {
    expect(fillRoom(mulberry32(1), 0, HOUSING_FILL, ["C1"], {})).toEqual({});
    expect(fillRoom(mulberry32(1), 500, HOUSING_FILL, [], {})).toEqual({});
  });
});
