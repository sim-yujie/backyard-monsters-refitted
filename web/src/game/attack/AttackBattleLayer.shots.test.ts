import { describe, expect, it } from "vitest";
import { Container, Texture, TextureSource } from "pixi.js";
import type { BaseLoadResponse } from "@/api/types";
import { TICKS_PER_SECOND, type BattleVisualEvent } from "@/game/combat/rules";
import { readYard } from "@/game/yard/yardModel";
import {
  AttackBattleLayer,
  MonsterSheetTextures,
  type BattleYardHost,
} from "./AttackBattleLayer";
import { AttackSession } from "./AttackSession";
import type { AttackTarget } from "./attackTarget";
import { PROJECTILE_TICKS } from "./creepFx";
import { MONSTER_SPRITES } from "./monsterSpriteData";
import { sheetUrl } from "./monsterSprites";

/**
 * A tower's bullet hurts when it lands, not when it is fired (issue #77): over
 * a real session, the creep's bar, its number and — for a killing shot — its
 * death all wait for the sniper's bullet, although the engine took the health
 * off on the shot tick.
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

const targetOf = (monsters: Record<string, number> = { C1: 20 }): AttackTarget => ({
  baseid: "3502",
  kind: "wild",
  cell: { col: 241, row: 208 },
  name: "Kozu",
  roster: {
    monsters,
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
}

const hostOf = (): Host => {
  const depth = new Container();
  depth.sortableChildren = true;
  const damage = new Map<number, number>();
  return {
    damage,
    depthSortedLayer: () => depth,
    centreOf: () => ({ x: 400, y: 400 }),
    setBuildingDamage: (id, fraction) => damage.set(id, fraction),
    setConcealed: () => {},
    setAnimFrame: () => {},
  };
};

const setUp = (buildings: BuildingRow[], monsters?: Record<string, number>) => {
  const session = new AttackSession({ target: targetOf(monsters), seed: 1 });
  const response = yardOf(buildings);
  session.load(response);
  const host = hostOf();
  const layer = new AttackBattleLayer({
    session,
    yard: readYard(response),
    host,
    overlay: new Container(),
    reducedMotion: false,
    textures: new MonsterSheetTextures(blankSheet),
  });
  return { session, layer, host };
};

/** One frame of `ticks` battle ticks; the events it produced. */
const frame = (
  session: AttackSession,
  layer: AttackBattleLayer,
  ticks = 1,
): readonly BattleVisualEvent[] => {
  const before = session.battle()?.tick ?? 0;
  session.advance(ticks / TICKS_PER_SECOND);
  layer.update();
  return session.battle()?.recentEvents(before) ?? [];
};

const engineFraction = (session: AttackSession, id: number): number | null => {
  const creep = session
    .battle()
    ?.creeps()
    .find((candidate) => candidate.id === id);
  return creep ? creep.hp / creep.maxHp : null;
};

describe("a sniper's bullet (#77)", () => {
  it("keeps the creep's bar full and shows no number until the bullet lands", () => {
    const { session, layer } = setUp([{ id: 1, t: 21, l: 1, X: 0, Y: 0 }]);
    session.appendFling({ x: -150, y: -150, monsters: { C1: 1 } });

    let target = -1;
    let shotTick = -1;
    for (let step = 0; step < 20 * TICKS_PER_SECOND && target < 0; step += 1) {
      const shot = frame(session, layer).find((event) => event.kind === "shot");
      if (shot?.kind === "shot") {
        target = shot.creepId;
        shotTick = shot.tick;
      }
    }
    expect(target).toBeGreaterThanOrEqual(0);

    // The engine has taken the hundred off already; the screen has not.
    expect(engineFraction(session, target)).toBeCloseTo(0.5);
    expect(layer.heldShots).toBe(1);
    expect(layer.shownHealthOf(target)).toBe(1);
    expect(layer.creepEffects.labelsFor(`creep:${target}`)).toHaveLength(0);

    let landedTick = -1;
    for (let step = 0; step < 2 * TICKS_PER_SECOND && landedTick < 0; step += 1) {
      frame(session, layer);
      if (layer.heldShots === 0) {
        landedTick = session.battle()?.tick ?? -1;
        break;
      }
      expect(layer.shownHealthOf(target)).toBe(1);
      expect(layer.creepEffects.labelsFor(`creep:${target}`)).toHaveLength(0);
    }
    // Half the sniper's speed of 10 a tick: a real flight, not the next tick.
    expect(landedTick - shotTick).toBeGreaterThan(5);
    expect(layer.shownHealthOf(target)).toBeCloseTo(0.5);
    expect(
      layer.creepEffects.labelsFor(`creep:${target}`).map((label) => label.amount),
    ).toEqual([-100]);
    layer.destroy();
  });

  it("keeps a creep the bullet killed on screen until it lands, then splats it", () => {
    const { session, layer } = setUp([{ id: 1, t: 21, l: 1, X: 0, Y: 0 }]);
    // Dropped off to the side, so the killing shot finds the Pokey still some
    // way out and the bullet has a real flight to make.
    session.appendFling({ x: -200, y: -100, monsters: { C1: 1 } });

    let killed = -1;
    for (let step = 0; step < 30 * TICKS_PER_SECOND && killed < 0; step += 1) {
      const death = frame(session, layer).find((event) => event.kind === "death");
      if (death?.kind === "death") killed = death.creepId;
    }
    expect(killed).toBeGreaterThanOrEqual(0);
    // Gone from the engine, still standing on screen with the health it had.
    expect(engineFraction(session, killed)).toBeNull();
    expect(layer.shownHealthOf(killed)).toBeCloseTo(0.5);
    expect(layer.creepCount).toBe(1);

    let frames = 0;
    while (layer.shownHealthOf(killed) !== null && frames < 2 * TICKS_PER_SECOND) {
      frame(session, layer);
      frames += 1;
    }
    expect(frames).toBeGreaterThan(5);
    expect(layer.shownHealthOf(killed)).toBeNull();
    expect(layer.creepCount).toBe(0);
    expect(layer.heldShots).toBe(0);
    layer.destroy();
  });

  it("lands the bullet on the same tick at 2x as at 1x", () => {
    const landing = (ticksPerFrame: number): number => {
      const { session, layer } = setUp([{ id: 1, t: 21, l: 1, X: 0, Y: 0 }]);
      session.appendFling({ x: -150, y: -150, monsters: { C1: 1 } });
      let target = -1;
      for (let step = 0; step < 20 * TICKS_PER_SECOND; step += 1) {
        const shot = frame(session, layer, ticksPerFrame).find(
          (event) => event.kind === "shot",
        );
        if (shot?.kind === "shot") target = shot.creepId;
        if (target >= 0 && layer.heldShots === 0) break;
      }
      const tick = session.battle()?.tick ?? -1;
      const hp = layer.shownHealthOf(target);
      layer.destroy();
      expect(hp).toBeCloseTo(0.5);
      return tick;
    };
    const oneX = landing(1);
    const twoX = landing(2);
    // At 2x a frame covers two ticks, so the frame that sees it land ends on
    // its tick or the one after.
    expect(twoX - oneX).toBeGreaterThanOrEqual(0);
    expect(twoX - oneX).toBeLessThanOrEqual(1);
  });
});

describe("a ranged creep's fireball (#77)", () => {
  it("darkens the building it hits when it lands, not when it is thrown", () => {
    const { session, layer, host } = setUp([{ id: 1, t: 14, l: 1, X: 0, Y: 0 }], { C14: 5 });
    session.appendFling({ x: -250, y: -250, monsters: { C14: 1 } });

    let hitTick = -1;
    for (let step = 0; step < 30 * TICKS_PER_SECOND && hitTick < 0; step += 1) {
      const hit = frame(session, layer).find(
        (event) =>
          event.kind === "hit" && event.ranged && event.buildingId === 1 && event.amount > 0,
      );
      if (hit) hitTick = hit.tick;
    }
    expect(hitTick).toBeGreaterThan(0);
    // The engine has the building hurt; the picture still shows it whole,
    // even when the session tells the layer to look again mid-flight (a
    // speed change notifies, as its quarter-second ticks do).
    expect(session.battle()?.state().health["1"]).toBeDefined();
    session.setSpeed(2);
    session.setSpeed(1);
    layer.update();
    expect(host.damage.get(1) ?? 1).toBe(1);

    for (let step = 0; step < PROJECTILE_TICKS - 1; step += 1) {
      frame(session, layer);
      session.setSpeed(2);
      session.setSpeed(1);
      layer.update();
      expect(host.damage.get(1) ?? 1).toBe(1);
    }
    frame(session, layer);
    expect(host.damage.get(1)).toBeLessThan(1);
    layer.destroy();
  });
});
