import { describe, expect, it } from "vitest";

import { type BattleOptions, createBattle } from "./engine.js";
import { buildEngineYard } from "./yard.js";

/**
 * Follow-up to Reii's report (25 Nov 2026, `quakeSliver.test.ts`): where else
 * does a fraction of health under 1 leave something alive, or stuck?
 *
 * Flash keeps every health whole (`GameObject.setHealth` stores it in a
 * `SecNum`, whose `Set` rounds, `com/cc/utils/SecNum.as:27`): buildings,
 * monsters, champions and the Vacuum Hose alike. So in Flash nothing ever
 * stands on 0 < health < 1: 0.4 rounds to 0 (destroyed, `BFOUNDATION.as:513-518`),
 * 0.5 rounds to 1 (still standing).
 */

const TOWN_HALL = 14;
/** Level 1 C2 against fortification 2: `fortifiedDamage` takes 30% off, so 10.5 a hit. */
const HIT = 10.5;

const yardOf = (health: Record<string, number>, extra: Record<string, unknown> = {}) =>
  buildEngineYard({
    buildingdata: {
      "1": { id: 1, t: TOWN_HALL, l: 1, X: 0, Y: 0, fort: 2 },
      ...(extra as Record<string, { id: number; t: number; l: number; X: number; Y: number }>),
    },
    buildinghealthdata: health,
    resources: { r1: 100000, r2: 0, r3: 0, r4: 0 },
  });

/** Steps until the first swing lands on building 1; returns its amount. */
const untilFirstHit = (battle: ReturnType<typeof createBattle>): number | undefined => {
  for (let step = 0; step < 3000 && !battle.over(); step += 1) {
    battle.step();
    for (const event of battle.recentEvents(battle.tick - 1)) {
      if (event.tick === battle.tick && event.kind === "hit" && event.buildingId === 1) {
        return (event as { amount: number }).amount;
      }
    }
  }
  return undefined;
};

const finish = (battle: ReturnType<typeof createBattle>): void => {
  for (let step = 0; step < 3000 && !battle.over(); step += 1) battle.step();
};

describe("a building the attack leaves on under 1 health", () => {
  /** A Town Hall on 11 health takes one 10.5 hit, then the attacker retreats. */
  const sliver = (options: Partial<BattleOptions> = {}) => {
    const battle = createBattle(yardOf({ "1": 11 }), { seed: 1, ...options });
    battle.apply({ kind: "fling", t: 0, x: 80, y: 80, r: 0, monsters: { C2: 1 } });
    const hit = untilFirstHit(battle);
    battle.apply({ kind: "retreat", t: battle.tick });
    finish(battle);
    return { hit, state: battle.state() };
  };

  it("is left on 0.5 by a fortified hit (the setup is real)", () => {
    expect(sliver().hit).toBe(HIT);
  });

  it("Flash: rounds 0.5 to 1, so it is saved standing on 1", () => {
    const { state } = sliver();
    expect(state.health["1"]).toBe(1);
    expect(state.destroyedIds).not.toContain(1);
  });

  it("under older rules (wholeHealth off) it was saved as 0, yet never counted destroyed", () => {
    // An attack started before whole health replays as it was fought:
    // `healthMap` truncated 0.5 to 0, drawn as rubble, with no fall.
    const { state } = sliver({ wholeHealth: false });
    expect(state.health["1"]).toBe(0);
    expect(state.destroyedIds).not.toContain(1);
  });

  /**
   * Fortification 3 and a 5% defence bonus: 15 x 0.6 / 1.05 = 8.57 a hit, so
   * a Town Hall on 9 is left on 0.43, which Flash rounds to 0: it falls.
   */
  const fallen = (options: Partial<BattleOptions> = {}) => {
    const yard = buildEngineYard({
      buildingdata: { "1": { id: 1, t: TOWN_HALL, l: 1, X: 0, Y: 0, fort: 3 } },
      buildinghealthdata: { "1": 9 },
      resources: { r1: 100000, r2: 0, r3: 0, r4: 0 },
    });
    const battle = createBattle(yard, { seed: 1, defenceBonus: { hp: 0.05 }, ...options });
    battle.apply({ kind: "fling", t: 0, x: 80, y: 80, r: 0, monsters: { C2: 1 } });
    const hit = untilFirstHit(battle);
    battle.apply({ kind: "retreat", t: battle.tick });
    finish(battle);
    return { hit, state: battle.state() };
  };

  it("Flash: rounds 0.4 to 0, so it falls and counts as destroyed", () => {
    const { hit, state } = fallen();
    expect(hit).toBeCloseTo((15 * 0.6) / 1.05, 9);
    expect(state.health["1"]).toBe(0);
    expect(state.destroyedIds).toContain(1);
  });

  it("under older rules (wholeHealth off) the same hit left it standing on 0.43", () => {
    const { state } = fallen({ wholeHealth: false });
    expect(state.destroyedIds).not.toContain(1);
  });

  it("next attack: a building stored on 0 is already down; no monster can hit it", () => {
    const battle = createBattle(yardOf({ "1": 0 }), { seed: 1 });
    battle.apply({ kind: "fling", t: 0, x: 80, y: 80, r: 0, monsters: { C2: 1 } });
    expect(untilFirstHit(battle)).toBeUndefined();
    finish(battle);
    expect(battle.state().health["1"]).toBe(0);
    expect(battle.state().destroyedIds).not.toContain(1);
  });
});

describe("a defending champion stored on under 1 health", () => {
  /** A Champion Cage, a harvester by it, one far off (as `engine.test.ts`'s caged champion). */
  const cageYard = () =>
    buildEngineYard({
      buildingdata: {
        "1": { id: 1, t: 114, l: 1, X: 0, Y: 0 },
        "2": { id: 2, t: 1, l: 1, X: 150, Y: 150 },
        "3": { id: 3, t: 1, l: 1, X: 1400, Y: 1400 },
      },
      buildinghealthdata: {},
      resources: { r1: 100000, r2: 0, r3: 0, r4: 0 },
    });

  // Only an old save can hold 0.5 now: a battle keeps a caged champion's
  // health whole. `cagedHealth` floors it to 0, as before.
  it("an old save's 0.5: `cagedHealth` floors it to 0, so it never comes out and is reported on 0", () => {
    const battle = createBattle(cageYard(), {
      seed: 3,
      defenderChampions: [{ t: 1, l: 2, hp: 0.5, pl: 0 }],
    });
    battle.apply({ kind: "fling", t: 0, x: 140, y: 140, r: 50, monsters: { C1: 5 } });
    finish(battle);
    expect(battle.creeps().some((creep) => creep.champion && creep.friendly)).toBe(false);
    expect(battle.state().defenderChampions.map((caged) => caged.hp)).toEqual([0]);
  });

  it("on 1 health it does come out and fight", () => {
    const battle = createBattle(cageYard(), {
      seed: 3,
      defenderChampions: [{ t: 1, l: 2, hp: 1, pl: 0 }],
    });
    battle.apply({ kind: "fling", t: 0, x: 140, y: 140, r: 50, monsters: { C1: 5 } });
    let out = false;
    for (let step = 0; step < 3000 && !battle.over(); step += 1) {
      battle.step();
      if (battle.creeps().some((creep) => creep.champion && creep.friendly)) out = true;
    }
    expect(out).toBe(true);
  });
});
