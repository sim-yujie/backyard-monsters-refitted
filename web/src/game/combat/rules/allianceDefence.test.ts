import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createBattle, type BattleOptions, type DefenceBonus } from "./engine.js";
import {
  ALLIANCE_DEFENCE_LIMIT,
  allianceDefenceBonus,
  battleDefence,
  parseAllianceDefence,
  parseDefenderForces,
  type DefenderForces,
} from "./defence.js";
import { replayAttack } from "./replay.js";
import { buildEngineYard } from "./yard.js";
import type { CombatBuildingDataMap } from "./types.js";

/**
 * The alliance constellations' battle bonuses (beta 7, design v5 §9): building
 * health, tower damage and trap damage on a member's yard, frozen by the
 * attack load as `DefenderForces.alliance`. An attack log without them, or
 * with every part 0, is the battle it always was.
 */

const yardOf = (buildings: CombatBuildingDataMap) =>
  buildEngineYard({
    buildingdata: buildings,
    buildinghealthdata: {},
    resources: { r1: 100000, r2: 0, r3: 0, r4: 0 },
  });

const run = (battle: ReturnType<typeof createBattle>, ticks: number): void => {
  for (let step = 0; step < ticks && !battle.over(); step += 1) battle.step();
};

/** A level 1 Cannon Tower (damage 20) against one Pokey. */
const CANNON: CombatBuildingDataMap = { "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } };

const cannonCheckpoint = (extra: Partial<BattleOptions>, ticks = 1500) => {
  const battle = createBattle(yardOf(CANNON), { seed: 1, shellBlastsWhereItLands: false, ...extra });
  battle.apply({ kind: "fling", t: 0, x: -100, y: -100, r: 200, monsters: { C1: 1 } });
  run(battle, ticks);
  return battle.checkpoint();
};

/** A Booby Trap (1,000 at its centre) at the Town Hall's near corner, where three Pokeys (200 each) arrive. */
const trapBattle = (extra: Partial<BattleOptions> = {}) => {
  const battle = createBattle(
    yardOf({
      "1": { id: 1, t: 14, X: 400, Y: 400 },
      "2": { id: 2, t: 24, X: 380, Y: 380 },
    }),
    { seed: 3, ...extra },
  );
  battle.apply({ kind: "fling", t: 0, x: -60, y: -60, r: 40, monsters: { C1: 3 } });
  run(battle, 4000);
  return battle.state();
};

const FIXTURES = fileURLToPath(new URL("../../../../test/fixtures/combat/", import.meta.url));
const SANDBOX = fileURLToPath(new URL("../../../../test/fixtures/baseload-sandbox-yard.json", import.meta.url));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const read = (path: string): Record<string, any> => JSON.parse(readFileSync(path, "utf8"));

/** The bench battle on the sandbox yard: four flings, a champion, a bomb. */
const mixedWaves = (extra: { defenceBonus?: DefenceBonus } = {}) => {
  const fixture = read(`${FIXTURES}mixed-waves.json`);
  const sandbox = read(SANDBOX);
  return replayAttack({
    buildingdata: sandbox.buildingdata,
    buildinghealthdata: sandbox.buildinghealthdata,
    resources: sandbox.resources,
    kind: fixture.kind,
    log: fixture.log,
    levels: fixture.levels,
    playerLevel: fixture.playerLevel,
    tailTicks: fixture.tailTicks,
    ...extra,
  });
};

const FORCES: DefenderForces = { bunkers: {}, defenderLevels: {}, defenderChampions: [] };

describe("no alliance bonus: the battle as it always was", () => {
  it("serves nothing for no alliance, every part 0, or parts it cannot read", () => {
    for (const alliance of [undefined, null, {}, { hp: 0, damage: 0, trap: 0 }, { hp: "10" }, { hp: 1.5 }, 7]) {
      expect(parseAllianceDefence(alliance)).toBeUndefined();
      expect(parseDefenderForces({ ...FORCES, alliance })?.alliance).toBeUndefined();
      expect(battleDefence(parseDefenderForces({ ...FORCES, alliance }))).toEqual({});
    }
  });

  it("refuses a part past the limit, either way", () => {
    expect(parseAllianceDefence({ hp: ALLIANCE_DEFENCE_LIMIT + 1, damage: -ALLIANCE_DEFENCE_LIMIT - 1 })).toBeUndefined();
    expect(parseAllianceDefence({ hp: -10, damage: 0, trap: 12 })).toEqual({ hp: -10, trap: 12 });
  });

  it("replays the bench battle to the same digest with an attack log from before alliances", () => {
    const plain = mixedWaves();
    const served = mixedWaves(battleDefence(parseDefenderForces({ ...FORCES, alliance: { hp: 0 } })));
    expect(served.digest).toBe(plain.digest);
    expect(served.damage).toBe(plain.damage);
  }, 60_000);

  it("a trap-only bonus leaves a yard without traps exactly as it was", () => {
    const defence = battleDefence(parseDefenderForces({ ...FORCES, alliance: { trap: 20 } }));
    expect(defence.defenceBonus).toEqual({ hp: 0, damage: 0, trap: 0.2 });
    expect(cannonCheckpoint(defence)).toEqual(cannonCheckpoint({}));
  });
});

describe("with an alliance bonus", () => {
  it("turns whole percent into the battle's shares", () => {
    expect(allianceDefenceBonus({ hp: 10, damage: 5, trap: 12 })).toEqual({ hp: 0.1, damage: 0.05, trap: 0.12 });
    expect(allianceDefenceBonus({ damage: 5 })).toEqual({ hp: 0, damage: 0.05 });
  });

  it("keeps it through the attack session and into the battle", () => {
    const forces = parseDefenderForces({ ...FORCES, alliance: { hp: 10, damage: 5 } });
    expect(forces?.alliance).toEqual({ hp: 10, damage: 5 });
    expect(battleDefence(forces).defenceBonus).toEqual({ hp: 0.1, damage: 0.05 });
  });

  it("multiplies with the neighbour bonus and the land", () => {
    const bonus = battleDefence(parseDefenderForces({ ...FORCES, neighbours: 2, alliance: { hp: 10, trap: 10 } }))
      .defenceBonus!;
    expect(bonus.hp).toBeCloseTo(1.09 * 1.1 - 1, 12);
    expect(bonus.damage).toBeCloseTo(0.09, 12);
    expect(bonus.trap).toBeCloseTo(0.1, 12);
  });

  it("changes the bench battle when building health is up", () => {
    const plain = mixedWaves();
    const tough = mixedWaves(battleDefence(parseDefenderForces({ ...FORCES, alliance: { hp: 20 } })));
    expect(tough.digest).not.toBe(plain.digest);
    expect(tough.damage).toBeLessThan(plain.damage);
  }, 60_000);

  it("scales a trap's blast: at -90% the Booby Trap no longer kills a Pokey", () => {
    const plain = trapBattle();
    const weak = trapBattle({ defenceBonus: { trap: -0.9 } });
    expect(plain.firedTraps).toEqual([2]);
    expect(weak.firedTraps).toEqual([2]);
    expect(plain.creepsKilled).toBeGreaterThan(0);
    expect(weak.creepsKilled).toBe(0);
  });

  it("a trap boost never makes a trap do less", () => {
    const plain = trapBattle();
    const strong = trapBattle({ defenceBonus: { trap: 0.5 } });
    expect(strong.creepsKilled).toBeGreaterThanOrEqual(plain.creepsKilled);
  });
});
