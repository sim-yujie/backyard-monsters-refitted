import { describe, expect, test } from "bun:test";

import {
  buildEngineYard,
  createBattle,
  defenderForcesOf,
  type BuildingHealthMap,
  type CombatBuildingDataMap,
  type CombatTargetKind,
} from "../../../game-rules/combat/index.js";
import { molochTribes } from "./molochTribes.js";

/**
 * A smoke fight against every Moloch yard (Inferno plan WP 1.6): the 13
 * Descent yards (201-213) and the Inferno map's tribes (214-234).
 *
 * Each yard is fought as the server would: its own buildings, health and
 * resources, and its own defence off `defenderForcesOf` (its housed monsters
 * in its Housing Bunkers, at its academy levels). A mixed army, walkers,
 * flyers, burrowers and every Inferno special, lands on all four sides, and
 * a few Pokeys beside each Housing Bunker. The fight must run to its end without an error
 * and leave every number whole and in bounds, and every Housing Bunker that
 * houses anyone must send them.
 *
 * A Descent yard is fought both ways: as an Inferno yard, which is how Flash
 * loads it (`maproom_inferno/PlayerHandler.as:333`), and on the main table,
 * which WP 1.2 chose; the owner settles which before WP 1.11.
 */

const DESCENT_IDS = new Set(Array.from({ length: 13 }, (_, i) => String(201 + i)));

const ARMY = { C1: 10, C3: 4, C6: 3, C12: 1, C15: 3, IC1: 4, IC4: 2, IC5: 2, IC7: 2, IC8: 1 };
const SIDES = [
  { x: -800, y: 0 },
  { x: 800, y: 0 },
  { x: 0, y: -800 },
  { x: 0, y: 800 },
];

/** A Housing Bunker's first look for attackers (`HOUSINGBUNKER.as:273`). */
const FIRST_LOOK = 30;

/** Fifty seconds of fight (80 ticks a second): every defence has acted by then. */
const MAX_TICKS = 4000;

const finite = (value: unknown): boolean => typeof value === "number" && Number.isFinite(value);

const fight = (tribe: (typeof molochTribes)[number], kind: CombatTargetKind) => {
  const buildingdata = tribe.buildingdata as unknown as CombatBuildingDataMap;
  const buildinghealthdata = (tribe.buildinghealthdata ?? {}) as BuildingHealthMap;
  const yard = buildEngineYard({
    buildingdata,
    buildinghealthdata,
    resources: tribe.resources as Record<string, number>,
    kind,
  });
  const defence = defenderForcesOf({
    buildingdata,
    academy: tribe.academy,
    champion: tribe.champion,
    monsters: tribe.monsters,
    buildinghealthdata,
  });
  const battle = createBattle(yard, {
    seed: Number(tribe.baseid),
    levels: { IC1: 3, IC4: 3, IC5: 3, IC7: 3, IC8: 3 },
    bunkers: defence.bunkers,
    defenderLevels: defence.defenderLevels,
    defenderChampions: defence.defenderChampions,
  });
  for (const side of SIDES) battle.apply({ kind: "fling", t: 0, r: 60, ...side, monsters: ARMY });
  for (const building of yard.buildings) {
    if (building.type !== 128) continue;
    const beside = { x: building.x + 120, y: building.y + 120 };
    battle.apply({ kind: "fling", t: 0, r: 60, ...beside, monsters: { C1: 5 } });
  }
  for (let step = 0; step < MAX_TICKS && !battle.over(); step += 1) battle.step();
  return { yard, defence, battle, state: battle.state() };
};

const check = ({ yard, defence, battle, state }: ReturnType<typeof fight>): void => {
  for (const building of yard.buildings) {
    expect(finite(building.hp)).toBe(true);
    expect(building.hp).toBeGreaterThanOrEqual(0);
    expect(building.hp).toBeLessThanOrEqual(building.maxHp);
  }
  for (const creep of battle.creeps()) {
    expect(finite(creep.hp) && finite(creep.ix) && finite(creep.iy)).toBe(true);
  }
  for (const value of [...Object.values(state.loot), ...Object.values(state.defenderLoss)]) {
    expect(finite(value) && value >= 0).toBe(true);
  }
  expect(finite(state.creepsAlive) && finite(state.creepsKilled)).toBe(true);
  for (const tower of state.towers) expect(finite(tower.damageDealt)).toBe(true);
  // Every Housing Bunker that houses anyone sends them at the army beside it.
  for (const report of state.bunkers) {
    const housed = Object.values(defence.bunkers[report.id] ?? {}).reduce((sum, n) => sum + n, 0);
    const stood = report.destroyedTick === null || report.destroyedTick > FIRST_LOOK;
    if (housed > 0 && stood) expect(report.sent).toBeGreaterThan(0);
    // A fallen Housing Bunker's monsters all die with it.
    if (report.destroyedTick !== null) expect(state.bunkerGarrisons[report.id] ?? {}).toEqual({});
  }
};

// A full fight takes up to a few seconds on a busy machine (issue #141).
const TIMEOUT_MS = 60_000;

describe("every Moloch yard fights without an error (Inferno WP 1.6)", () => {
  test("the data holds the 13 Descent yards and the tribes", () => {
    expect(molochTribes.filter((tribe) => DESCENT_IDS.has(String(tribe.baseid)))).toHaveLength(13);
    expect(molochTribes.length).toBeGreaterThan(13);
  });

  for (const tribe of molochTribes) {
    const id = String(tribe.baseid);
    if (DESCENT_IDS.has(id)) {
      test(`Descent yard ${id}, as an Inferno yard`, () => check(fight(tribe, "inferno")), TIMEOUT_MS);
      test(`Descent yard ${id}, on the main table`, () => check(fight(tribe, "main")), TIMEOUT_MS);
    } else {
      test(`tribe yard ${id}`, () => check(fight(tribe, "inferno")), TIMEOUT_MS);
    }
  }
});
