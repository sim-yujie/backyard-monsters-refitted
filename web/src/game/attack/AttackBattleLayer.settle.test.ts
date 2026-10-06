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
import { MONSTER_SPRITES } from "./monsterSpriteData";
import { sheetUrl } from "./monsterSprites";

/**
 * An ended battle put to rest (#308): the engine stops on the tick the battle
 * ended, so without {@link AttackBattleLayer.settle} its last frame — creeps
 * mid-step, a bullet in the air — stood on screen behind the Baiter's report
 * as if the game had hung. Settled, the creeps go, the guns stand down and
 * nothing is drawn back on the following frames.
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

/** Runs the battle until the sniper has a bullet in the air over live creeps. */
const midFight = (session: AttackSession, layer: AttackBattleLayer): void => {
  session.appendFling({ x: -150, y: -150, monsters: { C1: 5 } });
  for (let step = 0; step < 20 * TICKS_PER_SECOND; step += 1) {
    frame(session, layer);
    if (layer.towerEffects.flyingCount > 0 && layer.creepCount > 0) return;
  }
  throw new Error("the sniper never fired");
};

describe("an ended battle put to rest (#308)", () => {
  it("stands frozen on its last frame when it is not settled: a real attack's end", () => {
    const { session, layer } = setUp([{ id: 1, t: 21, l: 1, X: 0, Y: 0 }]);
    midFight(session, layer);
    session.retreat();
    expect(session.state().phase).toBe("ended");
    layer.update();
    layer.update();
    // Unchanged for a real attack: the creeps stay where the battle stopped.
    expect(layer.creepCount).toBeGreaterThan(0);
    expect(layer.isSettled).toBe(false);
    layer.destroy();
  });

  it("takes every creep and every shot off once settled, and draws none back", () => {
    const { session, layer } = setUp([{ id: 1, t: 21, l: 1, X: 0, Y: 0 }]);
    midFight(session, layer);
    session.retreat();
    layer.update();
    // The engine still has its creeps: the battle stopped, it did not clear.
    expect(session.battle()!.creeps().length).toBeGreaterThan(0);

    layer.settle();
    expect(layer.isSettled).toBe(true);
    expect(layer.creepCount).toBe(0);
    expect(layer.towerEffects.flyingCount).toBe(0);
    expect(layer.heldShots).toBe(0);
    expect(layer.creepEffects.projectileCount).toBe(0);
    for (let frames = 0; frames < 5; frames += 1) layer.update();
    expect(layer.creepCount).toBe(0);
    expect(layer.towerEffects.flyingCount).toBe(0);
    // A second settle changes nothing.
    layer.settle();
    expect(layer.creepCount).toBe(0);
    layer.destroy();
  });

  it("shows the engine's own damage once settled, nothing held back", () => {
    const { session, layer } = setUp([{ id: 1, t: 21, l: 1, X: 0, Y: 0 }], { C1: 30 });
    session.appendFling({ x: -150, y: -150, monsters: { C1: 30 } });
    for (let step = 0; step < 30 * TICKS_PER_SECOND && session.state().damagePercent <= 0; step += 1) {
      frame(session, layer);
    }
    session.retreat();
    expect(session.state().damagePercent).toBeGreaterThan(0);
    layer.settle();
    layer.update();
    expect(layer.shownDamage()).toBe(session.state().damagePercent);
    layer.destroy();
  });
});
