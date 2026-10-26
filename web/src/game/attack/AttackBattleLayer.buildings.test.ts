import { describe, expect, it } from "vitest";
import { Container, Texture, TextureSource } from "pixi.js";
import type { BaseLoadResponse } from "@/api/types";
import { readYard } from "@/game/yard/yardModel";
import { AttackBattleLayer, MonsterSheetTextures, type BattleYardHost } from "./AttackBattleLayer";
import { AttackSession } from "./AttackSession";
import type { AttackTarget } from "./attackTarget";
import { MONSTER_SPRITES } from "./monsterSpriteData";
import { sheetUrl } from "./monsterSprites";

/**
 * The building side of the battle layer over a real session (issues #64, #66,
 * #67): a shot turns the tower's gun through the host, a fired trap is
 * revealed through the host and marked with a scorch, and a damaged building
 * gets a bar.
 */

type BuildingRow = { id: number; t: number; l: number; X: number; Y: number };

const yardOf = (buildings: BuildingRow[]): BaseLoadResponse =>
  ({
    error: 0,
    id: 1,
    baseid: "3502",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: 1_700_000_000,
    buildingdata: Object.fromEntries(buildings.map((row) => [String(row.id), row])),
    buildinghealthdata: {},
    resources: { r1: 1000, r2: 0, r3: 0, r4: 0 },
    attackid: 77,
    storedata: {},
  }) as unknown as BaseLoadResponse;

const targetOf = (): AttackTarget => ({
  baseid: "3502",
  kind: "wild",
  cell: { col: 241, row: 208 },
  name: "Kozu",
  roster: {
    monsters: { C1: 20 },
    levels: {},
    champions: [],
    flingerLevel: 4,
    catapultLevel: 0,
    sources: [],
    siege: null,
    resources: null,
  },
});

const blankSheet = (url: string): Promise<Texture> => {
  const sheet = Object.values(MONSTER_SPRITES).find((candidate) => url === sheetUrl(candidate));
  if (!sheet) throw new Error(`no sheet at ${url}`);
  return Promise.resolve(
    new Texture({ source: new TextureSource({ width: sheet.width, height: sheet.height }) }),
  );
};

interface Host extends BattleYardHost {
  readonly damage: Map<number, number>;
  readonly concealed: Set<number>;
  readonly frames: Map<string, number>;
}

const hostOf = (): Host => {
  const depth = new Container();
  depth.sortableChildren = true;
  const host: Host = {
    damage: new Map(),
    concealed: new Set(),
    frames: new Map(),
    depthSortedLayer: () => depth,
    centreOf: (id) => (host.concealed.has(id) ? null : { x: 400, y: 400 }),
    setBuildingDamage: (id, fraction) => host.damage.set(id, fraction),
    setConcealed: (id, on) => (on ? host.concealed.add(id) : host.concealed.delete(id)),
    setAnimFrame: (id, layer, frame) => host.frames.set(`${id}:${layer}`, frame),
  };
  return host;
};

/** A repeatable stream in [0, 1), for the bomb rain. */
const seeded = (): (() => number) => {
  let state = 11;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
};

const setUp = (buildings: BuildingRow[], now: () => number = () => 0) => {
  const session = new AttackSession({ target: targetOf(), seed: 1 });
  const response = yardOf(buildings);
  session.load(response);
  const yard = readYard(response);
  const host = hostOf();
  const overlay = new Container();
  const layer = new AttackBattleLayer({
    session,
    yard,
    host,
    overlay,
    reducedMotion: false,
    textures: new MonsterSheetTextures(blankSheet),
    bombArt: { cell: () => Texture.WHITE, destroy() {} },
    random: seeded(),
    now,
  });
  return { session, yard, host, overlay, layer };
};

const play = (session: AttackSession, seconds: number, layer: AttackBattleLayer): void => {
  const frames = Math.ceil(seconds * 60);
  for (let frame = 0; frame < frames; frame += 1) {
    session.advance(1 / 60);
    layer.update();
  }
};

describe("towers", () => {
  it("turns a sniper's gun through the host once it has shot at something", () => {
    const { session, host, layer } = setUp([{ id: 1, t: 21, l: 1, X: 0, Y: 0 }]);
    session.appendFling({ x: -150, y: -150, monsters: { C1: 3 } });
    play(session, 6, layer);
    expect(session.battle()?.state().towers[0]?.shots ?? 0).toBeGreaterThan(0);
    const cell = host.frames.get("1:0");
    expect(cell).toBeDefined();
    expect(cell).toBeGreaterThanOrEqual(0);
    expect(cell).toBeLessThan(30);
    layer.destroy();
  });

  it("leaves a cannon's frame alone: it has no gun strip", () => {
    const { session, host, layer } = setUp([{ id: 1, t: 20, l: 1, X: 0, Y: 0 }]);
    session.appendFling({ x: -150, y: -150, monsters: { C1: 3 } });
    play(session, 6, layer);
    expect(session.battle()?.state().towers[0]?.shots ?? 0).toBeGreaterThan(0);
    expect(host.frames.size).toBe(0);
    layer.destroy();
  });
});

describe("traps", () => {
  it("reveals a trap through the host when the engine says it fired, and scorches the ground", () => {
    // A town hall to walk to, with a trap in the way of the drop.
    const { session, host, overlay, layer } = setUp([
      { id: 1, t: 14, l: 1, X: 200, Y: 200 },
      { id: 2, t: 24, l: 1, X: 0, Y: 0 },
    ]);
    host.concealed.add(2);
    const effects = overlay.children[0] as Container;
    const decorations = effects.children.length;
    session.appendFling({ x: 10, y: 10, monsters: { C1: 20 } });
    play(session, 8, layer);
    expect(session.battle()?.state().firedTraps).toEqual([2]);
    expect(host.concealed.has(2)).toBe(false);
    // Its zero health draws it as a ruin.
    expect(host.damage.get(2)).toBe(0);
    // The scorch stays; the ring is gone within a second.
    expect(effects.children.length).toBeGreaterThan(decorations);
    layer.destroy();
  });
});

describe("building bars", () => {
  it("puts a bar in the effects layer once a building is hurt, and takes it away at zero", () => {
    const { session, overlay, layer } = setUp([{ id: 1, t: 20, l: 1, X: 0, Y: 0 }]);
    const effects = overlay.children[0] as Container;
    const bars = effects.children[0] as Container;
    expect(bars.children).toHaveLength(0);
    session.appendFling({ x: -100, y: -100, monsters: { C1: 8 } });
    play(session, 6, layer);
    const state = session.battle()?.state();
    const hp = state?.health["1"];
    expect(hp).toBeDefined();
    expect(hp).toBeGreaterThan(0);
    expect(bars.children.filter((sprite) => sprite.visible)).toHaveLength(2);
    play(session, 30, layer);
    expect(session.battle()?.state().destroyedIds).toEqual([1]);
    expect(bars.children.filter((sprite) => sprite.visible)).toHaveLength(0);
    layer.destroy();
  });
});

describe("bombs (#87)", () => {
  it("holds a bomb's damage back and lets it go with the rain, ending where the engine is", () => {
    // A Cannon Tower inside a small pebble bomb's blast, which leaves it
    // standing, and a wall block beside it, which a pebble share is too small
    // to dent (6% of 12 truncates to nothing).
    const { session, host, layer } = setUp([
      { id: 1, t: 20, l: 1, X: 0, Y: 0 },
      { id: 2, t: 17, l: 1, X: 60, Y: 0 },
    ]);
    session.start();
    play(session, 0.1, layer);
    session.appendBomb({ x: 20, y: 10, id: "pb0" });
    const engine = session.battle()!.state().health;
    expect(engine["1"]).toBe(4000);
    expect(engine["2"]).toBeUndefined();
    layer.update();
    // Nothing shown yet: the engine has it all, the screen none of it.
    expect(layer.heldBombDamage(1)).toBe(2000);
    expect(layer.heldBombDamage(2)).toBe(0);
    expect(host.damage.get(1) ?? 1).toBe(1);
    expect(layer.bombEffects.airborne).toBe(200);

    // Part way through the rain the tower is part way down.
    play(session, 2.5, layer);
    const partway = layer.heldBombDamage(1);
    expect(partway).toBeGreaterThan(0);
    expect(partway).toBeLessThan(2000);
    expect(host.damage.get(1)).toBeLessThan(1);
    expect(host.damage.get(1)).toBeGreaterThan(4000 / 6000);
    expect(layer.bombEffects.airborne).toBeGreaterThan(0);
    expect(layer.bombEffects.airborne).toBeLessThan(200);

    // Once every particle is down the screen shows exactly what the engine did.
    play(session, 4, layer);
    expect(layer.bombEffects.airborne).toBe(0);
    expect(layer.heldBombDamage(1)).toBe(0);
    expect(host.damage.get(1)).toBeCloseTo(4000 / 6000, 9);
    expect(host.damage.has(2)).toBe(false);
    layer.destroy();
  });

  it("keeps the rain falling on the wall clock after the attack ends, and says so (#148)", () => {
    let ms = 0;
    const { session, layer } = setUp([{ id: 1, t: 20, l: 1, X: 0, Y: 0 }], () => ms);
    session.start();
    session.appendBomb({ x: 0, y: 0, id: "tw0" });
    // Fired, not yet drawn: already settling.
    expect(layer.settling).toBe(true);
    play(session, 1.2, layer);
    const airborne = layer.bombEffects.airborne;
    expect(airborne).toBeGreaterThan(0);
    session.retreat();
    layer.update();
    // The battle clock has stopped, the rain has not.
    expect(layer.bombEffects.airborne).toBe(airborne);
    expect(layer.settling).toBe(true);
    const tick = session.battle()!.tick;
    for (let frame = 0; frame < 60 * 8; frame += 1) {
      ms += 1000 / 60;
      layer.update();
    }
    expect(session.battle()!.tick).toBe(tick);
    expect(layer.bombEffects.airborne).toBe(0);
    expect(layer.heldBombDamage(1)).toBe(0);
    expect(layer.settling).toBe(false);
    layer.destroy();
  });

  it("shows the damage the rain has brought down, not what the engine booked (#148)", () => {
    const { session, layer } = setUp([{ id: 1, t: 20, l: 1, X: 0, Y: 0 }]);
    session.start();
    play(session, 0.1, layer);
    expect(layer.shownDamage()).toBe(0);
    session.appendBomb({ x: 20, y: 10, id: "pb0" });
    const booked = session.state().damagePercent;
    expect(booked).toBeGreaterThan(0);
    // Read before the layer has drawn a frame: the bomb is held back already.
    expect(layer.shownDamage()).toBe(0);
    play(session, 2.5, layer);
    const partway = layer.shownDamage();
    expect(partway).toBeGreaterThan(0);
    expect(partway).toBeLessThan(booked);
    play(session, 4, layer);
    expect(layer.shownDamage()).toBeCloseTo(session.state().damagePercent, 9);
    layer.destroy();
  });
});
