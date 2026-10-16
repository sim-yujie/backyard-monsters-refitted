import { describe, expect, it } from "vitest";
import { Container, Texture, TextureSource } from "pixi.js";
import type { BaseLoadResponse } from "@/api/types";
import { TICKS_PER_SECOND } from "@/game/combat/rules";
import { readYard } from "@/game/yard/yardModel";
import {
  AttackBattleLayer,
  MonsterSheetTextures,
  type BattleYardHost,
} from "./AttackBattleLayer";
import { AttackSession } from "./AttackSession";
import type { AttackTarget } from "./attackTarget";
import { MONSTER_SPRITES } from "./monsterSpriteData";
import { sheetUrl } from "./monsterSprites";
import { WALK_OFF_PAUSE_TICKS, WALK_OFF_TICKS } from "./walkOff";

/**
 * Monsters walk off rather than vanish. The engine takes a creep with
 * nothing left to attack off the field at once, and an attack whose last
 * target falls ends with its army frozen; the screen walks them away toward
 * the edge, fading, and the end panel waits for them. Display only: the
 * battle underneath is the same tick for tick.
 */

type BuildingRow = { id: number; t: number; l: number; X: number; Y: number };

/** A lone Twig Snapper: something a Pokey can knock down. */
const SNAPPER: BuildingRow = { id: 1, t: 1, l: 1, X: 0, Y: 0 };

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

const targetOf = (monsters: Record<string, number>): AttackTarget => ({
  baseid: "3502",
  kind: "wild",
  cell: { col: 241, row: 208 },
  name: "Kozu",
  roster: {
    monsters,
    levels: {},
    // A level 1 Fomor, awake and fed: a flyer to call back.
    champions: [{ t: 3, hp: 1000, l: 1, ft: 0, fd: 0, fb: 0, pl: 0, status: 0 }],
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
  readonly depth: Container;
}

const hostOf = (): Host => {
  const depth = new Container();
  depth.sortableChildren = true;
  return {
    depth,
    depthSortedLayer: () => depth,
    centreOf: () => ({ x: 400, y: 400 }),
    setBuildingDamage: () => {},
    setConcealed: () => {},
    setAnimFrame: () => {},
  };
};

const sessionOf = (monsters: Record<string, number>, buildings: BuildingRow[]): AttackSession => {
  const session = new AttackSession({ target: targetOf(monsters), seed: 1 });
  session.load(yardOf(buildings));
  return session;
};

const setUp = (monsters: Record<string, number>, buildings: BuildingRow[] = [SNAPPER]) => {
  const session = sessionOf(monsters, buildings);
  const host = hostOf();
  const clock = { ms: 0 };
  const layer = new AttackBattleLayer({
    session,
    yard: readYard(yardOf(buildings)),
    host,
    overlay: new Container(),
    reducedMotion: false,
    textures: new MonsterSheetTextures(blankSheet),
    now: () => clock.ms,
  });
  return { session, layer, host, clock };
};

/** One frame of `ticks` battle ticks, with the wall clock moving along. */
const frame = (
  session: AttackSession,
  layer: AttackBattleLayer,
  clock: { ms: number },
  ticks = 1,
): void => {
  session.advance(ticks / TICKS_PER_SECOND);
  clock.ms += (ticks / TICKS_PER_SECOND / session.speed) * 1000;
  layer.update();
};

/** Plays until the session ends, or throws; the layer has not drawn the ending yet. */
const playToEnd = (session: AttackSession, layer: AttackBattleLayer, clock: { ms: number }): void => {
  for (let step = 0; step < 120 * TICKS_PER_SECOND; step += 1) {
    session.advance(1 / TICKS_PER_SECOND);
    clock.ms += 1000 / TICKS_PER_SECOND / session.speed;
    if (session.ended) return;
    layer.update();
  }
  throw new Error("the attack never ended");
};

/** The visible creep bodies, as drawn. */
const bodies = (host: Host) =>
  host.depth.children.filter((child) => child.visible).map((child) => ({ x: child.x, y: child.y, alpha: child.alpha }));

const attackersAlive = (session: AttackSession): number =>
  session.battle()!.creeps().filter((creep) => !creep.friendly && creep.hp > 0).length;

/** Wall-clock ms a walk-off and its pause take at a speed. */
const walkOffMs = (speed: number): number =>
  ((WALK_OFF_TICKS + WALK_OFF_PAUSE_TICKS) / TICKS_PER_SECOND / speed) * 1000;

describe("monsters walking off at the end of an attack", () => {
  it("walks the army off when its last target falls, and holds the end panel until they are gone", () => {
    const { session, layer, host, clock } = setUp({ C1: 30 });
    session.appendFling({ x: -150, y: -150, monsters: { C1: 30 } });
    playToEnd(session, layer, clock);
    const endedAt = clock.ms;
    expect(session.endedBy).toBe("destroyed");
    const alive = attackersAlive(session);
    expect(alive).toBeGreaterThan(0);
    // Asked before the next frame, the end panel already waits.
    expect(layer.settling).toBe(true);

    layer.update();
    expect(layer.walkingOffCount).toBe(alive);
    const before = bodies(host);

    clock.ms += 700;
    layer.update();
    expect(layer.settling).toBe(true);
    const during = bodies(host);
    expect(during).toHaveLength(alive);
    // They have moved, and nobody is drawn where it stood.
    const moved = during.filter((body, index) => {
      const was = before[index];
      return was !== undefined && (body.x !== was.x || body.y !== was.y);
    });
    expect(moved.length).toBe(alive);

    clock.ms += 600;
    layer.update();
    expect(bodies(host).every((body) => body.alpha < 1)).toBe(true);

    clock.ms = endedAt + walkOffMs(1) + 50;
    layer.update();
    expect(layer.settling).toBe(false);
    expect(layer.creepCount).toBe(0);
    expect(bodies(host)).toHaveLength(0);
    // The frozen field never draws them back.
    layer.update();
    expect(layer.creepCount).toBe(0);
    layer.destroy();
  });

  it("walks off twice as fast at 2x", () => {
    const { session, layer, clock } = setUp({ C1: 30 });
    session.setSpeed(2);
    session.appendFling({ x: -150, y: -150, monsters: { C1: 30 } });
    playToEnd(session, layer, clock);
    const endedAt = clock.ms;
    layer.update();
    expect(layer.walkingOffCount).toBeGreaterThan(0);
    clock.ms = endedAt + walkOffMs(2) - 100;
    layer.update();
    expect(layer.settling).toBe(true);
    clock.ms = endedAt + walkOffMs(2) + 50;
    layer.update();
    expect(layer.settling).toBe(false);
    expect(layer.creepCount).toBe(0);
    layer.destroy();
  });

  it("keeps the wait to one walk-off however big the army", () => {
    const { session, layer, clock } = setUp({ C1: 120 });
    session.appendFling({ x: -150, y: -150, monsters: { C1: 120 } });
    playToEnd(session, layer, clock);
    const endedAt = clock.ms;
    layer.update();
    expect(layer.walkingOffCount).toBeGreaterThan(50);
    clock.ms = endedAt + walkOffMs(1) + 50;
    layer.update();
    expect(layer.settling).toBe(false);
    layer.destroy();
  });

  it("does not hold the end panel for a Retreat the player chose, but still walks the army off", () => {
    const { session, layer, clock } = setUp({ C1: 10 });
    session.appendFling({ x: -300, y: -300, monsters: { C1: 10 } });
    for (let step = 0; step < TICKS_PER_SECOND; step += 1) frame(session, layer, clock);
    session.retreat();
    expect(layer.settling).toBe(false);
    layer.update();
    expect(layer.walkingOffCount).toBe(10);
    expect(layer.settling).toBe(false);
    clock.ms += walkOffMs(1);
    layer.update();
    expect(layer.creepCount).toBe(0);
    layer.destroy();
  });

  it("walks nothing off for a player leaving the screen", () => {
    const { session, layer, clock } = setUp({ C1: 10 });
    session.appendFling({ x: -300, y: -300, monsters: { C1: 10 } });
    for (let step = 0; step < TICKS_PER_SECOND; step += 1) frame(session, layer, clock);
    session.leave();
    expect(layer.settling).toBe(false);
    layer.update();
    expect(layer.walkingOffCount).toBe(0);
    layer.destroy();
  });
});

describe("a monster walking off mid-attack", () => {
  it("flies a called-back champion off instead of blinking it out, while the attack goes on", () => {
    const { session, layer, host, clock } = setUp({ C1: 1 });
    session.appendFling({ x: -300, y: -300, monsters: {}, champion: { t: 3, l: 1 } });
    for (let step = 0; step < TICKS_PER_SECOND; step += 1) frame(session, layer, clock);
    expect(session.retreatChampion(3)).toBe(true);
    frame(session, layer, clock);
    expect(session.battle()!.creeps().some((creep) => creep.champion)).toBe(false);
    expect(layer.walkingOffCount).toBe(1);
    expect(session.ended).toBe(false);
    // The end panel's wait is for an ended attack only.
    expect(layer.settling).toBe(false);
    const start = bodies(host);
    expect(start.length).toBeGreaterThan(0);

    for (let step = 0; step < WALK_OFF_TICKS / 2; step += 1) frame(session, layer, clock);
    expect(layer.walkingOffCount).toBe(1);
    const midway = bodies(host);
    expect(midway.some((body, index) => body.y !== start[index]?.y || body.x !== start[index]?.x)).toBe(true);

    for (let step = 0; step < WALK_OFF_TICKS / 2 + 1; step += 1) frame(session, layer, clock);
    expect(layer.walkingOffCount).toBe(0);
    expect(layer.creepCount).toBe(0);
    layer.destroy();
  });

  it("changes nothing in the battle: the same checkpoints as a battle nobody draws", () => {
    const drawn = setUp({ C1: 30 });
    const bare = sessionOf({ C1: 30 }, [SNAPPER]);
    for (const session of [drawn.session, bare]) {
      session.appendFling({ x: -150, y: -150, monsters: { C1: 30 } });
      session.appendFling({ x: -300, y: 0, monsters: {}, champion: { t: 3, l: 1 } });
    }
    for (let step = 0; step < 120 * TICKS_PER_SECOND && !drawn.session.ended; step += 1) {
      if (step === TICKS_PER_SECOND) {
        drawn.session.retreatChampion(3);
        bare.retreatChampion(3);
      }
      frame(drawn.session, drawn.layer, drawn.clock);
      bare.advance(1 / TICKS_PER_SECOND);
      expect(drawn.session.battle()!.checkpoint()).toEqual(bare.battle()!.checkpoint());
    }
    expect(drawn.session.ended).toBe(true);
    expect(bare.ended).toBe(true);
    // And the walk-off after the end leaves the result where it was.
    const result = drawn.session.state();
    drawn.clock.ms += walkOffMs(1) + 50;
    drawn.layer.update();
    expect(drawn.session.state()).toEqual(result);
    expect(drawn.session.state()).toEqual(bare.state());
    drawn.layer.destroy();
  });
});
