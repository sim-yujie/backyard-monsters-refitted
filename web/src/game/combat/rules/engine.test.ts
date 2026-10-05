import { describe, expect, it } from "vitest";

import {
  addBunkerLoss,
  bucketCost,
  bunkerGarrisons,
  bunkerLossRecord,
  createBattle,
  dropRadius,
  flingCost,
  flingerPayload,
  scatterRadius,
  type BattleVisualEvent,
  type BunkerLossTally,
} from "./engine.js";
import { digestOf } from "./digest.js";
import {
  aerialSalvo,
  BOMBS,
  laserEnd,
  laserPulse,
  laserSweep,
  seriesCos,
  seriesSin,
  bombBlast,
  championStat,
  championStatWithPower,
  lootingMultiplier,
  maxHp,
  monsterStat,
  monsterTickSpeed,
  towerHealthScale,
  TARGET_GROUP,
} from "./stats.js";
import { buildEngineYard, reachesBuilding, screenDistanceSquared, screenPointOf } from "./yard.js";
import type { CombatBuildingDataMap } from "./types.js";

/**
 * The engine, one rule at a time.
 *
 * The golden replays in `replay.test.ts` prove that a whole battle reproduces;
 * they do not say *why* it came out the way it did. These do: one creep against
 * one tower with the arithmetic written out, a trap that fires once, loot that
 * follows damage, and the determinism property the digests rest on.
 */

const yardOf = (buildings: CombatBuildingDataMap, health?: Record<string, number>) =>
  buildEngineYard({
    buildingdata: buildings,
    buildinghealthdata: health ?? {},
    resources: { r1: 100000, r2: 0, r3: 0, r4: 0 },
  });

const run = (battle: ReturnType<typeof createBattle>, ticks: number): void => {
  for (let step = 0; step < ticks && !battle.over(); step += 1) battle.step();
};

describe("a Pokey against a lone Cannon Tower", () => {
  /**
   * Level 1 Cannon Tower: range 160, damage 20, rate 40, so a shot a second
   * (`rate * 2` fast ticks, `BTOWER.as:179`) and 6,000 health.
   * Level 1 Pokey: 200 health, 60 damage, 60-tick swing.
   */
  const battleOf = () => {
    const yard = yardOf({ "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 1 });
    battle.apply({ kind: "fling", t: 0, x: -100, y: -100, r: 200, monsters: { C1: 1 } });
    return { yard, battle };
  };

  it("kills it in eleven shots, at a shot a second", () => {
    const { battle } = battleOf();
    run(battle, 1200);
    const state = battle.state();
    const tower = state.towers[0];
    // Two shots of 20, then 19 once the Pokey has dented it (issue #264):
    // `int(20 * (0.5 + 0.5 * 5940 / 6000))`, and so on down to 8 for the last.
    expect(tower?.shots).toBe(11);
    expect(tower?.kills).toBe(1);
    expect(tower?.damageDealt).toBe(200);
    expect(state.creepsKilled).toBe(1);
  });

  it("takes a swing a second from the Pokey while it lives", () => {
    const { yard, battle } = battleOf();
    run(battle, 1200);
    const tower = yard.buildings[0];
    // 60 damage a swing, and the Pokey got eleven in before it died. It lands
    // within 50 screen pixels of (-100, -100) (issue #91), which with this
    // seed puts it at the tower in time for an eleventh swing.
    expect(tower!.maxHp - tower!.hp).toBe(660);
  });

  it("ends the battle once the last attacker is gone and the countdown has run", () => {
    const { battle } = battleOf();
    run(battle, 40000);
    expect(battle.over()).toBe(true);
  });
});

describe("a tower's shot at its own health (issue #264)", () => {
  /** One shot from a level 1 Cannon Tower (damage 20) at `hp`, at a lone Octo-ooze. */
  const firstHit = (hp?: number) => {
    const health = hp === undefined ? undefined : { "1": hp };
    const yard = yardOf({ "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } }, health);
    const battle = createBattle(yard, { seed: 1 });
    battle.apply({ kind: "fling", t: 0, x: -100, y: -100, r: 200, monsters: { C2: 1 } });
    for (let step = 0; step < 1200; step += 1) {
      battle.step();
      const hurt = battle.recentEvents(battle.tick - 1).find((event) => event.kind === "hurt");
      if (hurt?.kind === "hurt") return hurt.amount;
    }
    throw new Error("the tower never fired");
  };

  it("deals its whole damage at full health", () => {
    expect(firstHit()).toBe(20);
  });

  it("deals int(damage * (0.5 + 0.5 * hp / maxHp)) when hurt (`BUILDING20.as:27`, `:43`)", () => {
    const full = maxHp(20, 1);
    // 0.5 + 0.5 * 0.3 = 0.65 of 20 is 13; a tenth of its health is 0.55, 11.
    expect(firstHit(Math.round(full * 0.3))).toBe(13);
    expect(firstHit(Math.round(full * 0.1))).toBe(11);
  });
});

describe("traps", () => {
  /** The trap sits at the Town Hall's near corner, where the Pokeys arrive. */
  const trapYard = () =>
    yardOf({
      "1": { id: 1, t: 14, X: 400, Y: 400 },
      "2": { id: 2, t: 24, X: 380, Y: 380 },
    });

  it("fires once when a ground creep walks over it, and kills what it catches", () => {
    const yard = trapYard();
    const battle = createBattle(yard, { seed: 3 });
    battle.apply({ kind: "fling", t: 0, x: -60, y: -60, r: 40, monsters: { C1: 3 } });
    run(battle, 4000);
    const state = battle.state();
    expect(state.firedTraps).toEqual([2]);
    // A Booby Trap deals 1,000 over a 50-unit blast; a level 1 Pokey has 200.
    expect(state.creepsKilled).toBeGreaterThan(0);
    expect(yard.buildings.find((one) => one.id === 2)?.fired).toBe(true);
  });

  it("stays armed when nothing comes near it", () => {
    const yard = trapYard();
    const battle = createBattle(yard, { seed: 3 });
    battle.apply({ kind: "fling", t: 0, x: 900, y: 900, r: 40, monsters: { C1: 2 } });
    run(battle, 400);
    expect(battle.state().firedTraps).toEqual([]);
  });

  it("reports a fired trap as health 0, which is what the save carries", () => {
    const yard = trapYard();
    const battle = createBattle(yard, { seed: 3 });
    battle.apply({ kind: "fling", t: 0, x: -60, y: -60, r: 40, monsters: { C1: 3 } });
    run(battle, 4000);
    expect(battle.state().health["2"]).toBe(0);
  });

  describe("a Heavy Trap waits for something big (issue #259)", () => {
    /**
     * A Heavy Trap halfway along the walk to the Town Hall, which every one of
     * these passes within 20 of; a champion's longer reach stops it short of
     * the Booby Trap's corner.
     */
    const heavyYard = () =>
      yardOf({
        "1": { id: 1, t: 14, X: 400, Y: 400 },
        "2": { id: 2, t: 117, X: 200, Y: 200 },
      });
    type Drop = {
      monsters: Record<string, number>;
      champion?: { t: number; l: number };
    };
    const firedAfter = (drop: Drop): readonly number[] => {
      const battle = createBattle(heavyYard(), { seed: 3 });
      battle.apply({ kind: "fling", t: 0, x: -60, y: -60, r: 40, ...drop });
      run(battle, 4000);
      return battle.state().firedTraps;
    };

    it("lets a Pokey walk over it", () => {
      expect(firedAfter({ monsters: { C1: 3 } })).toEqual([]);
    });

    it("goes off under a Crabatron", () => {
      expect(firedAfter({ monsters: { C10: 1 } })).toEqual([2]);
    });

    it("goes off under a champion", () => {
      expect(firedAfter({ monsters: {}, champion: { t: 1, l: 1 } })).toEqual([2]);
    });

    it("hurts the flyers over it too, at half (`BHEAVYTRAP.as:68-82`)", () => {
      const battle = createBattle(heavyYard(), { seed: 3 });
      // A Crabatron lands on the trap with Teratorns over it.
      battle.apply({ kind: "fling", t: 0, x: 200, y: 200, r: 0, monsters: { C10: 1, C14: 4 } });
      const flyers = new Set(battle.creeps().filter((creep) => creep.flying).map((one) => one.id));
      expect(flyers.size).toBe(4);
      const hurt: number[] = [];
      for (let step = 0; step < 400 && battle.state().firedTraps.length === 0; step += 1) {
        battle.step();
        for (const event of battle.recentEvents(battle.tick - 1)) {
          if (event.kind === "hurt" && flyers.has(event.creepId)) hurt.push(event.amount);
        }
      }
      expect(battle.state().firedTraps).toEqual([2]);
      expect(hurt.length).toBeGreaterThan(0);
      // Half the ground falloff: between 2,500 at the blast's edge and 5,000 at its middle.
      for (const amount of hurt) {
        expect(amount).toBeGreaterThanOrEqual(Math.min(2500, monsterStat("C14", "health", 1)));
      }
    });
  });
});

describe("the Railgun's beam (issue #261)", () => {
  /**
   * A level 1 Railgun (400 damage, range 300) and a harvester beyond it, down
   * the screen. One Octo-ooze lands by the harvester, in range, and `far`
   * lands well behind it on the same line, walking in along it.
   */
  const railBattle = (far: Record<string, number>, health?: Record<string, number>) => {
    const yard = yardOf(
      {
        "1": { id: 1, t: 118, l: 1, X: 0, Y: 0 },
        "2": { id: 2, t: 1, l: 1, X: 200, Y: 200 },
      },
      health,
    );
    const battle = createBattle(yard, { seed: 3 });
    battle.apply({ kind: "fling", t: 0, x: 210, y: 210, r: 0, monsters: { C2: 1 } });
    battle.apply({ kind: "fling", t: 0, x: 600, y: 600, r: 0, monsters: far });
    return battle;
  };

  /** Steps to the Railgun's first shot: the shot, and the creeps it hurt that tick. */
  const firstShot = (battle: ReturnType<typeof createBattle>) => {
    for (let step = 0; step < 1000 && !battle.over(); step += 1) {
      battle.step();
      const events = battle.recentEvents(battle.tick - 1);
      const shot = events.find((event) => event.kind === "shot");
      if (shot?.kind !== "shot") continue;
      const hurt = new Map<number, number>();
      for (const event of events) if (event.kind === "hurt") hurt.set(event.creepId, event.amount);
      return { shot, hurt };
    }
    throw new Error("the Railgun never fired");
  };

  /** Screen px from a creep to the beam's line, and how far along it the creep is. */
  const offBeam = (
    beam: { fromIx: number; fromIy: number; toIx: number; toIy: number },
    creep: { ix: number; iy: number },
  ) => {
    const from = screenPointOf(beam.fromIx, beam.fromIy);
    const to = screenPointOf(beam.toIx, beam.toIy);
    const at = screenPointOf(creep.ix, creep.iy);
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const ux = (to.x - from.x) / length;
    const uy = (to.y - from.y) / length;
    return {
      across: Math.abs((at.x - from.x) * uy - (at.y - from.y) * ux),
      along: (at.x - from.x) * ux + (at.y - from.y) * uy,
    };
  };

  it("runs 1,600 screen px from its muzzle, through its target and on", () => {
    const { shot } = firstShot(railBattle({ C2: 10 }));
    const beam = shot.beam!;
    const from = screenPointOf(beam.fromIx, beam.fromIy);
    const to = screenPointOf(beam.toIx, beam.toIy);
    // The anchor plus `_top`, 15 px down the screen (`BUILDING118.as:39`, `:146`).
    expect(from.x).toBeCloseTo(0, 9);
    expect(from.y).toBeCloseTo(15, 9);
    expect(Math.hypot(to.x - from.x, to.y - from.y)).toBeCloseTo(1600, 6);
    expect(offBeam(beam, shot).across).toBeLessThan(1);
  });

  it("hurts every ground creep on its line, past its target too, and none off it", () => {
    const battle = railBattle({ C2: 10 });
    const { shot, hurt } = firstShot(battle);
    const beam = shot.beam!;
    const aimedAlong = offBeam(beam, shot).along;
    let beyond = 0;
    for (const creep of battle.creeps()) {
      const { across, along } = offBeam(beam, creep);
      expect(hurt.has(creep.id), `creep ${creep.id} at ${across.toFixed(1)} px`).toBe(across < 20);
      if (hurt.has(creep.id) && along > aimedAlong + 50) beyond += 1;
    }
    expect(hurt.size).toBeGreaterThanOrEqual(3);
    expect(beyond).toBeGreaterThanOrEqual(2);
    // One shot's damage apiece, from a Railgun at full health.
    for (const amount of hurt.values()) expect(amount).toBe(400);
  });

  it("never hurts a flyer on its line (`BUILDING118.as:44`)", () => {
    const battle = railBattle({ C14: 10 });
    const { shot, hurt } = firstShot(battle);
    const flyersOnLine = battle
      .creeps()
      .filter((creep) => creep.flying && offBeam(shot.beam!, creep).across < 20);
    expect(flyersOnLine.length).toBeGreaterThan(0);
    expect([...hurt.keys()]).toEqual([shot.creepId]);
  });

  it("deals 0.5 + 0.5 of its health share of its damage (`BUILDING118.as:133`)", () => {
    const full = maxHp(118, 1);
    const hp = Math.round(full * 0.3);
    const { shot, hurt } = firstShot(railBattle({}, { "1": hp }));
    expect(towerHealthScale(hp, full)).toBeCloseTo(0.65, 3);
    // The beam's damage is not truncated, unlike every other tower's shot.
    expect(hurt.get(shot.creepId)).toBeCloseTo(400 * towerHealthScale(hp, full), 9);
    expect(hurt.get(shot.creepId)).toBeLessThan(400);
  });
});

describe("the Aerial Defense Tower's salvo (issue #265)", () => {
  /**
   * A level 3 Aerial Defense Tower (250 damage, range 340, rate 60, salvo 6)
   * and a harvester beside it, where `flyers` land and hover.
   */
  const salvoBattle = (flyers: Record<string, number>, health?: Record<string, number>) => {
    const yard = yardOf(
      {
        "1": { id: 1, t: 115, l: 3, X: 0, Y: 0 },
        "2": { id: 2, t: 1, l: 1, X: 100, Y: 100 },
      },
      health,
    );
    const battle = createBattle(yard, { seed: 5 });
    battle.apply({ kind: "fling", t: 0, x: 110, y: 110, r: 0, monsters: flyers });
    return battle;
  };

  /** Every shot over `ticks`, with its tick and its target. */
  const shotsOver = (battle: ReturnType<typeof createBattle>, ticks: number) => {
    const shots: { tick: number; creepId: number }[] = [];
    for (let step = 0; step < ticks && !battle.over(); step += 1) {
      battle.step();
      for (const event of battle.recentEvents(battle.tick - 1)) {
        if (event.kind === "shot") shots.push({ tick: event.tick, creepId: event.creepId });
      }
    }
    return shots;
  };

  /** Shots grouped into salvoes: a gap over four ticks starts a new one. */
  const salvoesOf = (shots: readonly { tick: number; creepId: number }[]) => {
    const salvoes: { tick: number; creepId: number }[][] = [];
    for (const shot of shots) {
      const last = salvoes.at(-1);
      const previous = last?.at(-1);
      if (last && previous && shot.tick - previous.tick <= 4) last.push(shot);
      else salvoes.push([shot]);
    }
    return salvoes;
  };

  it("salvoes 4, 4, 6, 8, 10, 12, 14 and 16 shots by level (`BUILDING115.as:27`)", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(aerialSalvo)).toEqual([4, 4, 6, 8, 10, 12, 14, 16]);
    expect(aerialSalvo(9)).toBe(16);
  });

  it("fires its salvo a shot every 4 ticks, through as many targets in turn", () => {
    const shots = shotsOver(salvoBattle({ C14: 8 }), 100);
    const first = salvoesOf(shots)[0]!;
    expect(first).toHaveLength(6);
    for (let index = 1; index < first.length; index += 1) {
      expect(first[index]!.tick - first[index - 1]!.tick).toBe(4);
    }
    // Six nearest flyers, one shot each.
    expect(new Set(first.map((shot) => shot.creepId)).size).toBe(6);
  });

  it("puts every shot of a salvo into one flyer when it is the only one", () => {
    const shots = shotsOver(salvoBattle({ C15: 1 }), 100);
    const first = salvoesOf(shots)[0]!;
    expect(first).toHaveLength(6);
    expect(new Set(first.map((shot) => shot.creepId)).size).toBe(1);
  });

  it("reloads 30 ticks after finding its targets, then rate * 2 while it keeps them", () => {
    // Healers, 8,000 health apiece, outlive three salvoes.
    const salvoes = salvoesOf(shotsOver(salvoBattle({ C15: 8 }), 500));
    expect(salvoes.length).toBeGreaterThanOrEqual(3);
    const gap = (one: number) => salvoes[one + 1]![0]!.tick - salvoes[one]!.at(-1)!.tick;
    // The reload runs from the tick after the last shot; the next shot waits for a frame of 4.
    expect(gap(0)).toBeGreaterThanOrEqual(31);
    expect(gap(0)).toBeLessThanOrEqual(34);
    expect(gap(1)).toBeGreaterThanOrEqual(121);
    expect(gap(1)).toBeLessThanOrEqual(124);
  });

  it("deals every shell's whole damage with the blast round it", () => {
    const battle = salvoBattle({ C15: 2 });
    for (let step = 0; step < 200 && !battle.over(); step += 1) {
      battle.step();
      const events = battle.recentEvents(battle.tick - 1);
      const shot = events.find((event) => event.kind === "shot");
      if (shot?.kind !== "shot") continue;
      const hurt = events.filter((event) => event.kind === "hurt");
      // The target takes the shell; the flyer beside it, the blast's near-full share.
      expect(hurt.find((event) => event.creepId === shot.creepId)?.amount).toBe(250);
      expect(hurt).toHaveLength(2);
      return;
    }
    throw new Error("the tower never fired");
  });
});

describe("the Tesla Tower's charge and zaps (issue #266)", () => {
  /**
   * A level 1 Tesla Tower (100 damage, 10 zaps a charge, range 250) and a
   * harvester beside it, where `monsters` land.
   */
  const teslaBattle = (monsters: Record<string, number>) => {
    const yard = yardOf({
      "1": { id: 1, t: 25, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 1, l: 1, X: 100, Y: 100 },
    });
    const battle = createBattle(yard, { seed: 7 });
    battle.apply({ kind: "fling", t: 0, x: 110, y: 110, r: 0, monsters });
    return battle;
  };

  /** The tower's charges and zaps over `ticks`, with what each zap took. */
  const timeline = (battle: ReturnType<typeof createBattle>, ticks: number) => {
    const charges: number[] = [];
    const zaps: { tick: number; creepId: number; amount: number }[] = [];
    for (let step = 0; step < ticks && !battle.over(); step += 1) {
      battle.step();
      const events = battle.recentEvents(battle.tick - 1);
      for (const event of events) {
        if (event.kind === "charge") charges.push(event.tick);
        if (event.kind !== "shot") continue;
        const hurt = events.find((one) => one.kind === "hurt" && one.creepId === event.creepId);
        zaps.push({
          tick: event.tick,
          creepId: event.creepId,
          amount: hurt?.kind === "hurt" ? hurt.amount : 0,
        });
      }
    }
    return { charges, zaps };
  };

  it("charges 32 frames, then zaps rate times a frame in four, each of its whole damage", () => {
    const { charges, zaps } = timeline(teslaBattle({ C15: 1 }), 400);
    const first = charges[0]!;
    const charge = zaps.filter((zap) => zap.tick > first && zap.tick < (charges[1] ?? Infinity));
    expect(charge).toHaveLength(10);
    // 32 frames of two ticks, then the next frame of four.
    expect(charge[0]!.tick - first).toBeGreaterThanOrEqual(64);
    expect(charge[0]!.tick - first).toBeLessThan(72);
    for (let index = 1; index < charge.length; index += 1) {
      expect(charge[index]!.tick - charge[index - 1]!.tick).toBe(8);
    }
    for (const zap of charge) expect(zap.amount).toBe(100);
  });

  it("winds down before it charges again", () => {
    const { charges, zaps } = timeline(teslaBattle({ C15: 1 }), 700);
    expect(charges.length).toBeGreaterThanOrEqual(2);
    const lastZap = zaps.filter((zap) => zap.tick < charges[1]!).at(-1)!;
    // A cell every second frame from the loop's 32-40 to 55: 60 to 92 ticks,
    // then up to `rate * 2` for the next `Fire`.
    expect(charges[1]! - lastZap.tick).toBeGreaterThanOrEqual(60);
    expect(charges[1]! - lastZap.tick).toBeLessThanOrEqual(92 + 20);
  });

  it("kills a clump of Pokeys, a charge at a time", () => {
    const battle = teslaBattle({ C1: 4 });
    const { zaps } = timeline(battle, 1200);
    expect(zaps.length).toBeGreaterThan(0);
    // A level 1 Pokey has 200 health: two zaps apiece.
    expect(battle.state().towers[0]?.kills).toBe(4);
  });
});

describe("the Laser Tower's sweeping beam (issue #267)", () => {
  /**
   * A level 1 Laser Tower (120 damage, range 160, splash 40) and a Town Hall
   * beside it that ten Pokeys walk up to and stand at.
   */
  const laserBattle = () => {
    const yard = yardOf({
      "1": { id: 1, t: 23, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 14, l: 1, X: 120, Y: 0 },
    });
    const battle = createBattle(yard, { seed: 11 });
    battle.apply({ kind: "fling", t: 0, x: 260, y: 40, r: 20, monsters: { C1: 10 } });
    return battle;
  };

  /** The tower's shots and every hurt over `ticks`. */
  const record = (battle: ReturnType<typeof createBattle>, ticks: number) => {
    const shots: Extract<BattleVisualEvent, { kind: "shot" }>[] = [];
    const hurts: Extract<BattleVisualEvent, { kind: "hurt" }>[] = [];
    for (let step = 0; step < ticks && !battle.over(); step += 1) {
      battle.step();
      for (const event of battle.recentEvents(battle.tick - 1)) {
        if (event.kind === "shot") shots.push(event);
        if (event.kind === "hurt") hurts.push(event);
      }
    }
    return { shots, hurts };
  };

  it("fires from 35 px below its anchor at the target's point, and hurts nothing then", () => {
    const { shots, hurts } = record(laserBattle(), 600);
    const shot = shots[0]!;
    const sweep = shot.sweep!;
    const from = screenPointOf(sweep.fromIx, sweep.fromIy);
    const to = screenPointOf(sweep.toIx, sweep.toIy);
    expect(from.x).toBeCloseTo(0, 9);
    expect(from.y).toBeCloseTo(35, 9);
    const aimed = screenPointOf(shot.ix, shot.iy);
    expect(to.x).toBe(Math.trunc(aimed.x));
    expect(to.y).toBe(Math.trunc(aimed.y));
    expect(hurts.filter((hurt) => hurt.tick === shot.tick)).toHaveLength(0);
  });

  it("pulses every 8 ticks for 101 ticks, half its damage at most, falling off with distance", () => {
    const { shots, hurts } = record(laserBattle(), 600);
    const shot = shots[0]!;
    const next = shots[1]?.tick ?? Infinity;
    const pulses = [...new Set(hurts.filter((hurt) => hurt.tick < next).map((hurt) => hurt.tick))];
    expect(pulses.length).toBeGreaterThan(3);
    expect(pulses.length).toBeLessThanOrEqual(13);
    for (const tick of pulses) {
      expect(tick).toBeGreaterThan(shot.tick);
      expect(tick).toBeLessThanOrEqual(shot.tick + 101);
      expect((tick - shot.tick - 1) % 8).toBe(0);
    }
    for (const hurt of hurts.filter((one) => one.tick < next)) {
      expect(hurt.amount).toBeGreaterThan(0);
      expect(hurt.amount).toBeLessThanOrEqual(60);
    }
    // More than one Pokey under the beam at a time: a pulse is a splash.
    const most = Math.max(...pulses.map((tick) => hurts.filter((hurt) => hurt.tick === tick).length));
    expect(most).toBeGreaterThan(1);
  });

  it("deals what the old single hit never could: the clump falls to its beams", () => {
    const battle = laserBattle();
    run(battle, 2400);
    const tower = battle.state().towers[0]!;
    expect(tower.kills).toBeGreaterThan(0);
    // Each beam pulses up to 13 times at up to 60 a creep.
    expect(tower.damageDealt / tower.shots).toBeGreaterThan(120);
  });
});

describe("the laser's sweep (`LASER.as:53-106`)", () => {
  it("starts 150 / sqrt(distance) degrees short of its target and crosses it 75 ticks in", () => {
    const sweep = laserSweep(0, 35, 100, 135);
    expect(sweep.distance).toBe(141);
    const bearing = Math.atan2(100, 100);
    const at = (duration: number) => {
      const end = laserEnd(sweep, duration)!;
      return Math.atan2(end.y - 35, end.x);
    };
    const degrees = 180 / Math.PI;
    expect((at(0) - bearing) * degrees).toBeCloseTo(-150 / Math.sqrt(141), 9);
    expect((at(75) - bearing) * degrees).toBeCloseTo(0, 9);
    expect((at(101) - bearing) * degrees).toBeCloseTo(52 / Math.sqrt(141), 9);
    // The length wobbles by a twentieth, `sin(duration / 80)` of it with the clock at 0.
    const end = laserEnd(sweep, 75)!;
    expect(Math.hypot(end.x, end.y - 35)).toBeCloseTo(141 * (1 + Math.sin(75 / 80) / 20), 9);
  });

  it("has no end when it is fired at its own origin", () => {
    expect(laserEnd(laserSweep(5, 5, 5, 5), 10)).toBeNull();
  });

  it("pulses half its damage at the end, falling to nothing at the splash's edge", () => {
    expect(laserPulse(120, 40, 0)).toBe(60);
    expect(laserPulse(120, 40, 20)).toBe(30);
    expect(laserPulse(120, 40, 40)).toBe(0);
  });

  it("takes sine and cosine by series, within a few ulp of Math's", () => {
    for (let x = -3; x <= 3; x += 0.01) {
      expect(Math.abs(seriesSin(x) - Math.sin(x))).toBeLessThan(1e-14);
      expect(Math.abs(seriesCos(x) - Math.cos(x))).toBeLessThan(1e-14);
    }
  });
});

describe("a creep's reach is a circle on screen (issue #85)", () => {
  /** The screen directions a reach used to stretch or squash. */
  const DIRECTIONS: ReadonlyArray<readonly [string, number, number]> = [
    ["east", 1, 0],
    ["west", -1, 0],
    ["south", 0, 1],
    ["north", 0, -1],
    ["along yard X", 2 / Math.sqrt(5), 1 / Math.sqrt(5)],
    ["along yard Y", -2 / Math.sqrt(5), 1 / Math.sqrt(5)],
  ];

  /** The yard point `away` screen pixels from a building's drawn anchor. */
  const offAnchor = (sx: number, sy: number, ux: number, uy: number, away: number) => {
    const screenX = sx + ux * away;
    const screenY = sy + uy * away;
    return { x: screenX * 0.5 + screenY, y: screenY - screenX * 0.5 };
  };

  it("reaches Krallen's range in screen pixels, the same in every direction", () => {
    const yard = buildEngineYard({ buildingdata: { "1": { id: 1, t: 1, X: 100, Y: 60 } } });
    const building = yard.buildings[0]!;
    // Krallen's range by level, which `CHAMPIONCAGE.as:236` gives in screen pixels.
    const ranges = [1, 2, 3, 4, 5].map((level) => championStat("G5", "range", level));
    expect(ranges).toEqual([35, 45, 55, 60, 65]);
    for (const range of ranges) {
      for (const [name, ux, uy] of DIRECTIONS) {
        const inside = offAnchor(building.sx, building.sy, ux, uy, range - 0.05);
        const outside = offAnchor(building.sx, building.sy, ux, uy, range + 0.05);
        expect(reachesBuilding(inside.x, inside.y, building, range), `${name} ${range}`).toBe(true);
        expect(reachesBuilding(outside.x, outside.y, building, range), `${name} ${range}`).toBe(
          false,
        );
      }
    }
  });

  it("measures creep to creep on screen too", () => {
    for (const [, ux, uy] of DIRECTIONS) {
      const at = offAnchor(0, 0, ux, uy, 50);
      expect(screenDistanceSquared(at.x, at.y, 0, 0)).toBeCloseTo(2500, 6);
    }
  });

  it("stops a level 5 Krallen walking in from the north 65 px from the anchor", () => {
    const yard = yardOf({ "1": { id: 1, t: 1, X: 100, Y: 100 } });
    const building = yard.buildings[0]!;
    const battle = createBattle(yard, { seed: 21 });
    // 400 px straight up the screen from the building's top corner.
    const drop = offAnchor(building.sx, building.sy, 0, -1, 400);
    battle.apply({ kind: "fling", t: 0, ...drop, r: 100, monsters: {}, champion: { t: 5, l: 5 } });
    const speed = championStat("G5", "speed", 5) / 4;
    let stoppedAt = -1;
    for (let step = 0; step < 4000 && stoppedAt < 0; step += 1) {
      battle.step();
      const krallen = battle.creeps()[0]!;
      if (krallen.state !== "attacking") continue;
      const at = { x: krallen.ix - krallen.iy, y: (krallen.ix + krallen.iy) / 2 };
      stoppedAt = Math.hypot(at.x - building.sx, at.y - building.sy);
    }
    expect(stoppedAt).toBeLessThanOrEqual(65);
    expect(stoppedAt).toBeGreaterThan(65 - 2 * speed);
  });
});

describe("walking speed (issue #86)", () => {
  it("covers the same screen distance a tick whichever way a creep walks", () => {
    // Flash moves `_tmpPoint` by `speed` screen px a tick (`CreepBase.as:1679`).
    const speed = monsterTickSpeed("C1", 1);
    const lengths: number[] = [];
    let across = 0;
    let down = 0;
    // One Pokey from each side of a lone Town Hall: they walk every way there is.
    for (const [x, y] of [
      [-500, -500],
      [900, 900],
      [700, -300],
      [-300, 700],
      [900, 0],
      [0, -500],
    ] as const) {
      const yard = yardOf({ "1": { id: 1, t: 14, X: 200, Y: 200 } });
      const battle = createBattle(yard, { seed: 5 });
      battle.apply({ kind: "fling", t: 0, x, y, r: 100, monsters: { C1: 1 } });
      battle.step();
      let before = battle.creeps()[0]!;
      for (let step = 0; step < 3000; step += 1) {
        battle.step();
        const now = battle.creeps()[0];
        if (!now || now.state === "attacking") break;
        const dx = now.ix - before.ix;
        const dy = now.iy - before.iy;
        const screenX = dx - dy;
        const screenY = (dx + dy) / 2;
        const length = Math.hypot(screenX, screenY);
        if (length > 0) {
          lengths.push(length);
          if (Math.abs(screenX) > 2 * Math.abs(screenY)) across += 1;
          if (Math.abs(screenY) > 2 * Math.abs(screenX)) down += 1;
        }
        before = now;
      }
    }
    // Plenty of steps mostly across the screen and plenty mostly down it.
    expect(across).toBeGreaterThan(100);
    expect(down).toBeGreaterThan(100);
    for (const length of lengths) expect(length).toBeCloseTo(speed, 9);
  });
});

describe("loot", () => {
  it("draws a harvester's buffer as the damage lands", () => {
    const yard = yardOf({
      "1": { id: 1, t: 1, X: 0, Y: 0, st: 400 },
    });
    const battle = createBattle(yard, { seed: 11, playerLevel: 20 });
    battle.apply({ kind: "fling", t: 0, x: -60, y: -60, r: 40, monsters: { C4: 4 } });
    run(battle, 4000);
    const state = battle.state();
    // A point of damage is a unit of resource, capped by what the buffer held.
    expect(state.defenderLoss.r1).toBe(400);
    expect(state.loot.r1).toBe(400);
    expect(yard.buildings[0]?.looted).toBe(true);
  });

  it("sends a resource specialist at a Storage Silo before a farther full harvester (issue #225)", () => {
    const yard = yardOf({
      "1": { id: 1, t: 6, X: 0, Y: 0 },
      "2": { id: 2, t: 1, X: 600, Y: 0, st: 400 },
    });
    const battle = createBattle(yard, { seed: 11, playerLevel: 20 });
    battle.apply({ kind: "fling", t: 0, x: -60, y: -60, r: 40, monsters: { C3: 1 } });
    run(battle, 600);
    const [silo, harvester] = yard.buildings;
    expect(silo!.hp).toBeLessThan(silo!.maxHp);
    expect(harvester!.hp).toBe(harvester!.maxHp);
    expect(battle.state().defenderLoss.r1).toBeGreaterThan(0);
  });

  it("gives a low-level attacker the `ATTACK.Loot` bonus, gain by gain", () => {
    // Level 8, so the buffer runs dry before the harvester falls.
    const yard = yardOf({ "1": { id: 1, l: 8, t: 1, X: 0, Y: 0, st: 400 } });
    const battle = createBattle(yard, { seed: 11, playerLevel: 1 });
    battle.apply({ kind: "fling", t: 0, x: -60, y: -60, r: 40, monsters: { C4: 1 } });
    run(battle, 4000);
    // A Fink's 300 a swing draws 150, 150, then the last 100. `+ (20 - 1) * 3%`
    // is `+57%`, which is where `LOOT_GAIN_RATIO` comes from, and each gain
    // truncates on its own: 235, 235, 157.
    expect(battle.state().defenderLoss.r1).toBe(400);
    expect(battle.state().loot.r1).toBe(235 + 235 + 157);
  });

  /**
   * One attacker alone against one level 8 building, until it has landed three
   * swings. The building outlasts them: a fall would hand over the rest of its
   * buffer at no multiplier.
   */
  const threeSwings = (
    attacker: { monsters?: Record<string, number>; champion?: { t: number; l: number } },
    building: { t: number; st?: number },
  ) => {
    const yard = yardOf({ "1": { id: 1, l: 8, X: 0, Y: 0, ...building } });
    const battle = createBattle(yard, { seed: 9, playerLevel: 20 });
    battle.apply({
      kind: "fling",
      t: 0,
      x: -150,
      y: -150,
      r: 100,
      monsters: attacker.monsters ?? {},
      ...(attacker.champion ? { champion: attacker.champion } : {}),
    });
    const amounts: number[] = [];
    let seen = 0;
    for (let step = 0; step < 8000 && amounts.length < 3; step += 1) {
      battle.step();
      for (const event of battle.recentEvents(seen)) {
        if (event.kind === "hit" && event.amount > 0) amounts.push(event.amount);
      }
      seen = battle.tick;
    }
    const state = battle.state();
    expect(amounts).toHaveLength(3);
    expect(yard.buildings[0]!.hp).toBeGreaterThan(0);
    return { amounts, loss: state.defenderLoss.r1, loot: state.loot.r1 };
  };

  /**
   * The looting multiplier (issue #178): `Loot(damage * lootingMultiplier)`
   * (`BFOUNDATION.as:528-534`) on an `int`, then from a silo the main yard's
   * nine tenths, truncated again (`BSTORAGE.as:56-88`).
   */
  const expectLootsAt = (
    multiplier: number,
    attacker: Parameters<typeof threeSwings>[0],
    label: string,
  ) => {
    const harvester = threeSwings(attacker, { t: 1, st: 1_000_000 });
    const drawn = harvester.amounts.map((amount) => Math.trunc(amount * multiplier));
    const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
    expect(harvester.loss, `${label} harvester`).toBe(sum(drawn));
    expect(harvester.loot, `${label} harvester`).toBe(sum(drawn));

    const silo = threeSwings(attacker, { t: 6 });
    const taken = silo.amounts.map((amount) => Math.trunc(amount * multiplier));
    expect(silo.loss, `${label} silo`).toBe(sum(taken));
    expect(silo.loot, `${label} silo`).toBe(sum(taken.map((one) => Math.trunc(one * 0.9))));
  };

  it("loots at 0.5 with an ordinary creep (`MonsterBase.as:260`)", () => {
    expect(lootingMultiplier(TARGET_GROUP.ALL, false)).toBe(0.5);
    // A Pokey (C1) and a Fink (C4), both group 1.
    for (const id of ["C1", "C4"]) expectLootsAt(0.5, { monsters: { [id]: 1 } }, id);
  });

  it("loots at 2 with a resource specialist (`CreepBase.as:224-226`)", () => {
    expect(lootingMultiplier(TARGET_GROUP.RESOURCES, false)).toBe(2);
    for (const id of ["C3", "C9", "IC3", "IC6"]) {
      expect(monsterStat(id, "targetGroup", 1), id).toBe(TARGET_GROUP.RESOURCES);
    }
    expectLootsAt(2, { monsters: { C3: 1 } }, "C3");
    expectLootsAt(2, { monsters: { C9: 1 } }, "C9");
  });

  it("loots at 2 with every champion, Krallen too: her `_lootMults` is never read", () => {
    // `ChampionBase.as:221`; `champions/Krallen.as:31-32` sets x2/x3 that no
    // code reads, so the x2/x3 of issue #80 is gone (issue #178).
    for (const type of [1, 2, 4, 5]) {
      expectLootsAt(2, { champion: { t: type, l: 1 } }, `G${type}`);
    }
  });

  it("loots at 1 with Fomor, whose fireball lands as a DummyTarget (issue #222)", () => {
    // `Fomor.as:149`, `FIREBALL.as:165`, `BFOUNDATION.as:528-533`.
    expectLootsAt(1, { champion: { t: 3, l: 1 } }, "G3");
  });

  /** Every hit's damage on one building, in order, until `steps` ticks have run. */
  const hitsOn = (battle: ReturnType<typeof createBattle>, steps: number): number[] => {
    const amounts: number[] = [];
    let seen = 0;
    for (let step = 0; step < steps && !battle.over(); step += 1) {
      battle.step();
      for (const event of battle.recentEvents(seen)) {
        if (event.kind === "hit" && event.amount > 0) amounts.push(event.amount);
      }
      seen = battle.tick;
    }
    return amounts;
  };

  it("scales a main yard's storage draw by nine tenths, truncating each step", () => {
    // Level 8, so the silo outlasts the swings and no fall is mixed in.
    const yard = yardOf({ "1": { id: 1, t: 6, l: 8, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 11, playerLevel: 20 });
    battle.apply({ kind: "fling", t: 0, x: -60, y: -60, r: 40, monsters: { C4: 6 } });
    const hits = hitsOn(battle, 1200);
    expect(yard.buildings[0]!.hp).toBeGreaterThan(0);
    expect(hits.length).toBeGreaterThan(0);
    const state = battle.state();
    // `Loot(param1:int)` of a Fink's half, then `_loc2_ *= 0.9` on an int
    // (`BSTORAGE.as:56-88`).
    const lost = hits.reduce((sum, hit) => sum + Math.trunc(hit * 0.5), 0);
    const got = hits.reduce((sum, hit) => sum + Math.trunc(Math.trunc(hit * 0.5) * 0.9), 0);
    expect(state.defenderLoss.r1).toBe(lost);
    expect(state.loot.r1).toBe(got);
  });

  /**
   * `BSTORAGE.as:77-85`: half on a Map Room 2 wild monster camp (Flash's
   * `baseType == EnumYardType.OUTPOST` reads the cell's `_base`, whose 1 is a
   * camp), nine tenths anywhere else, a player's outpost included, then a
   * fifth in any wild monster attack, Map Room 1's tribes too.
   */
  it.each([
    ["main", 0.9, 1],
    ["outpost", 0.9, 1],
    ["wild", 0.5, 5],
    ["tribe", 0.9, 5],
  ] as const)("scales a storage draw on a %s yard by %s, then divides by %s", (kind, scalar, divisor) => {
    const yard = buildEngineYard({
      buildingdata: { "1": { id: 1, t: 6, l: 8, X: 0, Y: 0 } },
      buildinghealthdata: {},
      resources: { r1: 100000, r2: 0, r3: 0, r4: 0 },
      kind,
    });
    const battle = createBattle(yard, { seed: 11, playerLevel: 20 });
    battle.apply({ kind: "fling", t: 0, x: -60, y: -60, r: 40, monsters: { C4: 6 } });
    const hits = hitsOn(battle, 1200);
    expect(yard.buildings[0]!.hp).toBeGreaterThan(0);
    expect(hits.length).toBeGreaterThan(0);
    const state = battle.state();
    expect(state.loot.r1).toBeGreaterThan(0);
    const got = hits.reduce(
      (sum, hit) => sum + Math.trunc(Math.trunc(Math.trunc(hit * 0.5) * scalar) / divisor),
      0,
    );
    expect(state.defenderLoss.r1).toBe(hits.reduce((sum, hit) => sum + Math.trunc(hit * 0.5), 0));
    expect(state.loot.r1).toBe(got);
  });
});

/**
 * `BSTORAGE.Destroyed` (issue #167). Each yard's storage building is on 1
 * health, so the first swing fells it and every unit that moves is the fall's.
 */
describe("a storage building's fall", () => {
  const fell = (
    type: number,
    options: {
      kind?: "main" | "outpost" | "wild" | "tribe";
      playerLevel?: number;
      resources?: { r1: number; r2: number; r3: number; r4: number };
    } = {},
  ) => {
    const yard = buildEngineYard({
      buildingdata: { "1": { id: 1, t: type, l: 1, X: 0, Y: 0 } },
      buildinghealthdata: { "1": 1 },
      resources: options.resources ?? { r1: 100_000, r2: 0, r3: 0, r4: 0 },
      kind: options.kind ?? "main",
    });
    const battle = createBattle(yard, { seed: 11, playerLevel: options.playerLevel ?? 20 });
    battle.apply({ kind: "fling", t: 0, x: -60, y: -60, r: 40, monsters: { C4: 1 } });
    run(battle, 4000);
    expect(yard.buildings[0]!.hp).toBe(0);
    return battle.state();
  };

  it("hands over a tenth of the pool for a Town Hall, and the killing hit draws nothing of its own", () => {
    const state = fell(14);
    expect(state.defenderLoss).toEqual({ r1: 10_000, r2: 0, r3: 0, r4: 0 });
    expect(state.loot).toEqual({ r1: 10_000, r2: 0, r3: 0, r4: 0 });
  });

  it("hands over a twenty-fifth for a silo", () => {
    expect(fell(6).loot.r1).toBe(4_000);
  });

  it("takes every resource in turn, goo halved", () => {
    const state = fell(14, { resources: { r1: 13_000_000, r2: 13_000_000, r3: 13_000_000, r4: 2_500_000 } });
    expect(state.defenderLoss).toEqual({ r1: 1_300_000, r2: 1_300_000, r3: 1_300_000, r4: 125_000 });
    expect(state.loot).toEqual(state.defenderLoss);
  });

  it("is not cut to a fifth on a wild monster camp, nor to nine tenths anywhere", () => {
    for (const kind of ["main", "outpost", "wild", "tribe"] as const) {
      expect(fell(14, { kind }).loot.r1, kind).toBe(10_000);
    }
  });

  /**
   * `BSTORAGE.as:111`, `:117`: the lower caps test the cell's `_base` against
   * `EnumYardType.OUTPOST`, which is 1, a Map Room 2 wild monster camp. A
   * player's outpost (3) and a Map Room 1 tribe keep the full caps.
   */
  it("caps a silo at 500,000 and a Town Hall at 2,000,000 on a Map Room 2 wild monster camp only", () => {
    const resources = { r1: 100_000_000, r2: 0, r3: 0, r4: 0 };
    expect(fell(6, { resources }).loot.r1).toBe(4_000_000);
    expect(fell(6, { kind: "outpost", resources }).loot.r1).toBe(4_000_000);
    expect(fell(6, { kind: "tribe", resources }).loot.r1).toBe(4_000_000);
    expect(fell(6, { kind: "wild", resources }).loot.r1).toBe(500_000);
    expect(fell(14, { resources }).loot.r1).toBe(10_000_000);
    expect(fell(14, { kind: "outpost", resources }).loot.r1).toBe(10_000_000);
    expect(fell(14, { kind: "tribe", resources }).loot.r1).toBe(10_000_000);
    expect(fell(14, { kind: "wild", resources }).loot.r1).toBe(2_000_000);
  });

  it("carries the low-level bonus, which the defender does not pay", () => {
    const state = fell(14, { playerLevel: 1 });
    expect(state.defenderLoss.r1).toBe(10_000);
    expect(state.loot.r1).toBe(15_700);
  });
});

/**
 * A player's Map Room 2 outpost (issue #179): the outpost props table, the
 * harvesters' attack buffer, the owner's pool and the terrain.
 */
describe("an outpost", () => {
  const RICH = { r1: 300_000_000, r2: 13_000_000, r3: 0, r4: 2_500_000 };

  it("gives the core 200,000 health, where a main yard gives it none", () => {
    const core = { "1": { id: 1, t: 112, l: 1, X: 0, Y: 0 } };
    expect(buildEngineYard({ buildingdata: core, kind: "outpost" }).buildings[0]?.maxHp).toBe(
      200_000,
    );
    expect(buildEngineYard({ buildingdata: core }).buildings[0]?.maxHp).toBe(0);
  });

  it("lets the core be hit, each hit drawing from the pool at nine tenths", () => {
    const yard = buildEngineYard({
      buildingdata: { "1": { id: 1, t: 112, l: 1, X: 0, Y: 0 } },
      resources: { r1: 1_000_000, r2: 0, r3: 0, r4: 0 },
      kind: "outpost",
    });
    const battle = createBattle(yard, { seed: 11, playerLevel: 20 });
    battle.apply({ kind: "fling", t: 0, x: -60, y: -60, r: 40, monsters: { C4: 4 } });
    run(battle, 2000);
    const core = yard.buildings[0]!;
    expect(core.hp).toBeGreaterThan(0);
    expect(core.hp).toBeLessThan(200_000);
    const state = battle.state();
    expect(state.defenderLoss.r1).toBeGreaterThan(0);
    // `BSTORAGE.Loot`: 0.9 of each draw, truncated (`BSTORAGE.as:77-85`).
    expect(state.loot.r1).toBeLessThan(state.defenderLoss.r1);
    expect(state.loot.r1).toBeGreaterThanOrEqual(Math.trunc(state.defenderLoss.r1 * 0.9) - 4);
  });

  it("drops the core at a twentieth of each resource, capped at 10,000,000, goo halved", () => {
    const yard = buildEngineYard({
      buildingdata: { "1": { id: 1, t: 112, l: 1, X: 0, Y: 0 } },
      buildinghealthdata: { "1": 1 },
      resources: RICH,
      kind: "outpost",
    });
    const battle = createBattle(yard, { seed: 11, playerLevel: 20 });
    battle.apply({ kind: "fling", t: 0, x: -60, y: -60, r: 40, monsters: { C4: 1 } });
    run(battle, 4000);
    expect(yard.buildings[0]!.hp).toBe(0);
    const state = battle.state();
    expect(state.defenderLoss).toEqual({ r1: 10_000_000, r2: 650_000, r3: 0, r4: 62_500 });
    expect(state.loot).toEqual(state.defenderLoss);
  });

  it("gives each harvester half its capacity above half health and a quarter below, ignoring st", () => {
    const yard = buildEngineYard({
      buildingdata: {
        "1": { id: 1, t: 1, l: 10, X: 0, Y: 0, st: 5 },
        "2": { id: 2, t: 2, l: 10, X: 200, Y: 0 },
        "3": { id: 3, t: 3, l: 10, X: 400, Y: 0 },
      },
      // 60%, 40% and destroyed of 165,000.
      buildinghealthdata: { "1": 99_000, "2": 66_000, "3": 0 },
      kind: "outpost",
    });
    expect(yard.buildings.map((one) => one.stored)).toEqual([387_509, 193_754, 0]);
    expect(yard.buildings.map((one) => one.looted)).toEqual([false, false, true]);
    // A main yard's harvester keeps its own banked `st`.
    const main = buildEngineYard({ buildingdata: { "1": { id: 1, t: 1, l: 10, X: 0, Y: 0, st: 5 } } });
    expect(main.buildings[0]?.stored).toBe(5);
  });

  it("takes a harvester's loot out of the owner's pool too (`BRESOURCE.as:104-118`)", () => {
    const loot = (kind: "main" | "outpost") => {
      const yard = buildEngineYard({
        buildingdata: { "1": { id: 1, t: 1, l: 1, X: 0, Y: 0, st: 360 } },
        resources: { r1: 1_000, r2: 0, r3: 0, r4: 0 },
        kind,
      });
      const battle = createBattle(yard, { seed: 11, playerLevel: 20 });
      battle.apply({ kind: "fling", t: 0, x: -60, y: -60, r: 40, monsters: { C4: 4 } });
      run(battle, 4000);
      return { pool: yard.resources.r1, state: battle.state() };
    };
    // Level 1 on an outpost: half of 720.
    const outpost = loot("outpost");
    expect(outpost.state.loot.r1).toBe(360);
    expect(outpost.state.defenderLoss.r1).toBe(360);
    expect(outpost.pool).toBe(640);
    const main = loot("main");
    expect(main.state.loot.r1).toBe(360);
    expect(main.pool).toBe(1_000);
  });

  /**
   * A level 1 Laser (range 160) and a Town Hall 260 away that three Pokeys
   * attack: out of reach on flat ground, inside it at height 250, which doubles
   * the range to 320. A wild monster camp loads as a main yard, so its towers
   * never stretch (`BTOWER.as:80-85`).
   */
  it("stretches tower range with the cell's height, on an outpost only", () => {
    const shots = (kind: "main" | "outpost" | "wild", height: number) => {
      const yard = buildEngineYard({
        buildingdata: {
          "1": { id: 1, t: 23, l: 1, X: 0, Y: 0 },
          "2": { id: 2, t: 14, l: 5, X: 260, Y: 0 },
        },
        kind,
        height,
      });
      expect(yard.height).toBe(height);
      const battle = createBattle(yard, { seed: 3, playerLevel: 20 });
      battle.apply({ kind: "fling", t: 0, x: 420, y: 60, r: 40, monsters: { C1: 3 } });
      run(battle, 1600);
      return battle.state().towers[0]?.shots ?? 0;
    };
    expect(shots("outpost", 250)).toBeGreaterThan(0);
    expect(shots("outpost", 125)).toBe(0);
    expect(shots("outpost", 90)).toBe(0);
    expect(shots("wild", 250)).toBe(0);
    expect(shots("main", 250)).toBe(0);
  });
});

describe("bombs", () => {
  it("takes health off everything inside the blast", () => {
    const yard = yardOf({ "1": { id: 1, t: 14, l: 1, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 2 });
    const before = yard.buildings[0]!.hp;
    battle.apply({ kind: "bomb", t: 0, x: 0, y: 0, id: "pb1" });
    expect(yard.buildings[0]!.hp).toBeLessThan(before);
  });

  it("ignores a putty bomb, which slows rather than damages", () => {
    const yard = yardOf({ "1": { id: 1, t: 14, l: 1, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 2 });
    const before = yard.buildings[0]!.hp;
    battle.apply({ kind: "bomb", t: 0, x: 0, y: 0, id: "pu3" });
    expect(yard.buildings[0]!.hp).toBe(before);
  });

  it("deals particles times the share, with no falloff", () => {
    // pb1: 9,000 over 200 particles is 45 a particle, 9,000 in all, wherever it
    // lands. A level 3 Town Hall has 20,000 to lose.
    const yard = yardOf({ "1": { id: 1, t: 14, l: 3, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 2 });
    const before = yard.buildings[0]!.hp;
    battle.apply({ kind: "bomb", t: 0, x: 40, y: 0, id: "pb1" });
    expect(before - yard.buildings[0]!.hp).toBe(9000);
  });

  it("loots nothing from what it fells: no attacker, no fall (`ResourceBomb.as:172`)", () => {
    const yard = buildEngineYard({
      buildingdata: {
        "1": { id: 1, t: 14, l: 1, X: 0, Y: 0 },
        "2": { id: 2, t: 1, l: 1, X: 20, Y: 0, st: 500 },
      },
      buildinghealthdata: { "1": 1, "2": 1 },
      resources: { r1: 100_000, r2: 0, r3: 0, r4: 0 },
    });
    const battle = createBattle(yard, { seed: 2 });
    battle.apply({ kind: "bomb", t: 0, x: 10, y: 0, id: "pb3" });
    expect(yard.buildings.map((building) => building.hp)).toEqual([0, 0]);
    expect(battle.state().loot).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
    expect(battle.state().defenderLoss).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
    expect(yard.resources.r1).toBe(100_000);
    expect(yard.buildings[1]!.stored).toBe(500);
  });

  it("takes 6% off a wall and leaves a trap alone", () => {
    const yard = yardOf({
      "1": { id: 1, t: 17, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 24, l: 1, X: 10, Y: 10 },
    });
    const battle = createBattle(yard, { seed: 2 });
    const [wall, trap] = [yard.buildings[0]!, yard.buildings[1]!];
    const before = { wall: wall.hp, trap: trap.hp };
    battle.apply({ kind: "bomb", t: 0, x: 0, y: 0, id: "pb3" });
    // int(375 * 0.06) = 22 a particle, 4,400 in all.
    expect(before.wall - wall.hp).toBe(Math.min(4400, before.wall));
    expect(trap.hp).toBe(before.trap);
  });

  /**
   * The ring the attack screen draws for a bomb is `bombBlast`, in world
   * pixels. A sizeless building (the Laser Tower's props entry has none) just
   * inside that ellipse must be hit and one just outside must not, for every
   * damage tier, so the ring and the engine speak the same units (#75).
   */
  it("hits exactly what the drawn ring covers", () => {
    for (const bomb of BOMBS.filter((one) => one.damage > 0)) {
      const ring = bombBlast(bomb);
      // Even horizontal offsets keep the yard point whole (x = sy + sx / 2).
      const inside = 2 * Math.floor((ring.rx - 1) / 2);
      const outside = 2 * Math.ceil((ring.rx + 1) / 2);
      const probes: Array<[number, number, boolean]> = [
        [inside, 0, true],
        [outside, 0, false],
        [0, ring.ry - 2, true],
        [0, ring.ry + 2, false],
      ];
      for (const [dx, dy, hit] of probes) {
        const yard = yardOf({ "1": { id: 1, t: 23, l: 1, X: 0, Y: 0 } });
        const laser = yard.buildings[0]!;
        // The building's middle sits at screen (0, middle); put the blast's
        // centre (dx, dy) short of it. Screen to yard: x = sy + sx / 2.
        const sx = -dx;
        const sy = laser.middle - dy;
        const x = sy + sx / 2;
        const y = sy - sx / 2;
        expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
        const battle = createBattle(yard, { seed: 2 });
        const before = laser.hp;
        battle.apply({ kind: "bomb", t: 0, x, y, id: bomb.id });
        expect({ bomb: bomb.id, dx, dy, hit: laser.hp < before }).toEqual({
          bomb: bomb.id,
          dx,
          dy,
          hit,
        });
      }
    }
  });
});

describe("determinism", () => {
  const scripted = (seed: number) => {
    const yard = yardOf({
      "1": { id: 1, t: 14, X: 0, Y: 0 },
      "2": { id: 2, t: 20, l: 2, X: 200, Y: 100 },
      "3": { id: 3, t: 17, X: -100, Y: -100 },
      "4": { id: 4, t: 24, X: -60, Y: -60 },
      "5": { id: 5, t: 1, X: 150, Y: -150, st: 900 },
    });
    const battle = createBattle(yard, { seed, playerLevel: 8 });
    battle.apply({ kind: "fling", t: 0, x: -300, y: -300, r: 200, monsters: { C1: 8, C5: 2 } });
    run(battle, 6000);
    return digestOf(battle.checkpoint());
  };

  it("gives the same digest for the same seed", () => {
    expect(scripted(777)).toBe(scripted(777));
  });

  it("gives a different one for a different seed", () => {
    expect(scripted(777)).not.toBe(scripted(778));
  });
});

describe("the flinger", () => {
  it("prices a payload in bucket units at the roster's levels", () => {
    // A Pokey is 7 bucket units at every level (`monsterStats.ts` C1).
    expect(bucketCost({ C1: 10 }, {})).toBe(70);
    expect(bucketCost({ C1: 10, C4: 2 }, {})).toBe(110);
  });

  it("carries 2,250 units a fling in Map Room 2", () => {
    // `GLOBAL` pins the flinger to level 4 outside Map Room 3 (`GLOBAL.as:863`).
    expect(flingerPayload()).toBe(2250);
  });

  it("sizes the drop circle from the payload, with a floor of 200", () => {
    expect(dropRadius(0)).toBe(100);
    expect(dropRadius(2000)).toBe(250);
  });

  it("counts a champion's own bucket when it sizes the zone (issue #143)", () => {
    // `ATTACK.BucketUpdate` adds the champion's `bucket` at its level
    // (`ATTACK.as:645-653`): Gorgo 240, Fomor 200.
    expect(flingCost({ monsters: { C1: 10 } }, {})).toBe(70);
    expect(flingCost({ monsters: { C1: 10 }, champion: { t: 1, l: 1 } }, {})).toBe(310);
    expect(flingCost({ monsters: {}, champion: { t: 3, l: 4 } }, {})).toBe(200);
    // A type the table does not hold adds nothing.
    expect(flingCost({ monsters: { C1: 10 }, champion: { t: 9, l: 1 } }, {})).toBe(70);
    // Alone, no champion's bucket gets past the floor of 200 a zone.
    expect(dropRadius(flingCost({ monsters: {}, champion: { t: 1, l: 6 } }, {}))).toBe(100);
  });
});

describe("where a fling's creeps land (issue #91)", () => {
  /** 300 Pokeys, 2,100 bucket units: a zone of size 525 and a scatter of 131.25. */
  const PAYLOAD = { C1: 300 };
  const flung = (seed: number) => {
    const battle = createBattle(yardOf({}), { seed });
    battle.apply({ kind: "fling", t: 0, x: 40, y: -60, r: 0, monsters: PAYLOAD });
    return battle.creeps();
  };

  it("reaches a quarter of the drop zone's size, which is half the logged radius", () => {
    // `DROPZONE.Drop` passes `_size / 2`, `ATTACK.Spawn` goes up to half of that.
    for (const bucket of [0, 700, 2100, 2250]) {
      const size = Math.max(200, bucket / 4);
      expect(scatterRadius(bucket)).toBe(size / 4);
      expect(scatterRadius(bucket)).toBe(dropRadius(bucket) / 2);
    }
    expect(scatterRadius(bucketCost(PAYLOAD, {}))).toBe(131.25);
  });

  it("scatters over a circle on screen, not in yard units", () => {
    const reach = scatterRadius(bucketCost(PAYLOAD, {}));
    const creeps = flung(9);
    expect(creeps).toHaveLength(300);
    let furthestOnScreen = 0;
    let furthestInYard = 0;
    for (const creep of creeps) {
      const onScreen = Math.sqrt(screenDistanceSquared(creep.ix, creep.iy, 40, -60));
      expect(onScreen).toBeLessThanOrEqual(reach + 1e-9);
      furthestOnScreen = Math.max(furthestOnScreen, onScreen);
      furthestInYard = Math.max(furthestInYard, Math.hypot(creep.ix - 40, creep.iy + 60));
    }
    expect(furthestOnScreen).toBeGreaterThan(reach * 0.95);
    // Straight down the screen a pixel is 1.41 yard units, so a screen circle
    // reaches past its own radius in yard units; a yard circle could not.
    expect(furthestInYard).toBeGreaterThan(reach * 1.2);
  });

  it("draws the distance uniformly along the radius, as Flash does", () => {
    // `random * param2 / 2` crowds the middle: half the creeps inside half
    // the radius, where a uniform disc would put a quarter there.
    const reach = scatterRadius(bucketCost(PAYLOAD, {}));
    const distances = flung(4)
      .map((creep) => Math.sqrt(screenDistanceSquared(creep.ix, creep.iy, 40, -60)) / reach)
      .sort((a, b) => a - b);
    const median = distances[distances.length / 2]!;
    expect(median).toBeGreaterThan(0.4);
    expect(median).toBeLessThan(0.6);
  });

  it("puts every creep of the same log in the same place", () => {
    expect(flung(12)).toEqual(flung(12));
  });

  it("widens the scatter by a champion's bucket (issue #143)", () => {
    // 2,100 for the Pokeys and 240 for a Gorgo: a zone of 585, a scatter of 146.25.
    const drop = { monsters: PAYLOAD, champion: { t: 1, l: 1 } };
    const reach = scatterRadius(flingCost(drop, {}));
    expect(reach).toBe(146.25);
    const battle = createBattle(yardOf({}), { seed: 9 });
    battle.apply({ kind: "fling", t: 0, x: 40, y: -60, r: 0, ...drop });
    const furthest = Math.max(
      ...battle
        .creeps()
        .map((creep) => Math.sqrt(screenDistanceSquared(creep.ix, creep.iy, 40, -60))),
    );
    expect(furthest).toBeLessThanOrEqual(reach + 1e-9);
    expect(furthest).toBeGreaterThan(scatterRadius(bucketCost(PAYLOAD, {})));
  });
});

describe("Slimeattikus splits as it dies (issue #129)", () => {
  /**
   * A Slimeattikus dropped among three level 6 towers, which bring it down in
   * a couple of seconds. `DeathSplit` leaves `splits` Minis (`C18`) at the
   * parent's level, each within 60 screen pixels of where it fell
   * (`DeathSplit.as:28-46`).
   */
  const fightTo = (level: number) => {
    const yard = yardOf({
      "1": { id: 1, t: 20, l: 6, X: 0, Y: 0 },
      "2": { id: 2, t: 20, l: 6, X: 100, Y: 0 },
      "3": { id: 3, t: 21, l: 6, X: 0, Y: 100 },
      "4": { id: 4, t: 1, l: 1, X: 200, Y: 200 },
    });
    const battle = createBattle(yard, { seed: 3, levels: { C17: level } });
    battle.apply({ kind: "fling", t: 0, x: 150, y: 150, r: 0, monsters: { C17: 1 } });
    let parent = battle.creeps()[0]!;
    for (let step = 0; step < 4000; step += 1) {
      battle.step();
      const live = battle.creeps().find((creep) => creep.monsterId === "C17");
      if (!live) break;
      parent = live;
    }
    const minis = battle.creeps().filter((creep) => creep.monsterId === "C18");
    return { battle, parent, minis };
  };

  it("leaves its level's number of Minis, at its level, near where it fell", () => {
    const { battle, parent, minis } = fightTo(3);
    // `splits` is 2, 2, 3, 3, 4, 5 by level.
    expect(minis).toHaveLength(3);
    for (const mini of minis) {
      expect(mini.level).toBe(3);
      expect(mini.friendly).toBe(false);
      expect(mini.hp).toBe(250);
      // Back to the screen offset the spawn drew: within 60 either way, plus
      // the step the parent took as it died.
      const dx = mini.ix - parent.ix;
      const dy = mini.iy - parent.iy;
      expect(Math.abs(dx - dy)).toBeLessThanOrEqual(60 + 5);
      expect(Math.abs((dx + dy) / 2)).toBeLessThanOrEqual(60 + 5);
    }
    // Spawned, not flung.
    expect(battle.state().creepsFlung).toBe(1);
  });

  it("splits in two at level 1", () => {
    expect(fightTo(1).minis).toHaveLength(2);
  });

  it("leaves nothing behind from any other creep", () => {
    const yard = yardOf({
      "1": { id: 1, t: 20, l: 6, X: 0, Y: 0 },
      "4": { id: 4, t: 1, l: 1, X: 200, Y: 200 },
    });
    const battle = createBattle(yard, { seed: 3 });
    battle.apply({ kind: "fling", t: 0, x: 150, y: 150, r: 0, monsters: { C1: 3 } });
    run(battle, 2000);
    expect(battle.state().creepsKilled).toBeGreaterThan(0);
    expect(battle.creeps().filter((creep) => creep.monsterId === "C18")).toHaveLength(0);
  });
});

describe("healers (issue #129)", () => {
  type Hit = Extract<BattleVisualEvent, { kind: "hit" }>;

  /** Every heal the battle threw: a hit on a creep with a negative amount. */
  const healsIn = (battle: ReturnType<typeof createBattle>, ticks: number): Hit[] => {
    const heals: Hit[] = [];
    for (let step = 0; step < ticks && !battle.over(); step += 1) {
      const before = battle.tick;
      battle.step();
      for (const event of battle.recentEvents(before)) {
        if (event.kind === "hit" && event.creepTargetId >= 0 && event.amount < 0) heals.push(event);
      }
    }
    return heals;
  };

  /** Three Pokeys and a level 1 Vorg dropped on a harvester a Cannon Tower covers. */
  const battleOf = (monsters: Record<string, number>, champion?: { t: number; l: number }) => {
    const yard = yardOf({
      "1": { id: 1, t: 20, l: 2, X: 0, Y: 0 },
      "4": { id: 4, t: 1, l: 1, X: 150, Y: 150 },
    });
    const battle = createBattle(yard, { seed: 3 });
    battle.apply({
      kind: "fling",
      t: 0,
      x: 120,
      y: 120,
      r: 0,
      monsters,
      ...(champion && { champion }),
    });
    return battle;
  };

  it("heals a wounded attacker by its damage's size, never past full health", () => {
    const battle = battleOf({ C1: 3, C16: 1 });
    const vorg = battle.creeps().find((creep) => creep.monsterId === "C16")!;
    const heals = healsIn(battle, 1500);
    expect(heals.length).toBeGreaterThan(0);
    for (const heal of heals) {
      expect(heal.creepId).toBe(vorg.id);
      // Level 1 Vorg: damage -60.
      expect(-heal.amount).toBeGreaterThan(0);
      expect(-heal.amount).toBeLessThanOrEqual(60);
    }
    for (const creep of battle.creeps()) expect(creep.hp).toBeLessThanOrEqual(creep.maxHp);
  });

  it("heals a champion by a tenth (`FIREBALL.as:151-153`)", () => {
    const battle = battleOf({ C16: 1 }, { t: 1, l: 1 });
    const gorgo = battle.creeps().find((creep) => creep.champion)!;
    const onGorgo = healsIn(battle, 3000).filter((heal) => heal.creepTargetId === gorgo.id);
    expect(onGorgo.length).toBeGreaterThan(0);
    for (const heal of onGorgo) expect(-heal.amount).toBeLessThanOrEqual(6);
  });

  it("never heals another healer, and leaves once its give-up timer runs out", () => {
    const battle = battleOf({ C15: 1, C16: 1 });
    const heals = healsIn(battle, 1000);
    expect(heals).toHaveLength(0);
    // Nobody to heal: a look a tick, 800 of them, then home.
    expect(battle.creeps().filter((creep) => !creep.friendly)).toHaveLength(0);
  });

  it("never swings at a building", () => {
    const battle = battleOf({ C16: 1 });
    run(battle, 1500);
    expect(battle.state().health).toEqual({});
  });
});

describe("Rezghul raises the dead (issue #129)", () => {
  /**
   * Six Pokeys and a level 3 Rezghul dropped on a harvester between two level
   * 6 Cannon Towers, which cut the Pokeys down. A level 3 Rezghul raises what
   * lies within 300 of it every 6 seconds, as zombies with 1.2 times the
   * health (`combatStatsData.ts` C19).
   */
  const battleOf = (monsters: Record<string, number>, levels: Record<string, number> = { C19: 3 }) => {
    const yard = yardOf({
      "1": { id: 1, t: 20, l: 6, X: 0, Y: 0 },
      "2": { id: 2, t: 20, l: 6, X: 100, Y: 0 },
      "4": { id: 4, t: 1, l: 1, X: 150, Y: 150 },
    });
    const battle = createBattle(yard, { seed: 3, levels });
    battle.apply({ kind: "fling", t: 0, x: 150, y: 150, r: 0, monsters });
    return battle;
  };

  /** Every creep that joined the field after the fling, with the tick it came. */
  const risen = (battle: ReturnType<typeof createBattle>, ticks: number) => {
    const seen = new Set(battle.creeps().map((creep) => creep.id));
    const born: Array<{ tick: number; creep: ReturnType<typeof battle.creeps>[number] }> = [];
    for (let step = 0; step < ticks && !battle.over(); step += 1) {
      battle.step();
      for (const creep of battle.creeps()) {
        if (seen.has(creep.id)) continue;
        seen.add(creep.id);
        born.push({ tick: battle.tick, creep });
      }
    }
    return born;
  };

  it("raises the fallen Pokeys as zombies with the Rezghul's health multiplier", () => {
    const born = risen(battleOf({ C1: 6, C19: 1 }), 3000);
    expect(born.length).toBeGreaterThan(0);
    for (const { creep } of born) {
      expect(creep.monsterId).toBe("C1");
      expect(creep.friendly).toBe(false);
      expect(creep.maxHp).toBe(240);
      expect(creep.hp).toBe(240);
    }
  });

  it("raises again only once its cooldown has run, 6 seconds at level 3", () => {
    const ticksOf = [...new Set(risen(battleOf({ C1: 6, C19: 1 }), 3000).map(({ tick }) => tick))];
    expect(ticksOf.length).toBeGreaterThan(1);
    for (let at = 1; at < ticksOf.length; at += 1) {
      expect(ticksOf[at]! - ticksOf[at - 1]!).toBeGreaterThanOrEqual(6 * 80);
    }
  });

  it("raises each corpse once: a zombie leaves none", () => {
    const battle = battleOf({ C1: 6, C19: 1 });
    const born = risen(battle, 3000);
    // Six Pokeys can come back six times at most, however many die twice.
    expect(born.length).toBeLessThanOrEqual(6);
  });

  it("raises nothing without a Rezghul, and never a Mini", () => {
    expect(risen(battleOf({ C1: 6 }), 3000)).toHaveLength(0);
    // Slimeattikus falls and splits and its Minis fall too: every Mini that
    // joins is a fresh split at 250, never a zombie at 1.2 times that.
    const minis = risen(battleOf({ C17: 2, C19: 1 }, { C19: 3, C17: 1 }), 3000).filter(
      ({ creep }) => creep.monsterId === "C18",
    );
    expect(minis.length).toBeGreaterThan(0);
    for (const { creep } of minis) expect(creep.maxHp).toBe(250);
  });
});

describe("a bunker's reach (issue #91)", () => {
  /**
   * A level 1 Monster Bunker (range 300, 90 x 90) at the origin scans from the
   * middle of its footprint, (45, 45) (`HOUSINGBUNKER.as:156`,
   * `BUILDING22.as:90`). A Pokey dropped by a harvester off to the south-east
   * stops at it and swings; the bunker's first look is on tick 30.
   */
  const battleOf = (harvesterAt: number) => {
    const yard = yardOf({
      "1": { id: 1, t: 22, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 1, l: 1, X: harvesterAt, Y: harvesterAt },
    });
    const battle = createBattle(yard, { seed: 3, bunkers: { 1: { C1: 2 } } });
    battle.apply({
      kind: "fling",
      t: 0,
      x: harvesterAt - 20,
      y: harvesterAt - 20,
      r: 0,
      monsters: { C1: 1 },
    });
    run(battle, 29);
    const pokey = battle.creeps()[0]!;
    run(battle, 1);
    const defenders = battle.creeps().filter((creep) => creep.friendly);
    return { pokey, defenders };
  };

  it("sends a defender at a creep in range of the middle but not of the anchor", () => {
    const { pokey, defenders } = battleOf(290);
    expect(Math.hypot(pokey.ix, pokey.iy)).toBeGreaterThan(300);
    expect(Math.hypot(pokey.ix - 45, pokey.iy - 45)).toBeLessThan(300);
    expect(defenders).toHaveLength(1);
  });

  it("still sends nothing at a creep out of range of the middle", () => {
    const { pokey, defenders } = battleOf(350);
    expect(Math.hypot(pokey.ix - 45, pokey.iy - 45)).toBeGreaterThan(300);
    expect(defenders).toHaveLength(0);
  });
});

describe("a bunker's losses (issue #130)", () => {
  it("tallies each dead defender against its bunker, and reports them in id order", () => {
    const tally: BunkerLossTally = new Map();
    addBunkerLoss(tally, 12, "C3");
    addBunkerLoss(tally, 5, "C1");
    addBunkerLoss(tally, 12, "C1");
    addBunkerLoss(tally, 12, "C3");
    const record = bunkerLossRecord(tally);
    expect(record).toEqual({ 5: { C1: 1 }, 12: { C1: 1, C3: 2 } });
    expect(Object.keys(record)).toEqual(["5", "12"]);
    expect(Object.keys(record[12]!)).toEqual(["C1", "C3"]);
  });

  /**
   * A level 1 Monster Bunker holding five Pokeys, and thirty Pokeys dropped
   * beside a harvester in its range. The attackers fight back (issue #195):
   * they kill all five, and then the bunker.
   */
  const battleOf = () => {
    const yard = yardOf({
      "1": { id: 1, t: 22, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 1, l: 1, X: 200, Y: 200 },
    });
    const battle = createBattle(yard, { seed: 7, bunkers: { 1: { C1: 5 } } });
    battle.apply({ kind: "fling", t: 0, x: 180, y: 180, r: 100, monsters: { C1: 30 } });
    return battle;
  };

  it("counts each defender the attackers kill against its bunker, and none for a yard without one", () => {
    const battle = battleOf();
    run(battle, 1200);
    const state = battle.state();
    expect(state.bunkerLosses).toEqual({ 1: { C1: 5 } });
    expect(state.creepsKilled).toBeGreaterThan(0);
    expect(battle.creeps().filter((creep) => creep.friendly)).toHaveLength(0);
    const plain = createBattle(yardOf({ "2": { id: 2, t: 1, l: 1, X: 200, Y: 200 } }), { seed: 7 });
    plain.apply({ kind: "fling", t: 0, x: 180, y: 180, r: 100, monsters: { C1: 30 } });
    run(plain, 1200);
    expect(plain.state().bunkerLosses).toEqual({});
    expect(plain.state().bunkerGarrisons).toEqual({});
    expect(plain.state().defenderChampionHp).toBeNull();
  });

  it("folds the defence into the checkpoint only when there is one", () => {
    const plain = createBattle(yardOf({ "2": { id: 2, t: 1, l: 1, X: 200, Y: 200 } }), { seed: 7 });
    plain.apply({ kind: "fling", t: 0, x: 180, y: 180, r: 100, monsters: { C1: 30 } });
    run(plain, 600);
    // Tick, four numbers a building, five a creep, twelve totals: as before #195.
    expect(plain.checkpoint().length).toBe(1 + 4 * 1 + 5 * plain.creeps().length + 12);

    const battle = battleOf();
    run(battle, 1200);
    const creeps = battle.creeps().length;
    // The same, then two a creep, each bunker's id and pool, and the champion's health.
    expect(battle.checkpoint().length).toBe(1 + 4 * 2 + 5 * creeps + 12 + 2 * creeps + 1 + 2 + 1);
  });
});

describe("the fight-back (issue #195)", () => {
  /**
   * A level 1 Monster Bunker holding one level 6 Fang, a harvester beside it
   * and another far off. One Pokey lands by the near harvester, one by the far.
   */
  const bunkerBattle = () => {
    const yard = yardOf({
      "1": { id: 1, t: 22, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 1, l: 1, X: 150, Y: 150 },
      "3": { id: 3, t: 1, l: 1, X: 1400, Y: 1400 },
    });
    const battle = createBattle(yard, {
      seed: 3,
      bunkers: { 1: { C8: 1 } },
      defenderLevels: { C8: 6 },
    });
    battle.apply({ kind: "fling", t: 0, x: 140, y: 140, r: 0, monsters: { C1: 1 } });
    battle.apply({ kind: "fling", t: 0, x: 1380, y: 1380, r: 0, monsters: { C1: 1 } });
    return battle;
  };

  it("sends a defender at the defender's own level, which kills the near attacker and never chases the far one", () => {
    const battle = bunkerBattle();
    const far = battle.creeps().find((creep) => creep.ix > 1000)!;
    run(battle, 1);
    run(battle, 29);
    const [defender] = battle.creeps().filter((creep) => creep.friendly);
    expect(defender).toMatchObject({ monsterId: "C8", level: 6 });
    for (let step = 0; step < 300; step += 1) {
      battle.step();
      for (const creep of battle.creeps()) if (creep.friendly) expect(creep.targetCreep).not.toBe(far.id);
    }
    expect(battle.creeps().filter((creep) => !creep.friendly).map((creep) => creep.id)).toEqual([far.id]);
  });

  it("walks a defender with nothing left in reach back into its bunker, alive and counted", () => {
    const battle = bunkerBattle();
    run(battle, 600);
    expect(battle.creeps().filter((creep) => creep.friendly)).toHaveLength(0);
    expect(battle.state().bunkerLosses).toEqual({});
    expect(battle.state().bunkerGarrisons).toEqual({ 1: { C8: 1 } });
  });

  it("sends it out again at the next attacker to come near", () => {
    const battle = bunkerBattle();
    run(battle, 600);
    battle.apply({ kind: "fling", t: 600, x: 140, y: 140, r: 0, monsters: { C1: 1 } });
    run(battle, 60);
    expect(battle.creeps().filter((creep) => creep.friendly)).toHaveLength(1);
  });

  it("turns an attacker on the defender that hits it, and back to the buildings once it is dead", () => {
    const yard = yardOf({
      "1": { id: 1, t: 22, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 1, l: 1, X: 150, Y: 150 },
    });
    const battle = createBattle(yard, { seed: 5, bunkers: { 1: { C1: 1 } } });
    battle.apply({ kind: "fling", t: 0, x: 140, y: 140, r: 0, monsters: { C8: 1 } });
    let foughtIt = false;
    for (let step = 0; step < 900 && !battle.over(); step += 1) {
      battle.step();
      const attacker = battle.creeps().find((creep) => !creep.friendly);
      const defender = battle.creeps().find((creep) => creep.friendly);
      if (attacker && defender && attacker.targetCreep === defender.id) foughtIt = true;
    }
    expect(foughtIt).toBe(true);
    expect(battle.state().bunkerLosses).toEqual({ 1: { C1: 1 } });
    const attacker = battle.creeps().find((creep) => !creep.friendly)!;
    expect(attacker.targetCreep).toBe(-1);
    expect(attacker.targetBuilding).toBeGreaterThan(0);
  });

  it("keeps a bunker's healers in", () => {
    const yard = yardOf({
      "1": { id: 1, t: 22, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 1, l: 1, X: 150, Y: 150 },
    });
    const battle = createBattle(yard, { seed: 5, bunkers: { 1: { C15: 3 } } });
    battle.apply({ kind: "fling", t: 0, x: 140, y: 140, r: 0, monsters: { C1: 2 } });
    run(battle, 300);
    expect(battle.creeps().filter((creep) => creep.friendly)).toHaveLength(0);
  });
});

describe("the caged champion (issues #195, #260)", () => {
  /** A Champion Cage, a harvester by it, one far off, and a Cannon Tower in between. */
  const yard = () =>
    yardOf({
      "1": { id: 1, t: 114, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 1, l: 1, X: 150, Y: 150 },
      "3": { id: 3, t: 1, l: 1, X: 1400, Y: 1400 },
      "4": { id: 4, t: 20, l: 1, X: 300, Y: -200 },
    });
  /** A Champion Cage and one harvester well away from it, so attackers walk off. */
  const openYard = () =>
    yardOf({
      "1": { id: 1, t: 114, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 1, l: 1, X: 1200, Y: 1200 },
    });
  const gorgo = { t: 1, l: 2, hp: 5000, pl: 1 };
  const champion = (battle: ReturnType<typeof createBattle>) =>
    battle.creeps().find((creep) => creep.champion && creep.friendly);
  /** Steps until the champion is out, and returns the tick it came out on, or -1. */
  const untilOut = (battle: ReturnType<typeof createBattle>, limit: number): number => {
    for (let step = 0; step < limit && !battle.over(); step += 1) {
      battle.step();
      if (champion(battle)) return battle.tick;
    }
    return -1;
  };

  it("stays in its cage while no attacker is near", () => {
    const battle = createBattle(yard(), { seed: 3, defenderChampion: gorgo });
    battle.apply({ kind: "fling", t: 0, x: 1380, y: 1380, r: 50, monsters: { C1: 5 } });
    run(battle, 300);
    expect(champion(battle)).toBeUndefined();
    expect(battle.state().defenderChampionHp).toBe(5000);
  });

  it("only looks out every 200 of its frames (`ChampionBase.as:1055`)", () => {
    const battle = createBattle(yard(), { seed: 3, defenderChampion: gorgo });
    battle.apply({ kind: "fling", t: 0, x: 140, y: 140, r: 50, monsters: { C1: 5 } });
    // Its frame starts below 7, so its first look is on one of ticks 194 to 200.
    const out = untilOut(battle, 400);
    expect(out).toBeGreaterThanOrEqual(194);
    expect(out).toBeLessThanOrEqual(200);
  });

  it("comes out at its stored health, its level and power level, and fights what came", () => {
    const battle = createBattle(yard(), { seed: 3, defenderChampion: gorgo });
    battle.apply({ kind: "fling", t: 0, x: 140, y: 140, r: 50, monsters: { C1: 5 } });
    untilOut(battle, 400);
    expect(champion(battle)).toMatchObject({
      monsterId: "G1",
      level: 2,
      hp: 5000,
      maxHp: championStatWithPower("G1", "health", 2, 1),
    });
    run(battle, 2000);
    // It killed all five, towers never shot it, and it kept what health it had left.
    expect(battle.state().creepsKilled).toBe(5);
    const hp = battle.state().defenderChampionHp!;
    expect(hp).toBeGreaterThan(0);
    expect(hp).toBeLessThan(5000);
  });

  it("sees an attacker 800 from itself, and chases it as far as it goes (`ChampionBase.as:501`)", () => {
    const battle = createBattle(openYard(), { seed: 3, defenderChampion: gorgo });
    // About 600 from the cage, walking away from it to the far harvester.
    battle.apply({ kind: "fling", t: 0, x: 450, y: 450, r: 0, monsters: { C1: 1 } });
    expect(untilOut(battle, 400)).toBeGreaterThan(0);
    let farthest = 0;
    for (let step = 0; step < 6000 && battle.state().creepsKilled === 0; step += 1) {
      battle.step();
      const out = champion(battle);
      if (out) farthest = Math.max(farthest, Math.hypot(out.ix, out.iy));
    }
    expect(battle.state().creepsKilled).toBe(1);
    // The #195 leash held it to 800 around the cage; Flash's champion has none.
    expect(farthest).toBeGreaterThan(1000);
  });

  it("lets an Eye-ra pass unless it flies (`ChampionBase.as:510`)", () => {
    const eyeras = createBattle(openYard(), { seed: 3, defenderChampion: gorgo });
    eyeras.apply({ kind: "fling", t: 0, x: 300, y: 300, r: 20, monsters: { C5: 3 } });
    expect(untilOut(eyeras, 400)).toBe(-1);
    expect(eyeras.creeps().filter((creep) => !creep.friendly)).toHaveLength(3);

    const pokeys = createBattle(openYard(), { seed: 3, defenderChampion: gorgo });
    pokeys.apply({ kind: "fling", t: 0, x: 300, y: 300, r: 20, monsters: { C1: 3 } });
    expect(untilOut(pokeys, 400)).toBeGreaterThan(0);
  });

  it("walks back with nobody left inside 800, goes in, and comes out again for the next", () => {
    const battle = createBattle(yard(), { seed: 3, defenderChampion: gorgo });
    battle.apply({ kind: "fling", t: 0, x: 600, y: 600, r: 0, monsters: { C1: 1 } });
    untilOut(battle, 400);
    const first = champion(battle)!;
    for (let step = 0; step < 3000 && champion(battle); step += 1) battle.step();
    expect(battle.state().creepsKilled).toBe(1);
    expect(champion(battle)).toBeUndefined();
    const hp = battle.state().defenderChampionHp!;
    expect(hp).toBeGreaterThan(0);
    expect(hp).toBeLessThan(5000);

    battle.apply({ kind: "fling", t: battle.tick, x: 600, y: 600, r: 0, monsters: { C1: 1 } });
    expect(untilOut(battle, 400)).toBeGreaterThan(0);
    expect(champion(battle)).toMatchObject({ id: first.id, hp });
  });

  it("is never shot by a tower", () => {
    const battle = createBattle(yard(), { seed: 3, defenderChampion: gorgo });
    battle.apply({ kind: "fling", t: 0, x: 140, y: 140, r: 50, monsters: { C1: 5 } });
    for (let step = 0; step < 1500 && !battle.over(); step += 1) {
      battle.step();
      const friendly = new Set(battle.creeps().filter((creep) => creep.friendly).map((creep) => creep.id));
      for (const event of battle.recentEvents(battle.tick - 1)) {
        if (event.kind === "shot") expect(friendly.has(event.creepId)).toBe(false);
      }
    }
  });

  it("reports 0 when the attackers kill it", () => {
    const battle = createBattle(yard(), { seed: 3, defenderChampion: gorgo });
    battle.apply({ kind: "fling", t: 0, x: 140, y: 140, r: 50, monsters: { C1: 60 } });
    run(battle, 4000);
    expect(champion(battle)).toBeUndefined();
    expect(battle.state().defenderChampionHp).toBe(0);
  });

  it("is not there without a cage, or with nothing left in it", () => {
    const noCage = createBattle(yardOf({ "2": { id: 2, t: 1, l: 1, X: 150, Y: 150 } }), {
      seed: 3,
      defenderChampion: gorgo,
    });
    noCage.apply({ kind: "fling", t: 0, x: 140, y: 140, r: 50, monsters: { C1: 5 } });
    run(noCage, 300);
    expect(champion(noCage)).toBeUndefined();
    expect(noCage.state().defenderChampionHp).toBeNull();

    const spent = createBattle(yard(), { seed: 3, defenderChampion: { ...gorgo, hp: 0 } });
    spent.apply({ kind: "fling", t: 0, x: 140, y: 140, r: 50, monsters: { C1: 5 } });
    run(spent, 300);
    expect(champion(spent)).toBeUndefined();
  });
});

describe("bunkerGarrisons (issue #130)", () => {
  it("reads each bunker's `m` by its building id, the entry's `id` before its key", () => {
    expect(
      bunkerGarrisons({
        "5": { id: 5, t: 22, l: 2, m: { C1: 4, C3: 2 } },
        "9": { id: 12, t: 128, l: 1, m: { C5: 1 } },
        "7": { t: 22, l: 1, m: { C2: 3 } },
      }),
    ).toEqual({ 5: { C1: 4, C3: 2 }, 12: { C5: 1 }, 7: { C2: 3 } });
  });

  it("merges the old id, counts a Map Room 3 list by its length, and drops the rest", () => {
    expect(
      bunkerGarrisons({
        "1": { id: 1, t: 22, m: { C100: 2, C12: 1, C2: [{}, {}, {}], C9999: 5, C1: 0, C3: -2, C4: "x" } },
        "2": { id: 2, t: 22, m: {} },
        "3": { id: 3, t: 22 },
        "4": { id: 4, t: 20, m: { C1: 9 } },
      }),
    ).toEqual({ 1: { C12: 3, C2: 3 } });
  });

  it("is empty for no buildingdata", () => {
    expect(bunkerGarrisons(null)).toEqual({});
    expect(bunkerGarrisons({})).toEqual({});
  });
});

describe("the Housing Bunker (issue #143)", () => {
  /**
   * A level 1 Housing Bunker, type 128 (range 500 and 4,000 health from
   * `INFERNOYARDPROPS.as:6006`, `:6068`; 160 x 160, so it scans from (80, 80)),
   * with a Pokey dropped on a harvester off to the south-east.
   */
  const battleOf = (harvesterAt: number) => {
    const yard = yardOf({
      "1": { id: 1, t: 128, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 1, l: 1, X: harvesterAt, Y: harvesterAt },
    });
    const battle = createBattle(yard, { seed: 3, bunkers: { 1: { C1: 2 } } });
    battle.apply({
      kind: "fling",
      t: 0,
      x: harvesterAt - 20,
      y: harvesterAt - 20,
      r: 0,
      monsters: { C1: 1 },
    });
    run(battle, 30);
    const pokey = battle.creeps().find((creep) => !creep.friendly)!;
    const defenders = battle.creeps().filter((creep) => creep.friendly);
    return { yard, pokey, defenders };
  };

  it("stands with its health and sends a defender at a creep within 500", () => {
    const { yard, pokey, defenders } = battleOf(400);
    expect(yard.buildings[0]?.hp).toBe(4000);
    expect(Math.hypot(pokey.ix - 80, pokey.iy - 80)).toBeLessThan(500);
    expect(defenders).toHaveLength(1);
    expect(defenders[0]?.targetCreep).toBe(pokey.id);
  });

  it("sends nothing at a creep beyond its range", () => {
    const { pokey, defenders } = battleOf(500);
    expect(Math.hypot(pokey.ix - 80, pokey.iy - 80)).toBeGreaterThan(500);
    expect(defenders).toHaveLength(0);
  });
});

describe("flyers (issue #58)", () => {
  /**
   * A level 1 Cannon Tower (70 x 70 at 0,0) inside a closed ring of twenty
   * walls (20 x 20 each). A flyer is sent straight at the tower with no route
   * (`MonsterBase.as:1121`), so no wall is ever its target, and the Cannon,
   * which has flyer mode 0 (`BTOWER.as:25-35`), may not shoot at it.
   */
  const ringed = (tower: number): CombatBuildingDataMap => {
    const buildings: Record<string, CombatBuildingDataMap[string]> = {
      "1": { id: 1, t: tower, l: 1, X: 0, Y: 0 },
    };
    let id = 2;
    const wall = (X: number, Y: number) => {
      buildings[String(id)] = { id, t: 17, X, Y };
      id += 1;
    };
    for (let x = -20; x <= 80; x += 20) {
      wall(x, -20);
      wall(x, 80);
    }
    for (let y = 0; y <= 60; y += 20) {
      wall(-20, y);
      wall(80, y);
    }
    return buildings;
  };

  const attack = (tower: number, monsters: Record<string, number>) => {
    const yard = yardOf(ringed(tower));
    const battle = createBattle(yard, { seed: 5, playerLevel: 8 });
    battle.apply({ kind: "fling", t: 0, x: -300, y: -300, r: 200, monsters });
    return { yard, battle };
  };

  const wallsHurt = (yard: ReturnType<typeof yardOf>): number =>
    yard.buildings.filter((one) => one.type === 17 && one.hp < one.maxHp).length;

  it("puts Teratorn and Zafreeti in the air", () => {
    const { battle } = attack(20, { C14: 1, C15: 1 });
    run(battle, 5);
    const creeps = battle.creeps();
    expect(creeps).toHaveLength(2);
    for (const creep of creeps) expect(creep.flying).toBe(true);
  });

  it("flies a Teratorn over the wall ring to the tower, and the Cannon never fires", () => {
    const { yard, battle } = attack(20, { C14: 1 });
    run(battle, 3000);
    const tower = yard.buildings.find((one) => one.type === 20);
    expect(tower!.hp).toBeLessThan(tower!.maxHp);
    expect(wallsHurt(yard)).toBe(0);
    expect(battle.state().towers[0]?.shots).toBe(0);
  });

  it("lets a Flak Tower, which shoots only flyers, bring a Teratorn down", () => {
    const { battle } = attack(115, { C14: 1 });
    run(battle, 6000);
    const flak = battle.state().towers[0];
    expect(flak?.shots).toBeGreaterThan(0);
    expect(flak?.kills).toBe(1);
  });

  describe("a champion's movement ladder (issue #69)", () => {
    /** One Fomor (type 3) at `level`, dropped where the monsters are. */
    const fomor = (tower: number, level: number, towerLevel = 1) => {
      const yard = yardOf({ ...ringed(tower), "1": { id: 1, t: tower, l: towerLevel, X: 0, Y: 0 } });
      const battle = createBattle(yard, { seed: 5, playerLevel: 8 });
      battle.apply({
        kind: "fling",
        t: 0,
        x: -300,
        y: -300,
        r: 200,
        monsters: {},
        champion: { t: 3, l: level },
      });
      return { yard, battle };
    };

    it("walks a Fomor at levels 1 and 2 and flies it from 3 (`CHAMPIONCAGE.as:160`)", () => {
      for (const [level, flying] of [
        [1, false],
        [2, false],
        [3, true],
        [6, true],
      ] as const) {
        const { battle } = fomor(20, level);
        run(battle, 1);
        const [creep] = battle.creeps();
        expect(creep?.champion).toBe(true);
        expect(creep?.flying).toBe(flying);
      }
    });

    it("keeps every other champion on the ground at every level", () => {
      for (const t of [1, 2, 4, 5]) {
        for (let level = 1; level <= 6; level += 1) {
          const battle = createBattle(yardOf(ringed(20)), { seed: 5, playerLevel: 8 });
          battle.apply({
            kind: "fling",
            t: 0,
            x: -300,
            y: -300,
            r: 200,
            monsters: {},
            champion: { t, l: level },
          });
          run(battle, 1);
          expect(battle.creeps()[0]?.flying).toBe(false);
        }
      }
    });

    it("flies a level 3 Fomor over the wall ring, where the Cannon cannot shoot it", () => {
      const { yard, battle } = fomor(20, 3);
      run(battle, 6000);
      const tower = yard.buildings.find((one) => one.type === 20);
      expect(tower!.hp).toBeLessThan(tower!.maxHp);
      expect(wallsHurt(yard)).toBe(0);
      expect(battle.state().towers[0]?.shots).toBe(0);
    });

    it("lets a Flak Tower shoot a flying Fomor", () => {
      // A level 3 Fomor hovers to fire just outside a level 1 Flak's 300 (it
      // stops about 250 out on the diagonal, measured from the Flak's scan point),
      // so the Flak here is level 3, range 340.
      const { battle } = fomor(115, 3, 3);
      run(battle, 6000);
      expect(battle.state().towers[0]?.shots).toBeGreaterThan(0);
    });

    it("sends a level 2 Fomor through the walls on foot", () => {
      const { yard, battle } = fomor(20, 2);
      run(battle, 6000);
      expect(wallsHurt(yard)).toBeGreaterThan(0);
    });
  });
});

describe("the renderer's view of the field (issue #32, WP5)", () => {
  /** The determinism yard: a Pokey drop against a tower, a wall and a trap. */
  const scripted = () => {
    const yard = yardOf({
      "1": { id: 1, t: 14, X: 0, Y: 0 },
      "2": { id: 2, t: 20, l: 2, X: 200, Y: 100 },
      "3": { id: 3, t: 17, X: -100, Y: -100 },
      "4": { id: 4, t: 24, X: -60, Y: -60 },
      "5": { id: 5, t: 1, X: 150, Y: -150, st: 900 },
    });
    const battle = createBattle(yard, { seed: 777, playerLevel: 8 });
    battle.apply({ kind: "fling", t: 0, x: -300, y: -300, r: 200, monsters: { C1: 8, C5: 2 } });
    return battle;
  };

  it("lists every creep with its position, health and state, ascending id", () => {
    const battle = scripted();
    run(battle, 10);
    const creeps = battle.creeps();
    expect(creeps.map((creep) => creep.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(creeps.filter((creep) => creep.monsterId === "C1")).toHaveLength(8);
    expect(creeps.filter((creep) => creep.monsterId === "C5")).toHaveLength(2);
    for (const creep of creeps) {
      expect(creep.hp).toBe(creep.maxHp);
      expect(creep.flying).toBe(false);
      expect(creep.champion).toBe(false);
      expect(creep.friendly).toBe(false);
      expect(creep.state).toBe("walking");
      // Inside the drop circle around (-300, -300), in the fling's own units.
      expect(Math.hypot(creep.ix + 300, creep.iy + 300)).toBeLessThanOrEqual(200);
    }
    expect(battle.state().creepsAlive).toBe(creeps.length);
  });

  it("shows a creep attacking once it reaches its target, and drops it when it dies", () => {
    const battle = scripted();
    run(battle, 6000);
    const creeps = battle.creeps();
    expect(creeps.length).toBe(battle.state().creepsAlive);
    for (const creep of creeps) expect(creep.hp).toBeGreaterThan(0);
    const attacking = creeps.filter((creep) => creep.state === "attacking");
    for (const creep of attacking) expect(creep.targetBuilding).toBeGreaterThan(0);
  });

  it("changes nothing about the battle: the digest is the same whether or not it is read", () => {
    const watched = scripted();
    const unwatched = scripted();
    for (let step = 0; step < 6000; step += 1) {
      watched.step();
      unwatched.step();
      if (step % 7 === 0) {
        watched.creeps();
        watched.recentEvents(step - 3);
      }
    }
    expect(digestOf(watched.checkpoint())).toBe(digestOf(unwatched.checkpoint()));
    expect(watched.state()).toEqual(unwatched.state());
  });

  it("reports each tower shot with the tick and the creep it hit", () => {
    const yard = yardOf({ "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 1 });
    battle.apply({ kind: "fling", t: 0, x: -100, y: -100, r: 200, monsters: { C1: 1 } });
    let seen = 0;
    let shots = 0;
    let deaths = 0;
    for (let step = 0; step < 1200; step += 1) {
      battle.step();
      // Read every few ticks, as a renderer at 60 fps would.
      if (step % 3 !== 0) continue;
      for (const event of battle.recentEvents(seen)) {
        expect(event.tick).toBeGreaterThan(seen);
        if (event.kind === "shot") {
          shots += 1;
          expect(event.towerId).toBe(1);
          expect(event.creepId).toBe(1);
        } else if (event.kind === "death") {
          deaths += 1;
          expect(event.creepId).toBe(1);
          expect(event.monsterId).toBe("C1");
        }
      }
      seen = battle.tick;
    }
    // Eleven shots kill the Pokey (issue #264), which is what the tower report says too.
    expect(shots).toBe(battle.state().towers[0]?.shots);
    expect(shots).toBe(11);
    expect(deaths).toBe(1);
  });

  it("reports each swing that lands as a hit, and each wound as a hurt", () => {
    const yard = yardOf({ "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 1 });
    battle.apply({ kind: "fling", t: 0, x: -100, y: -100, r: 200, monsters: { C1: 1 } });
    const events: BattleVisualEvent[] = [];
    let seen = 0;
    for (let step = 0; step < 1200; step += 1) {
      battle.step();
      if (step % 5 !== 0) continue;
      events.push(...battle.recentEvents(seen));
      seen = battle.tick;
    }
    const hits = events.filter((event) => event.kind === "hit");
    const hurts = events.filter((event) => event.kind === "hurt");
    // The Pokey got eleven swings in before it died, 60 a swing, on foot, at
    // the tower it was standing on.
    expect(hits).toHaveLength(11);
    for (const hit of hits) {
      if (hit.kind !== "hit") throw new Error("filtered");
      expect(hit.creepId).toBe(1);
      expect(hit.buildingId).toBe(1);
      expect(hit.creepTargetId).toBe(-1);
      expect(hit.ranged).toBe(false);
      expect(hit.flying).toBe(false);
      expect(hit.amount).toBe(60);
      expect(hit.targetIx).toBe(0);
      expect(hit.targetIy).toBe(0);
    }
    // Eleven shots, each one a wound with the Pokey's position that tick, of
    // 20 and then 19 as the tower is hurt (issue #264), the last the 8 it had left.
    expect(hurts).toHaveLength(11);
    expect(hurts.map((hurt) => (hurt.kind === "hurt" ? hurt.amount : 0))).toEqual([
      20, 20, 19, 19, 19, 19, 19, 19, 19, 19, 8,
    ]);
    for (const hurt of hurts) {
      if (hurt.kind !== "hurt") throw new Error("filtered");
      expect(hurt.creepId).toBe(1);
      expect(hurt.friendly).toBe(false);
      expect(Number.isFinite(hurt.ix)).toBe(true);
    }
    // Hits and hurts come with a tick, in tick order, like every other event.
    for (let index = 1; index < events.length; index += 1) {
      expect(events[index]!.tick).toBeGreaterThanOrEqual(events[index - 1]!.tick);
    }
  });

  it("keeps hits and hurts out of the checkpoint", () => {
    const yard = yardOf({ "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 1 });
    battle.apply({ kind: "fling", t: 0, x: -100, y: -100, r: 200, monsters: { C1: 1 } });
    run(battle, 400);
    expect(battle.recentEvents(0).some((event) => event.kind === "hit")).toBe(true);
    expect(battle.recentEvents(0).some((event) => event.kind === "hurt")).toBe(true);
    // One tick, four numbers per building, five per creep, twelve totals: the
    // checkpoint is exactly as long with a hundred visual events behind it as
    // it would be with none, and the digest is over those numbers alone.
    const creeps = battle.creeps().length;
    expect(battle.checkpoint()).toHaveLength(1 + 4 * yard.buildings.length + 5 * creeps + 12);
    const again = createBattle(yardOf({ "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } }), { seed: 1 });
    again.apply({ kind: "fling", t: 0, x: -100, y: -100, r: 200, monsters: { C1: 1 } });
    run(again, 400);
    expect(digestOf(battle.checkpoint())).toBe(digestOf(again.checkpoint()));
  });

  it("forgets events older than the memory window", () => {
    const yard = yardOf({ "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 1 });
    battle.apply({ kind: "fling", t: 0, x: -100, y: -100, r: 200, monsters: { C1: 1 } });
    run(battle, 1200);
    // The Pokey died around tick 800; two seconds later nothing is left to tell.
    run(battle, 400);
    expect(battle.recentEvents(0)).toEqual([]);
  });
});

describe("the champion's health after the field is left (issue #32)", () => {
  /** A Gorgo alone against a lone level 1 Cannon Tower, which barely scratches it. */
  const flung = () => {
    const yard = yardOf({ "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 1 });
    battle.apply({
      kind: "fling",
      t: 0,
      x: -100,
      y: -100,
      r: 200,
      monsters: {},
      champion: { t: 1, l: 1 },
    });
    return battle;
  };

  it("keeps the health a retreated champion left with, rather than reporting it dead", () => {
    const battle = flung();
    run(battle, 400);
    const before = battle.state().championHp;
    expect(before).not.toBeNull();
    expect(before).toBeGreaterThan(0);
    battle.apply({ kind: "retreat", t: battle.tick });
    run(battle, 10);
    expect(battle.over()).toBe(true);
    expect(battle.state().creepsKilled).toBe(0);
    expect(battle.state().championHp).toBe(before);
  });

  it("keeps the health of a champion that walked home once the yard was flat", () => {
    const yard = yardOf({ "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 1 });
    battle.apply({
      kind: "fling",
      t: 0,
      x: -100,
      y: -100,
      r: 200,
      monsters: { C1: 60 },
      champion: { t: 1, l: 1 },
    });
    // Two minutes: the tower falls, everyone walks home and is taken off the
    // field, long before the countdown ends the battle.
    run(battle, 80 * 120);
    expect(battle.state().creepsAlive).toBe(0);
    expect(battle.state().creepsKilled).toBe(0);
    const hp = battle.state().championHp;
    expect(hp).not.toBeNull();
    expect(hp).toBeGreaterThan(0);
  });

  it("reports zero once the champion has actually died", () => {
    const ring: Record<string, { id: number; t: number; l: number; X: number; Y: number }> = {};
    for (let index = 0; index < 24; index += 1) {
      const angle = (index / 24) * Math.PI * 2;
      ring[String(index + 1)] = {
        id: index + 1,
        t: 21,
        l: 5,
        X: Math.round(Math.cos(angle) * 400),
        Y: Math.round(Math.sin(angle) * 400),
      };
    }
    const battle = createBattle(yardOf(ring), { seed: 1 });
    battle.apply({ kind: "fling", t: 0, x: 0, y: 0, r: 200, monsters: {}, champion: { t: 5, l: 5 } });
    run(battle, 80 * 100);
    expect(battle.state().creepsKilled).toBe(1);
    expect(battle.state().championHp).toBe(0);
    expect(battle.state().championsHp).toEqual({ G5: 0 });
  });

  it("keeps each champion's health apart when an ordinary champion and Krallen both fight (#74)", () => {
    const yard = yardOf({ "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } });
    const battle = createBattle(yard, { seed: 1 });
    expect(battle.state().championsHp).toEqual({});
    battle.apply({ kind: "fling", t: 0, x: -100, y: -100, r: 200, monsters: {}, champion: { t: 3, l: 1 } });
    run(battle, 200);
    battle.apply({ kind: "fling", t: battle.tick, x: -100, y: -100, r: 200, monsters: {}, champion: { t: 5, l: 1 } });
    run(battle, 200);
    const hp = battle.state().championsHp;
    expect(Object.keys(hp).sort()).toEqual(["G3", "G5"]);
    expect(hp["G3"]).toBeGreaterThan(0);
    expect(hp["G5"]).toBeGreaterThan(0);
    expect(battle.creeps().filter((creep) => creep.champion)).toHaveLength(2);
  });
});

describe("a flung champion's power level (issue #202)", () => {
  const gorgo = (pl?: number) => {
    const battle = createBattle(yardOf({ "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } }), { seed: 1 });
    battle.apply({
      kind: "fling",
      t: 0,
      x: -300,
      y: -300,
      r: 100,
      monsters: {},
      champion: { t: 1, l: 2, ...(pl === undefined ? {} : { pl }) },
    });
    return battle.creeps().find((creep) => creep.champion)!;
  };

  it("adds its bonus ladders to the level's figures", () => {
    expect(gorgo(3).maxHp).toBe(championStatWithPower("G1", "health", 2, 3));
    expect(gorgo(3).maxHp).toBeGreaterThan(championStat("G1", "health", 2));
  });

  it("fights at its level alone in a log written before power levels, as at power level 0", () => {
    expect(gorgo().maxHp).toBe(championStat("G1", "health", 2));
    expect(gorgo(0).maxHp).toBe(gorgo().maxHp);
  });
});

describe("the battle report's tallies (issue #22)", () => {
  /** Steps until `done`, at most `limit` ticks; the tick it stopped on. */
  const until = (
    battle: ReturnType<typeof createBattle>,
    limit: number,
    done: () => boolean,
  ): number => {
    for (let step = 0; step < limit && !battle.over() && !done(); step += 1) battle.step();
    return battle.tick;
  };

  it("times a tower's first shot, and its fall, and leaves both null while it has neither", () => {
    const lone = createBattle(yardOf({ "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } }), { seed: 1 });
    expect(lone.state().towers[0]).toMatchObject({ firstShotTick: null, destroyedTick: null });
    lone.apply({ kind: "fling", t: 0, x: -100, y: -100, r: 200, monsters: { C1: 1 } });
    const firstShot = until(lone, 1200, () => (lone.state().towers[0]?.shots ?? 0) > 0);
    run(lone, 1200);
    // The Pokey dies under it, so it stands.
    expect(lone.state().towers[0]).toMatchObject({ firstShotTick: firstShot, destroyedTick: null });
    expect(firstShot).toBeGreaterThan(0);

    const swarmed = createBattle(yardOf({ "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } }), { seed: 1 });
    swarmed.apply({ kind: "fling", t: 0, x: -100, y: -100, r: 100, monsters: { C1: 40 } });
    const fell = until(swarmed, 6000, () => swarmed.state().destroyedIds.includes(1));
    const tower = swarmed.state().towers[0]!;
    expect(tower.destroyedTick).toBe(fell);
    expect(tower.firstShotTick).toBeLessThan(fell);
  });

  it("counts a trap's damage and kills, and lists only the traps that went off", () => {
    const trapYard = () =>
      yardOf({
        "1": { id: 1, t: 14, X: 400, Y: 400 },
        "2": { id: 2, t: 24, X: 380, Y: 380 },
      });
    const battle = createBattle(trapYard(), { seed: 3 });
    battle.apply({ kind: "fling", t: 0, x: -60, y: -60, r: 40, monsters: { C1: 3 } });
    const went = until(battle, 4000, () => battle.state().firedTraps.length > 0);
    const [trap, ...others] = battle.state().traps;
    expect(others).toEqual([]);
    expect(trap).toMatchObject({ id: 2, type: 24, tick: went });
    // Every Pokey it killed took its whole 200 off; any it only hurt, some.
    expect(trap!.kills).toBeGreaterThan(0);
    expect(trap!.damageDealt).toBeGreaterThanOrEqual(trap!.kills * 200);
    expect(battle.state().creepsKilled).toBe(trap!.kills);

    const quiet = createBattle(trapYard(), { seed: 3 });
    quiet.apply({ kind: "fling", t: 0, x: 900, y: 900, r: 40, monsters: { C1: 2 } });
    run(quiet, 400);
    expect(quiet.state().traps).toEqual([]);
  });

  it("credits a bunker's garrison with what its defenders sent out did", () => {
    const yard = yardOf({
      "1": { id: 1, t: 22, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 1, l: 1, X: 290, Y: 290 },
    });
    const battle = createBattle(yard, { seed: 3, bunkers: { 1: { C1: 4 } } });
    battle.apply({ kind: "fling", t: 0, x: 270, y: 270, r: 0, monsters: { C1: 1 } });
    run(battle, 3000);
    const state = battle.state();
    // No tower, no trap and no champion: the one Pokey fell to the garrison.
    expect(state.creepsKilled).toBe(1);
    expect(state.bunkers).toEqual([
      expect.objectContaining({ id: 1, level: 1, damageDealt: 200, kills: 1, destroyedTick: null }),
    ]);
    expect(state.bunkers[0]!.sent).toBeGreaterThan(0);
    expect(state.defenderChampion).toBeNull();
  });

  it("credits the caged champion with what it killed, and has no tally without a cage", () => {
    const yard = yardOf({
      "1": { id: 1, t: 114, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 1, l: 1, X: 1200, Y: 1200 },
    });
    const battle = createBattle(yard, { seed: 3, defenderChampion: { t: 1, l: 2, hp: 5000, pl: 1 } });
    battle.apply({ kind: "fling", t: 0, x: 140, y: 140, r: 50, monsters: { C1: 5 } });
    run(battle, 2400);
    expect(battle.state().creepsKilled).toBe(5);
    expect(battle.state().defenderChampion).toEqual({ damageDealt: 5 * 200, kills: 5 });

    // A caged Korath's flame counts as his too.
    const korath = createBattle(
      yardOf({
        "1": { id: 1, t: 114, l: 1, X: 0, Y: 0 },
        "2": { id: 2, t: 1, l: 1, X: 1200, Y: 1200 },
      }),
      { seed: 3, defenderChampion: { t: 4, l: 3, hp: 96000 } },
    );
    // Two D.A.V.E.s of 8,000 health take him a few blows each, and burn between them.
    korath.apply({ kind: "fling", t: 0, x: 140, y: 140, r: 50, monsters: { C12: 2 } });
    run(korath, 4000);
    expect(korath.state().creepsKilled).toBe(2);
    expect(korath.state().defenderChampion).toEqual({ damageDealt: 2 * 8000, kills: 2 });

    const plain = createBattle(yardOf({ "2": { id: 2, t: 1, l: 1, X: 0, Y: 0 } }), { seed: 3 });
    expect(plain.state().defenderChampion).toBeNull();
    expect(plain.state().bunkers).toEqual([]);
  });

  it("gives each monster type and each champion a row, and their building damage adds up", () => {
    const yard = yardOf({
      "1": { id: 1, t: 14, l: 1, X: 400, Y: 400 },
      "2": { id: 2, t: 20, l: 1, X: 200, Y: 0 },
      "3": { id: 3, t: 1, l: 1, X: 0, Y: 200 },
      "4": { id: 4, t: 17, l: 1, X: 300, Y: 300 },
    });
    const start = new Map(yard.buildings.map((building) => [building.id, building.hp]));
    const battle = createBattle(yard, { seed: 5, levels: { C2: 2 } });
    battle.apply({
      kind: "fling",
      t: 0,
      x: -60,
      y: -60,
      r: 80,
      monsters: { C2: 3, C1: 6, C10: 2 },
      champion: { t: 1, l: 1 },
    });
    run(battle, 6000);
    const state = battle.state();
    expect(state.attackers.map((row) => [row.monsterId, row.champion, row.level, row.sent])).toEqual([
      ["C1", false, 1, 6],
      ["C2", false, 2, 3],
      ["C10", false, 1, 2],
      ["G1", true, 1, 1],
    ]);
    const monsters = state.attackers.filter((row) => !row.champion);
    expect(monsters.reduce((sum, row) => sum + row.lost, 0)).toBe(state.creepsKilled);
    const dealt = state.attackers.reduce((sum, row) => sum + row.buildingDamage, 0);
    const lost = yard.buildings.reduce(
      (sum, building) => sum + (start.get(building.id)! - building.hp),
      0,
    );
    expect(dealt).toBeGreaterThan(0);
    expect(dealt).toBeCloseTo(lost, 6);
  });

  it("counts a Slimeattikus's Minis as born on the field, not flung", () => {
    // Three level 6 towers bring a level 3 Slimeattikus down; it leaves 3 Minis (issue #129).
    const yard = yardOf({
      "1": { id: 1, t: 20, l: 6, X: 0, Y: 0 },
      "2": { id: 2, t: 20, l: 6, X: 100, Y: 0 },
      "3": { id: 3, t: 21, l: 6, X: 0, Y: 100 },
      "4": { id: 4, t: 1, l: 1, X: 200, Y: 200 },
    });
    const battle = createBattle(yard, { seed: 3, levels: { C17: 3 } });
    battle.apply({ kind: "fling", t: 0, x: 150, y: 150, r: 0, monsters: { C17: 1 } });
    run(battle, 6000);
    const rows = Object.fromEntries(battle.state().attackers.map((row) => [row.monsterId, row]));
    expect(rows.C17).toMatchObject({ sent: 1, spawned: 0, lost: 1 });
    expect(rows.C18).toMatchObject({ sent: 0, spawned: 3, level: 3 });
  });

  it("leaves the battle itself alone: the same digest with or without anyone reading the tallies", () => {
    const battleOf = () => {
      const battle = createBattle(yardOf({ "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } }), { seed: 4 });
      battle.apply({ kind: "fling", t: 0, x: -100, y: -100, r: 100, monsters: { C1: 20 } });
      return battle;
    };
    const read = battleOf();
    for (let step = 0; step < 3000 && !read.over(); step += 1) {
      read.step();
      read.state();
    }
    const unread = battleOf();
    run(unread, 3000);
    expect(digestOf(read.checkpoint())).toBe(digestOf(unread.checkpoint()));
  });
});
