import { describe, expect, it } from "vitest";

import {
  CHAMPION_ABILITY_IDS,
  championAbilities,
  championMaxPower,
  powerForAbilities,
  stoneSkinCut,
  type ChampionAbilityId,
} from "./championAbilities.js";
import { championPower, fomorBuff } from "./champions.js";
import { createBattle, type BattleVisualEvent, type CreepSnapshot } from "./engine.js";
import { championStat } from "./stats.js";
import { buildEngineYard } from "./yard.js";
import type { CombatBuildingDataMap, Roster } from "./types.js";

/**
 * Gorgo's, Drull's and Fomor's abilities (Monster Madness redesign, 27 Nov
 * 2026): how many a power level holds, that none leaks to a champion that
 * has not unlocked it, and that each goes off attacking and defending.
 */

const yardOf = (buildings: CombatBuildingDataMap) =>
  buildEngineYard({
    buildingdata: buildings,
    buildinghealthdata: {},
    resources: { r1: 1_000_000, r2: 0, r3: 0, r4: 0 },
  });

type Battle = ReturnType<typeof createBattle>;

const TYPE: Readonly<Record<string, number>> = { G1: 1, G2: 2, G3: 3 };

/** Steps up to `ticks` times, handing every new visual event to `seen`; stops when it says so. */
const watch = (
  battle: Battle,
  ticks: number,
  seen: (event: BattleVisualEvent, battle: Battle) => boolean | void,
): void => {
  for (let step = 0; step < ticks && !battle.over(); step += 1) {
    const before = battle.tick;
    battle.step();
    for (const event of battle.recentEvents(before)) if (seen(event, battle) === true) return;
  }
};

const fling = (
  battle: Battle,
  at: number,
  monsters: Roster,
  champion?: { t: number; l: number; pl?: number; hp?: number },
) =>
  battle.apply({
    kind: "fling",
    t: 0,
    x: at,
    y: at,
    r: 60,
    monsters,
    ...(champion ? { champion } : {}),
  });

/** Cannon Towers round a Town Hall, harvesters further out: something to hit and shoot. */
const towerYard = () =>
  yardOf({
    "1": { id: 1, t: 14, l: 10, X: 400, Y: 400 },
    "2": { id: 2, t: 20, l: 4, X: 300, Y: 400 },
    "3": { id: 3, t: 20, l: 4, X: 400, Y: 300 },
    "4": { id: 4, t: 20, l: 4, X: 520, Y: 520 },
    "5": { id: 5, t: 1, l: 1, X: 900, Y: 200, st: 10_000 },
    "6": { id: 6, t: 1, l: 1, X: 200, Y: 900, st: 10_000 },
  });

/** A Champion Cage, a bunker of Pokeys and a Town Hall for the attackers to go for. */
const cageYard = () =>
  yardOf({
    "1": { id: 1, t: 114, l: 1, X: 0, Y: 0 },
    "2": { id: 2, t: 22, l: 1, X: 160, Y: 0 },
    "3": { id: 3, t: 14, l: 10, X: 160, Y: 160 },
  });

/** The first `ability` event of `ability` on the side asked for, within `ticks`. */
const firstAbility = (
  battle: Battle,
  ability: ChampionAbilityId,
  friendly: boolean,
  ticks: number,
  also: (battle: Battle) => void = () => {},
): Extract<BattleVisualEvent, { kind: "ability" }> | undefined => {
  let found: Extract<BattleVisualEvent, { kind: "ability" }> | undefined;
  watch(battle, ticks, (event, current) => {
    also(current);
    if (event.kind === "ability" && event.ability === ability && event.friendly === friendly) {
      found = event;
      return true;
    }
    return false;
  });
  return found;
};

const championOf = (battle: Battle, friendly: boolean): CreepSnapshot | undefined =>
  battle.creeps().find((creep) => creep.champion && creep.friendly === friendly);

/** An attack on {@link towerYard} with champion `id` holding all three abilities. */
const attack = (id: string, monsters: Roster = {}, hp?: number, at = 250): Battle => {
  const battle = createBattle(towerYard(), { seed: 3 });
  fling(battle, at, monsters, {
    t: TYPE[id]!,
    l: 6,
    pl: powerForAbilities(id, 3),
    ...(hp !== undefined ? { hp } : {}),
  });
  return battle;
};

/** {@link cageYard} defended by champion `id` with all three abilities, attacked by `monsters`. */
const defence = (id: string, monsters: Roster, hp?: number, at = 260): Battle => {
  const health = hp ?? championStat(id, "health", 6);
  const battle = createBattle(cageYard(), {
    seed: 4,
    levels: { C6: 6, C10: 6, C12: 6 },
    bunkers: { 2: { C1: 6 } },
    defenderChampions: [{ t: TYPE[id]!, l: 6, hp: health, pl: powerForAbilities(id, 3) }],
  });
  fling(battle, at, monsters);
  return battle;
};

describe("how many abilities a power level holds", () => {
  it("counts Gorgo, Drull and Fomor from the 1 they hatch at", () => {
    for (const id of ["G1", "G2", "G3"]) {
      expect(championAbilities(id, 0)).toBe(0);
      expect(championAbilities(id, 1)).toBe(0);
      expect(championAbilities(id, 2)).toBe(1);
      expect(championAbilities(id, 4)).toBe(3);
      expect(championAbilities(id, 9)).toBe(3);
      expect(championMaxPower(id)).toBe(4);
      expect(championPower(id, 9)).toBe(4);
      expect(powerForAbilities(id, 2)).toBe(3);
    }
  });

  it("counts Korath's from 0, his powers being his abilities, and gives Krallen none", () => {
    expect(championAbilities("G4", 2)).toBe(2);
    expect(championMaxPower("G4")).toBe(3);
    expect(championPower("G4", 4)).toBe(3);
    expect(championAbilities("G5", 2)).toBe(0);
    expect(championPower("G5", 3)).toBe(2);
  });

  it("names three for each new champion, none of them shared", () => {
    const all = Object.values(CHAMPION_ABILITY_IDS).flat();
    expect(all).toHaveLength(9);
    expect(new Set(all).size).toBe(9);
  });

  it("leaves a Fomor's rage as every live Fomor's, whatever his abilities", () => {
    for (let level = 1; level <= 6; level += 1) {
      const live = fomorBuff(level, 1);
      expect(live).toBeGreaterThan(championStat("G3", "buffs", level));
      for (const power of [2, 3, 4]) expect(fomorBuff(level, power)).toBe(live);
      expect(fomorBuff(level, 0)).toBe(championStat("G3", "buffs", level));
    }
  });
});

describe("no ability without its unlock", () => {
  /** Every visual event of a whole battle, and its last checkpoint. */
  const play = (id: string, pl: number) => {
    const battle = createBattle(towerYard(), { seed: 3 });
    fling(battle, 250, { C1: 6 }, { t: TYPE[id]!, l: 6, pl });
    const kinds: string[] = [];
    watch(battle, 2400, (event) => {
      kinds.push(event.kind);
    });
    return { kinds, checkpoint: battle.checkpoint() };
  };

  it("plays a champion at power 1 as at power 0, with no ability event", () => {
    for (const id of ["G1", "G2"]) {
      const zero = play(id, 0);
      const one = play(id, 1);
      expect(one.checkpoint).toEqual(zero.checkpoint);
      expect(one.kinds).not.toContain("ability");
    }
    expect(play("G3", 1).kinds).not.toContain("ability");
  });

  it("gives ability 1 alone at power 2", () => {
    // Drull at power 2: Bloodthirst, which has no event of its own (his
    // health climbs between blows), and neither Twin Bite nor Pounce.
    const battle = createBattle(towerYard(), { seed: 3 });
    fling(battle, 250, {}, { t: 2, l: 6, pl: 2, hp: championStat("G2", "health", 6) / 2 });
    const seen = new Set<string>();
    let healed = false;
    let last = -1;
    watch(battle, 2400, (event, current) => {
      if (event.kind === "ability") seen.add(event.ability);
      const drull = championOf(current, false);
      if (drull && last >= 0 && drull.hp > last + 0.5) healed = true;
      if (drull) last = drull.hp;
    });
    expect([...seen]).toEqual([]);
    expect(healed).toBe(true);
  });
});

describe("Gorgo", () => {
  const max = championStat("G1", "health", 6);

  it("turns to stone under half health, attacking and defending", () => {
    let stone = false;
    const battle = attack("G1", {}, max * 0.5 + 500);
    const event = firstAbility(battle, "stoneSkin", false, 4000);
    expect(event).toBeDefined();
    stone = championOf(battle, false)?.stone === true;
    expect(stone).toBe(true);
    expect(stoneSkinCut(6)).toBeCloseTo(0.6);
    const guarded = defence("G1", { C6: 10, C10: 10 }, max * 0.5 + 500);
    expect(firstAbility(guarded, "stoneSkin", true, 4000)).toBeDefined();
  });

  it("pounds his chest: towers shoot only him, and attackers turn on him", () => {
    const battle = attack("G1", { C1: 10 });
    const pound = firstAbility(battle, "chestPound", false, 400);
    expect(pound?.count).toBeGreaterThan(0);
    const gorgo = championOf(battle, false)!;
    const shotAt = new Set<number>();
    watch(battle, 200, (event) => {
      if (event.kind === "shot") shotAt.add(event.creepId);
    });
    expect([...shotAt]).toEqual([gorgo.id]);

    const guarded = defence("G1", { C1: 12 });
    const roar = firstAbility(guarded, "chestPound", true, 1200);
    expect(roar?.count).toBeGreaterThan(0);
    const cagedGorgo = championOf(guarded, true)!;
    expect(guarded.creeps().some((one) => !one.friendly && one.targetCreep === cagedGorgo.id)).toBe(
      true,
    );
  });

  it("slams the ground every 4th blow, stunning towers and attackers", () => {
    const battle = attack("G1");
    let stunnedTower = false;
    const slam = firstAbility(battle, "groundSlam", false, 4000, (current) => {
      if ((current.abilityMarks?.().stunned.length ?? 0) > 0) stunnedTower = true;
    });
    expect(slam).toBeDefined();
    battle.step();
    stunnedTower ||= (battle.abilityMarks?.().stunned.length ?? 0) > 0;
    expect(stunnedTower).toBe(true);

    const guarded = defence("G1", { C1: 20 });
    expect(firstAbility(guarded, "groundSlam", true, 4000)).toBeDefined();
    guarded.step();
    expect(guarded.creeps().some((one) => !one.friendly && one.stunned)).toBe(true);
  });
});

describe("Drull", () => {
  const max = championStat("G2", "health", 6);

  it("heals from his blows, attacking and defending", () => {
    for (const battle of [attack("G2", {}, max / 2), defence("G2", { C1: 30 }, max / 2)]) {
      let healed = false;
      let last = -1;
      watch(battle, 3000, (_event, current) => {
        const drull = current.creeps().find((one) => one.monsterId === "G2");
        if (drull && last >= 0 && drull.hp > last + 0.5) healed = true;
        if (drull) last = drull.hp;
      });
      expect(healed).toBe(true);
    }
  });

  it("bites with his second head every 3rd blow, attacking and defending", () => {
    expect(firstAbility(attack("G2"), "twinBite", false, 4000)?.count).toBeGreaterThan(0);
    expect(firstAbility(defence("G2", { C12: 4 }), "twinBite", true, 4000)?.count).toBeGreaterThan(
      0,
    );
  });

  it("pounces on a target far off, over the ground between, attacking and defending", () => {
    const battle = attack("G2", {}, undefined, 0);
    const leap = firstAbility(battle, "pounce", false, 2000);
    expect(leap?.toIx).toBeDefined();
    battle.step();
    expect(championOf(battle, false)?.leap).toBeGreaterThan(0);
    const guarded = defence("G2", { C1: 10 }, undefined, 500);
    expect(firstAbility(guarded, "pounce", true, 3000)).toBeDefined();
  });
});

describe("Fomor", () => {
  it("heals hurt allies in his ring, attacking and defending", () => {
    expect(firstAbility(attack("G3", { C1: 12 }), "healingMist", false, 3000)?.count).toBeGreaterThan(
      0,
    );
    expect(
      firstAbility(defence("G3", { C1: 30 }), "healingMist", true, 3000)?.count,
    ).toBeGreaterThan(0);
  });

  it("blows a bubble on the most hurt ally, attacking and defending", () => {
    const battle = attack("G3", { C1: 12 });
    expect(firstAbility(battle, "bubble", false, 3000)).toBeDefined();
    battle.step();
    expect(battle.creeps().some((one) => !one.friendly && (one.shield ?? 0) > 0)).toBe(true);
    expect(firstAbility(defence("G3", { C1: 30 }), "bubble", true, 3000)).toBeDefined();
  });

  it("marks what he shoots with acid, attacking and defending", () => {
    const battle = attack("G3", { C1: 6 });
    expect(firstAbility(battle, "acidSpit", false, 3000)).toBeDefined();
    battle.step();
    expect(battle.abilityMarks?.().marked.length).toBeGreaterThan(0);
    const guarded = defence("G3", { C1: 30 });
    expect(firstAbility(guarded, "acidSpit", true, 3000)).toBeDefined();
    guarded.step();
    expect(guarded.creeps().some((one) => !one.friendly && one.marked)).toBe(true);
  });
});
