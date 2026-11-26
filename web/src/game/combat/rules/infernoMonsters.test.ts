import { describe, expect, it } from "vitest";

import { createBattle } from "./engine.js";
import { maxHp, monsterStat } from "./stats.js";
import { buildEngineYard } from "./yard.js";
import type { CombatBuildingDataMap } from "./types.js";

/**
 * The Inferno monsters' specials against Flash
 * (`com/monsters/monsters/creeps/inferno/*.as`, Inferno plan WP 1.5).
 */

const yardOf = (buildings: CombatBuildingDataMap) =>
  buildEngineYard({
    buildingdata: buildings,
    buildinghealthdata: {},
    resources: { r1: 100000, r2: 0, r3: 0, r4: 0 },
  });

type Battle = ReturnType<typeof createBattle>;

const flung = (
  buildings: CombatBuildingDataMap,
  monsters: Record<string, number>,
  at = 110,
  ranks?: Record<string, number>,
) => {
  const battle = createBattle(yardOf(buildings), { seed: 7, ...(ranks && { ranks }) });
  battle.apply({ kind: "fling", t: 0, x: at, y: at, r: 0, monsters });
  return battle;
};

/** Every creep hurt and every building hit over `ticks`. */
const watch = (battle: Battle, ticks: number) => {
  const hurts: number[] = [];
  const hits: { buildingId: number; amount: number }[] = [];
  for (let step = 0; step < ticks && !battle.over(); step += 1) {
    battle.step();
    for (const event of battle.recentEvents(battle.tick - 1)) {
      if (event.tick !== battle.tick) continue;
      if (event.kind === "hurt") hurts.push(event.amount);
      if (event.kind === "hit" && event.buildingId >= 0) {
        hits.push({ buildingId: event.buildingId, amount: event.amount });
      }
    }
  }
  return { hurts, hits };
};

describe("IC5 Balthazar sheds its flying and ground flags (`Balthazar.as:10-15`)", () => {
  // A Cannon Tower shoots the ground only (flyer mode 0).
  const cannonYard: CombatBuildingDataMap = {
    "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 },
    "2": { id: 2, t: 1, l: 1, X: 100, Y: 100 },
  };

  it("is shot by a ground-only tower, though it flies", () => {
    // Shot at, that is: the Cannon's shell blasts up where Balthazar is drawn,
    // 40 pixels high, and misses it, as Flash's does (`SHELL_BLASTS_WHERE_IT_LANDS`).
    const battle = flung(cannonYard, { IC5: 1 });
    let shots = 0;
    for (let step = 0; step < 400 && !battle.over(); step += 1) {
      battle.step();
      shots += battle.recentEvents(battle.tick - 1).filter((event) => event.kind === "shot").length;
    }
    expect(shots).toBeGreaterThan(0);
  });

  it("where a plain flyer is not", () => {
    expect(watch(flung(cannonYard, { C15: 1 }), 400).hurts).toEqual([]);
  });
});

describe("IC7 Sabnox's magma fireball (`Sabnox.as:12-20`)", () => {
  const damage = monsterStat("IC7", "damage", 1);

  it("hits a tower for twice its damage", () => {
    const battle = flung(
      { "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 }, "2": { id: 2, t: 1, l: 1, X: 300, Y: 300 } },
      { IC7: 1 },
      60,
    );
    const first = watch(battle, 600).hits.find((hit) => hit.buildingId === 1);
    expect(first?.amount).toBe(damage * 2);
  });

  it("hits any other building for its damage", () => {
    // A level 5 harvester, 6,500 health, takes the whole of it.
    const battle = flung({ "2": { id: 2, t: 1, l: 5, X: 100, Y: 100 } }, { IC7: 1 });
    const first = watch(battle, 600).hits[0];
    expect(first).toEqual({ buildingId: 2, amount: damage });
  });

  it("loots as a fireball, at 1", () => {
    const battle = flung({ "2": { id: 2, t: 1, l: 1, X: 100, Y: 100 } }, { IC7: 1 });
    const { hits } = watch(battle, 600);
    const dealt = hits
      .filter((hit) => hit.buildingId === 2)
      .reduce((sum, hit) => sum + hit.amount, 0);
    expect(dealt).toBeGreaterThan(0);
    expect(battle.state().loot.r1).toBeLessThanOrEqual(dealt);
  });
});

describe("IC8 King Wormzer's splash (`KingWormzer.as:13-27`, Infernal Lab since beta 9)", () => {
  // Two level 9 harvesters side by side, 85,000 health each: it strikes one,
  // and a ranked splash reaches the other (60 apart, inside every rank's reach).
  const pair: CombatBuildingDataMap = {
    "1": { id: 1, t: 1, l: 9, X: 100, Y: 100 },
    "2": { id: 2, t: 1, l: 9, X: 160, Y: 100 },
  };

  it("splashes nothing at rank 0 (beta 9's live nerf: Flash splashed x4)", () => {
    const battle = flung(pair, { IC8: 1 });
    const { hits } = watch(battle, 120);
    const struck = hits[0]?.buildingId;
    expect(struck).toBeDefined();
    const other = struck === 1 ? 2 : 1;
    // Untouched: the state lists no health for it.
    expect(battle.state().health[String(other)] ?? maxHp(1, 9)).toBe(maxHp(1, 9));
  });

  it("splashes the buildings round it once ranked, more with each rank", () => {
    // Touching, so even rank 1's 60 px reaches the other one's middle.
    const close: CombatBuildingDataMap = {
      "1": { id: 1, t: 1, l: 9, X: 100, Y: 100 },
      "2": { id: 2, t: 1, l: 9, X: 140, Y: 100 },
    };
    const hurt = (rank: number): number => {
      const battle = flung(close, { IC8: 1 }, 110, { IC8: rank });
      const { hits } = watch(battle, 120);
      const struck = hits[0]?.buildingId;
      expect(struck).toBeDefined();
      const other = struck === 1 ? 2 : 1;
      // The other harvester was never struck, yet it is hurt.
      expect(hits.some((hit) => hit.buildingId === other)).toBe(false);
      return maxHp(1, 9) - (battle.state().health[String(other)] ?? maxHp(1, 9));
    };
    const [one, two, three] = [hurt(1), hurt(2), hurt(3)];
    expect(one).toBeGreaterThan(0);
    expect(two).toBeGreaterThan(one);
    expect(three).toBeGreaterThan(two);
  });

  it("splashes once per target in a row, not on every swing", () => {
    const battle = flung(pair, { IC8: 1 }, 110, { IC8: 3 });
    let splashes = 0;
    let swings = 0;
    for (let step = 0; step < 400 && !battle.over(); step += 1) {
      battle.step();
      for (const event of battle.recentEvents(battle.tick - 1)) {
        if (event.tick !== battle.tick) continue;
        if (event.kind === "splash") splashes += 1;
        if (event.kind === "hit") swings += 1;
      }
    }
    expect(swings).toBeGreaterThan(2);
    // It keeps striking the one harvester, so it splashes once.
    expect(splashes).toBe(1);
  });
});

