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
 * Eye-ra's fiery blast (feat/eyera-explosion) is drawing only: over a real
 * session it draws a fireball in place of the yellow rings, and the battle
 * comes out the same as one nobody draws.
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

const setUp = (buildings: BuildingRow[], monsters: Record<string, number>, classic = false) => {
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
    ...(classic ? { classic, juice: "full" as const } : {}),
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

/** Runs the battle until the first Eye-ra goes off; that frame's events. */
const untilBlast = (session: AttackSession, layer: AttackBattleLayer) => {
  for (let step = 0; step < TICKS_PER_SECOND * 40; step += 1) {
    const events = frame(session, layer);
    if (events.some((event) => event.kind === "splash" && event.moveId === "C5")) return events;
  }
  throw new Error("no Eye-ra blast");
};

describe("an Eye-ra's blast, drawn as a fireball (feat/eyera-explosion)", () => {
  it("draws the fireball and its scorch, not the yellow rings", () => {
    const { session, layer } = setUp([{ id: 1, t: 14, l: 1, X: 0, Y: 0 }], { C5: 2 });
    session.appendFling({ x: -150, y: -150, monsters: { C5: 1 } });
    untilBlast(session, layer);
    expect(layer.blasts.blastsMade).toBe(1);
    expect(layer.blasts.bitCount).toBeGreaterThan(0);
    expect(layer.blasts.markCount).toBe(1);
  });

  it("draws Flash's yellow rings in the Classic look, no fireball", () => {
    const { session, layer } = setUp([{ id: 1, t: 14, l: 1, X: 0, Y: 0 }], { C5: 2 }, true);
    session.appendFling({ x: -150, y: -150, monsters: { C5: 1 } });
    const rings = layer.splatCount;
    untilBlast(session, layer);
    expect(layer.splatCount).toBeGreaterThan(rings);
    expect(layer.blasts.blastsMade).toBe(0);
    expect(layer.blasts.markCount).toBe(0);
  });

  it("changes nothing in the battle: the same health as an undrawn one", () => {
    const fling = { x: -150, y: -150, monsters: { C5: 2 } };
    const drawn = setUp([{ id: 1, t: 14, l: 1, X: 0, Y: 0 }], { C5: 2 });
    drawn.session.appendFling(fling);
    untilBlast(drawn.session, drawn.layer);
    const ticks = drawn.session.battle()?.tick ?? 0;
    for (let step = 0; step < TICKS_PER_SECOND * 3; step += 1) frame(drawn.session, drawn.layer);

    const bare = new AttackSession({ target: targetOf({ C5: 2 }), seed: 1 });
    bare.load(yardOf([{ id: 1, t: 14, l: 1, X: 0, Y: 0 }]));
    bare.appendFling(fling);
    for (let step = 0; step < ticks + TICKS_PER_SECOND * 3; step += 1) bare.advance(1 / TICKS_PER_SECOND);

    const health = drawn.session.battle()?.state().health;
    expect(health?.["1"]).toBeLessThan(Infinity);
    expect(bare.battle()?.tick).toBe(drawn.session.battle()?.tick);
    expect(bare.battle()?.state().health).toEqual(health);
  });
});
