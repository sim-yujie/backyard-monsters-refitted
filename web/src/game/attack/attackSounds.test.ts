import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { QUAKE_ANIM_FRAMES, type BattleVisualEvent, type SiegeSnapshot } from "@/game/combat/rules";
import { EFFECTS, EffectsPlayer, type Effect, type EffectsBackend } from "@/game/sound/EffectsPlayer";
import {
  AttackSounds,
  BURROW_SOUND_SETTLE_TICKS,
  attackSoundsFor,
  damageSoundFor,
  destroySoundFor,
  freshBurrowSound,
  settleBurrow,
} from "./attackSounds";

/** Buildings by id: type, level. */
const YARD: Record<number, { type: number; level: number }> = {
  1: { type: 20, level: 3 }, // Cannon Tower
  2: { type: 21, level: 2 }, // Sniper Tower
  3: { type: 23, level: 1 }, // Laser Tower
  4: { type: 25, level: 1 }, // Tesla Tower
  5: { type: 115, level: 1 }, // Aerial Defense
  6: { type: 118, level: 1 }, // Railgun
  7: { type: 130, level: 1 }, // Inferno Cannon
  8: { type: 132, level: 1 }, // Magma Tower
  9: { type: 129, level: 1 }, // Quake Tower
  10: { type: 136, level: 1 }, // Spurtz Cannon
  14: { type: 14, level: 6 }, // Town Hall
  22: { type: 22, level: 1 }, // Monster Bunker
  30: { type: 6, level: 1 }, // a level 1 building
  31: { type: 6, level: 4 },
  32: { type: 6, level: 9 },
  40: { type: 24, level: 1 }, // a Trap
};

/** Creeps by id: monster, side. */
const CREEPS: Record<number, { monsterId: string; friendly: boolean }> = {
  100: { monsterId: "C2", friendly: false }, // Octo-ooze: hit1-3
  101: { monsterId: "C7", friendly: false }, // hit3-4
  102: { monsterId: "C14", friendly: false }, // hit4
  103: { monsterId: "IC3", friendly: false }, // Inferno: ihit
  104: { monsterId: "G1", friendly: false }, // champion: hit4
  105: { monsterId: "G3", friendly: false }, // Fomor: hit1-3
  200: { monsterId: "C2", friendly: true }, // a defender
  201: { monsterId: "IC2", friendly: true }, // an Inferno defender
};

const world = (options: { inferno?: boolean; jarred?: number[]; random?: number } = {}) => {
  const played: { effect: Effect; volume: number | undefined }[] = [];
  const sounds = new AttackSounds({
    play: (effect, volume) => played.push({ effect, volume }),
    inferno: options.inferno ?? false,
    building: (id) => YARD[id],
    creepOf: (id) => CREEPS[id],
    jarred: (id) => options.jarred?.includes(id) ?? false,
    random: () => options.random ?? 0,
  });
  return { sounds, played, effects: () => played.map((each) => each.effect) };
};

const shot = (towerId: number): BattleVisualEvent => ({ kind: "shot", tick: 1, towerId, creepId: 100, ix: 0, iy: 0 });

const hit = (creepId: number, target: { building?: number; creep?: number }, ranged = false): BattleVisualEvent => ({
  kind: "hit",
  tick: 1,
  creepId,
  buildingId: target.building ?? -1,
  creepTargetId: target.creep ?? -1,
  ix: 0,
  iy: 0,
  targetIx: 0,
  targetIy: 0,
  ranged,
  flying: false,
  amount: 10,
});

describe("attack sounds", () => {
  it("plops Flash's bankland for each loot orb, on an Inferno yard too (`ParticleLoot.as:27`)", () => {
    for (const inferno of [false, true]) {
      const { sounds, effects } = world({ inferno });
      sounds.onEvent({ kind: "loot", tick: 1, buildingId: 30, resource: 1, amount: 12, vacuum: false });
      sounds.onEvent({ kind: "loot", tick: 2, buildingId: 14, resource: 2, amount: 625, vacuum: true });
      expect(effects()).toEqual(["loot", "loot"]);
    }
    expect(EFFECTS.loot.url).toBe(EFFECTS.bankland.url);
  });

  it("plays each tower's own Flash shot", () => {
    const { sounds, effects } = world();
    for (const id of [1, 2, 3, 4, 5, 6, 7, 8, 10]) sounds.onEvent(shot(id));
    expect(effects()).toEqual([
      "splash1",
      "snipe1",
      "laser",
      "lightningfire",
      "snipe1",
      "railgun1",
      "icannon",
      "magma1",
      "magma1",
    ]);
  });

  it("plays the Inferno sniper's shot on an Inferno yard", () => {
    const { sounds, effects } = world({ inferno: true });
    sounds.onEvent(shot(2));
    expect(effects()).toEqual(["isniper"]);
  });

  it("plays a jarred tower's shot at half, as Flash's isJard did, but not the Inferno Cannon's", () => {
    const { sounds, played } = world({ jarred: [1, 7] });
    sounds.onEvent(shot(1));
    sounds.onEvent(shot(7));
    sounds.onEvent(shot(3));
    expect(played).toEqual([
      { effect: "splash1", volume: 0.4 },
      { effect: "icannon", volume: undefined },
      { effect: "laser", volume: 0.8 },
    ]);
  });

  it("charges, zaps and winds down a Tesla", () => {
    const { sounds, effects } = world();
    sounds.onEvent({ kind: "charge", tick: 1, towerId: 4 });
    sounds.onEvent(shot(4));
    sounds.onEvent({ kind: "coilRest", tick: 9, towerId: 4, rearmBy: null });
    expect(effects()).toEqual(["lightningstart", "lightningfire", "lightningend"]);
  });

  it("sounds the Quake Tower's quake six cells before its wind-up ends, and Korath's at 0.4", () => {
    const { sounds, played } = world();
    for (let cell = 0; cell < QUAKE_ANIM_FRAMES; cell += 1) sounds.onEvent({ kind: "towerCell", tick: cell, towerId: 9, cell });
    sounds.onEvent({ kind: "quake", tick: 40, creepId: 104, ix: 0, iy: 0, radius: 100 });
    expect(played).toEqual([
      { effect: "quake", volume: 0.8 },
      { effect: "quake", volume: 0.4 },
    ]);
  });

  it("opens and shuts the bunker door with its sound", () => {
    const { sounds, effects } = world();
    sounds.onEvent({ kind: "bunkerDoor", tick: 1, buildingId: 22, open: true });
    sounds.onEvent({ kind: "bunkerDoor", tick: 90, buildingId: 22, open: false });
    expect(effects()).toEqual(["bunkerdoor", "bunkerdoor"]);
  });

  it("picks a swing's hit by the monster, quietly, as CreepBase did", () => {
    const { sounds, played } = world({ random: 0.99 });
    for (const id of [100, 101, 102, 103, 104, 105]) sounds.onEvent(hit(id, { building: 30 }));
    expect(played.map((each) => each.effect)).toEqual(["hit3", "hit4", "hit4", "ihit7", "hit4", "hit3"]);
    for (const { volume } of played) {
      expect(volume).toBeGreaterThanOrEqual(0.1);
      expect(volume).toBeLessThanOrEqual(0.2);
    }
    const low = world({ random: 0 });
    for (const id of [100, 101, 103]) low.sounds.onEvent(hit(id, { building: 30 }));
    expect(low.effects()).toEqual(["hit1", "hit3", "ihit1"]);
  });

  it("keeps the defenders' swings silent, but an Inferno defender growls at a new foe", () => {
    const { sounds, effects } = world();
    sounds.onEvent(hit(200, { creep: 100 }));
    sounds.onEvent(hit(201, { creep: 100 }));
    sounds.onEvent(hit(201, { creep: 100 }));
    expect(effects()).toEqual(["imonster1"]);
  });

  it("growls once as a shooter reaches each new target, as Flash's move did", () => {
    const { sounds, effects } = world();
    sounds.onEvent(hit(101, { building: 30 }, true));
    sounds.onEvent(hit(101, { building: 30 }, true));
    sounds.onEvent(hit(101, { building: 31 }, true));
    // A biter does not growl.
    sounds.onEvent(hit(100, { building: 30 }));
    expect(effects()).toEqual(["imonster1", "hit3", "hit3", "imonster1", "hit3", "hit1"]);
  });

  it("thuds and splats a monster's death; D.A.V.E. thuds his own; a champion only thuds", () => {
    const { sounds, effects } = world();
    sounds.onDeath({ monsterId: "C2", champion: false });
    sounds.onDeath({ monsterId: "C12", champion: false });
    sounds.onDeath({ monsterId: "G1", champion: true });
    expect(effects()).toEqual(["monsterland1", "splat1", "monsterland1", "monsterlanddave", "monsterland1"]);
  });

  it("damages and fells a building by its level, the Town Hall with its own fall, a trap with none", () => {
    const { sounds, effects } = world();
    sounds.onBuilding(30, "damaged");
    sounds.onBuilding(32, "damaged");
    sounds.onBuilding(31, "destroyed");
    sounds.onBuilding(14, "destroyed");
    sounds.onBuilding(40, "destroyed");
    sounds.onBuilding(999, "destroyed");
    expect(effects()).toEqual(["damage1", "damage3", "destroy2", "destroytownhall"]);
  });

  it("follows Flash's level ladders for damage and destroy", () => {
    expect([1, 2, 3, 5, 6, 10].map(damageSoundFor)).toEqual(["damage1", "damage1", "damage2", "damage2", "damage3", "damage3"]);
    expect([1, 2, 4, 5, 7, 8, 10].map(destroySoundFor)).toEqual([
      "destroy1",
      "destroy2",
      "destroy2",
      "destroy3",
      "destroy3",
      "destroy4",
      "destroy4",
    ]);
  });

  it("throws each bomb with its resource's sound, burrows and surfaces a Wormzer, sets off a trap", () => {
    const { sounds, played } = world();
    sounds.onBomb(1);
    sounds.onBomb(2);
    sounds.onBomb(3);
    sounds.onBurrow(true);
    sounds.onBurrow(false);
    sounds.onTrap();
    sounds.onTrap(true);
    expect(played.map((each) => each.effect)).toEqual([
      "twigbomb",
      "pebblebomb",
      "puttybomb",
      "dig",
      "arise",
      "trap",
      "trap",
      "trapheavy",
    ]);
  });

  it("throws, cracks and breaks a Jar; throws and blows up the Decoy; drops and lets go the Vacuum", () => {
    const { sounds, effects } = world();
    const none: SiegeSnapshot = { active: null, decoy: null, vacuum: null, jars: [] };
    const jar = (health: number | null, breaking = false) => ({
      buildingId: 1,
      landsAt: 30,
      frame: 0,
      breaking,
      health,
      durability: 100,
    });
    sounds.onSiege(none, 0);
    sounds.onSiege({ ...none, jars: [jar(null)] }, 10);
    sounds.onSiege({ ...none, jars: [jar(100)] }, 30);
    // Above 60% a blow makes no crack; under it, every blow does.
    sounds.onSiege({ ...none, jars: [jar(70)] }, 40);
    sounds.onSiege({ ...none, jars: [jar(50)] }, 50);
    sounds.onSiege({ ...none, jars: [jar(null, true)] }, 60);
    sounds.onSiege(none, 80);
    expect(effects()).toEqual(["jarland", "jarcrack1", "jarexplode1"]);

    const decoy = { x: 0, y: 0, droppedAt: 100, landsAt: 140, explodesAt: 300, range: 100 };
    const later = world();
    later.sounds.onSiege({ ...none, decoy }, 100);
    later.sounds.onSiege({ ...none, decoy }, 200);
    later.sounds.onSiege(none, 300);
    const vacuum = { buildingId: 14, droppedAt: 400, endsAt: 900, health: 50, durability: 50, took: null };
    later.sounds.onSiege({ ...none, vacuum }, 400);
    later.sounds.onSiege({ ...none, vacuum: { ...vacuum, health: 0 } }, 500);
    later.sounds.onSiege(none, 501);
    later.sounds.onSiege({ ...none, vacuum: { ...vacuum, droppedAt: 600 } }, 600);
    later.sounds.onSiege(none, 900);
    expect(later.effects()).toEqual([
      "decoyland",
      "decoyexplode",
      "vacuumstart",
      "vacuumbroken",
      "vacuumstart",
      "vacuumoff",
    ]);
  });

  it("fetches the Inferno's own sounds only for an Inferno yard", () => {
    expect(attackSoundsFor(false)).not.toContain("ihit1");
    expect(attackSoundsFor(false)).not.toContain("icannon");
    expect(attackSoundsFor(false)).toContain("laser");
    expect(attackSoundsFor(true)).toContain("ihit1");
    expect(attackSoundsFor(false)).not.toContain("jarland");
    expect(attackSoundsFor(false, true)).toContain("jarland");
    for (const effect of attackSoundsFor(true)) expect(EFFECTS[effect].attack).toBe(true);
  });

  it("every sound the attack picks is a known effect whose file is on the game server", () => {
    const serverPublic = fileURLToPath(new URL("../../../../server/public", import.meta.url));
    for (const effect of attackSoundsFor(true, true)) {
      expect(existsSync(serverPublic + EFFECTS[effect].url), effect).toBe(true);
    }
  });

  it("is silent with sound effects off, through the real effects player", async () => {
    const starts: Effect[] = [];
    const card: EffectsBackend = {
      running: true,
      resume: () => Promise.resolve(),
      load: (url) => Promise.resolve(url),
      start: (sound) => starts.push(sound as Effect),
    };
    const player = new EffectsPlayer({ createBackend: () => card, gestures: { addEventListener: () => {}, removeEventListener: () => {} }, now: () => 0 });
    const sounds = new AttackSounds({
      play: (effect, volume) => player.play(effect, volume),
      inferno: false,
      building: (id) => YARD[id],
      creepOf: (id) => CREEPS[id],
    });
    player.setEnabled(false);
    player.preload(attackSoundsFor(false));
    sounds.onEvent(shot(1));
    sounds.onDeath({ monsterId: "C2", champion: false });
    sounds.onBuilding(14, "destroyed");
    expect(starts).toHaveLength(0);
    // On, the same three sound.
    player.setEnabled(true);
    player.preload(attackSoundsFor(false));
    await Promise.resolve();
    await Promise.resolve();
    sounds.onEvent(shot(1));
    sounds.onBuilding(14, "destroyed");
    expect(starts).toEqual([EFFECTS.splash1.url, EFFECTS.destroytownhall.url]);
  });

  it("sounds a burrower's dig and arise once each state holds, never while it flips tick by tick", () => {
    const state = freshBurrowSound();
    const heard: (boolean | null)[] = [];
    // Under and up on alternate ticks for a second: silent.
    for (let tick = 0; tick < 80; tick += 1) {
      const sound = settleBurrow(state, tick % 2 === 0, tick);
      if (sound !== null) heard.push(sound);
    }
    expect(heard).toEqual([]);
    // Under for half a second, then up: one dig, one arise, each a settle late.
    const at: number[] = [];
    for (let tick = 100; tick < 200; tick += 1) {
      const sound = settleBurrow(state, tick < 140, tick);
      if (sound !== null) {
        heard.push(sound);
        at.push(tick);
      }
    }
    expect(heard).toEqual([true, false]);
    expect(at).toEqual([100 + BURROW_SOUND_SETTLE_TICKS, 140 + BURROW_SOUND_SETTLE_TICKS]);
  });
});
