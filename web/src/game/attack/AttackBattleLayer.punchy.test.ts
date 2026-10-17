import { describe, expect, it } from "vitest";
import { Container, Texture, TextureSource } from "pixi.js";
import type { BaseLoadResponse } from "@/api/types";
import { TICKS_PER_SECOND, type BattleVisualEvent, type MonsterRanks } from "@/game/combat/rules";
import { readYard } from "@/game/yard/yardModel";
import {
  AttackBattleLayer,
  MonsterSheetTextures,
  type BattleYardHost,
} from "./AttackBattleLayer";
import { AttackSession, type FlingInput } from "./AttackSession";
import type { AttackTarget } from "./attackTarget";
import { MAX_SHAKE } from "./blastFx";
import { MONSTER_SPRITES } from "./monsterSpriteData";
import { sheetUrl } from "./monsterSprites";
import { splashLook } from "./punchyMoments";

/**
 * The punchy blast trial (feat/punchy-trial): over a real session it goes off
 * at Korath's quake, a Project X's death, the Town Hall falling, a Bandito's
 * whirlwind and a Wormzer's burst, at the strength each was given, and the
 * battle comes out the same as one nobody draws.
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

/** A level 5 Korath at power 3: the quake. */
const KORATH = { t: 4, hp: 500_000, l: 5, ft: 0, fd: 0, fb: 0, pl: 3, status: 0 };

const targetOf = (monsters: Record<string, number>, ranks: MonsterRanks): AttackTarget => ({
  baseid: "3502",
  kind: "wild",
  cell: { col: 241, row: 208 },
  name: "Kozu",
  roster: {
    monsters,
    levels: {},
    ranks,
    champions: [KORATH],
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

const hostOf = (): BattleYardHost => {
  const depth = new Container();
  depth.sortableChildren = true;
  return {
    depthSortedLayer: () => depth,
    centreOf: () => ({ x: 400, y: 400 }),
    setBuildingDamage: () => {},
    setConcealed: () => {},
    setAnimFrame: () => {},
    zoom: 1,
  };
};

interface Scene {
  readonly buildings: BuildingRow[];
  readonly monsters: Record<string, number>;
  readonly ranks?: MonsterRanks;
  readonly fling: FlingInput;
}

const setUp = (scene: Scene) => {
  const session = new AttackSession({ target: targetOf(scene.monsters, scene.ranks ?? {}), seed: 1 });
  const response = yardOf(scene.buildings);
  session.load(response);
  // The overlay sits in a root, as on screen, so the shake has something to move.
  const root = new Container();
  const overlay = new Container();
  root.addChild(overlay);
  let wall = 0;
  const layer = new AttackBattleLayer({
    session,
    yard: readYard(response),
    host: hostOf(),
    overlay,
    reducedMotion: false,
    textures: new MonsterSheetTextures(blankSheet),
    now: () => wall,
  });
  session.appendFling(scene.fling);
  return { session, layer, root, tickWall: (ms: number) => (wall += ms) };
};

/** One frame of one battle tick; the events it produced. */
const frame = (session: AttackSession, layer: AttackBattleLayer): readonly BattleVisualEvent[] => {
  const before = session.battle()?.tick ?? 0;
  if (!session.ended) session.advance(1 / TICKS_PER_SECOND);
  layer.update();
  return session.battle()?.recentEvents(before) ?? [];
};

/** Runs until `found` holds for a frame's events; that frame's events. */
const until = (
  session: AttackSession,
  layer: AttackBattleLayer,
  found: (events: readonly BattleVisualEvent[]) => boolean,
  seconds = 60,
): readonly BattleVisualEvent[] => {
  for (let step = 0; step < TICKS_PER_SECOND * seconds; step += 1) {
    const events = frame(session, layer);
    if (found(events)) return events;
  }
  throw new Error("never happened");
};

const splashBy = (moveId: string) => (events: readonly BattleVisualEvent[]) =>
  events.some((event) => event.kind === "splash" && event.moveId === moveId);

/** Cannons that bring a Project X down on its way in (`specialMoves.test.ts`). */
const CANNONS: BuildingRow[] = [
  { id: 1, t: 1, l: 5, X: 30, Y: -60 },
  { id: 2, t: 1, l: 5, X: -10, Y: -80 },
  { id: 5, t: 20, l: 6, X: 120, Y: 120 },
  { id: 6, t: 20, l: 6, X: -120, Y: 120 },
  { id: 7, t: 20, l: 6, X: 120, Y: -120 },
];

const SCENES = {
  korath: {
    buildings: [{ id: 1, t: 14, l: 10, X: 0, Y: 0 }, { id: 2, t: 1, l: 5, X: 60, Y: 60 }],
    monsters: {},
    fling: { x: 140, y: 140, monsters: {}, champion: { t: 4, l: 5 } },
  },
  projectX: {
    buildings: CANNONS,
    monsters: { C11: 1 },
    ranks: { C11: 1 },
    fling: { x: 0, y: 0, monsters: { C11: 1 } },
  },
  bandito: {
    buildings: [{ id: 1, t: 14, l: 10, X: 0, Y: 0 }, { id: 2, t: 1, l: 5, X: 40, Y: 40 }],
    monsters: { C7: 2 },
    ranks: { C7: 1 },
    fling: { x: 100, y: 100, monsters: { C7: 2 } },
  },
  wormzer: {
    buildings: [{ id: 1, t: 14, l: 10, X: 0, Y: 0 }, { id: 2, t: 1, l: 5, X: 40, Y: 40 }],
    monsters: { C13: 2 },
    ranks: { C13: 1 },
    fling: { x: 100, y: 100, monsters: { C13: 2 } },
  },
  townHall: {
    buildings: [{ id: 1, t: 14, l: 1, X: 0, Y: 0 }],
    monsters: { C1: 20 },
    fling: { x: -150, y: -150, monsters: { C1: 20 } },
  },
} satisfies Record<string, Scene>;

describe("which splash gets which look (feat/punchy-trial)", () => {
  it("full for Project X, light for Bandito and Wormzer, the fireball for Eye-ra, rings else", () => {
    expect(splashLook("C11")).toBe("full");
    expect(splashLook("C7")).toBe("light");
    expect(splashLook("C13")).toBe("light");
    expect(splashLook("C5")).toBe("fiery");
    expect(splashLook("C4")).toBe("rings");
  });
});

describe("the punchy blast in a real attack (feat/punchy-trial)", () => {
  it("Korath's quake: a full blast that shakes the yard, over the quake's rings", () => {
    const { session, layer, root } = setUp(SCENES.korath);
    until(session, layer, (events) => events.some((event) => event.kind === "quake"));
    expect(layer.blasts.blastsMade).toBe(1);
    expect(layer.blasts.shakeAmp).toBeGreaterThan(0);
    layer.update();
    expect(Math.abs(root.pivot.x)).toBeLessThanOrEqual(MAX_SHAKE);
    expect(Math.abs(root.pivot.y)).toBeLessThanOrEqual(MAX_SHAKE);
  });

  it("Project X's death blast: a full blast", () => {
    const { session, layer } = setUp(SCENES.projectX);
    until(session, layer, splashBy("C11"));
    expect(layer.blasts.blastsMade).toBe(1);
    expect(layer.blasts.shakeAmp).toBeGreaterThan(0);
  });

  for (const [name, id] of [["bandito", "C7"], ["wormzer", "C13"]] as const) {
    it(`${name}: a light blast on its swing, which never shakes`, () => {
      const { session, layer, root } = setUp(SCENES[name]);
      until(session, layer, splashBy(id));
      expect(layer.blasts.blastsMade).toBeGreaterThan(0);
      expect(layer.blasts.bitCount).toBeGreaterThan(0);
      // Swing on for a while: still no shake.
      for (let step = 0; step < TICKS_PER_SECOND * 4; step += 1) {
        frame(session, layer);
        expect(layer.blasts.shakeAmp).toBe(0);
        expect(root.pivot.x).toBe(0);
        expect(root.pivot.y).toBe(0);
      }
    });
  }

  it("the Town Hall falling: one full blast, which settles after the attack ends", () => {
    const { session, layer, root, tickWall } = setUp(SCENES.townHall);
    until(session, layer, () => (session.battle()?.state().health["1"] ?? 1) <= 0);
    expect(layer.blasts.blastsMade).toBe(1);
    expect(layer.blasts.shakeAmp).toBeGreaterThan(0);
    // The battle clock stands still once the attack is over; the blast plays
    // on the wall clock and the yard comes back to rest.
    expect(session.ended).toBe(true);
    for (let step = 0; step < 60; step += 1) {
      tickWall(1000 / 60);
      layer.update();
    }
    expect(layer.blasts.shakeAmp).toBe(0);
    expect(layer.blasts.bitCount).toBe(0);
    expect(root.pivot.x).toBe(0);
    expect(root.pivot.y).toBe(0);
  });

  it("no blast for a building that is not the Town Hall", () => {
    const { session, layer } = setUp({
      buildings: [{ id: 1, t: 14, l: 10, X: 0, Y: 0 }, { id: 2, t: 1, l: 1, X: -120, Y: -120 }],
      monsters: { C1: 10 },
      fling: { x: -150, y: -150, monsters: { C1: 10 } },
    });
    until(session, layer, () => (session.battle()?.state().health["2"] ?? 1) <= 0);
    expect(layer.blasts.blastsMade).toBe(0);
  });

  for (const [name, scene] of Object.entries<Scene>(SCENES)) {
    it(`${name}: changes nothing in the battle, the same as an undrawn one`, () => {
      const drawn = setUp(scene);
      for (let step = 0; step < TICKS_PER_SECOND * 20 && !drawn.session.ended; step += 1) {
        frame(drawn.session, drawn.layer);
      }
      expect(drawn.layer.blasts.blastsMade).toBeGreaterThan(0);
      const ticks = drawn.session.battle()?.tick ?? 0;

      const bare = new AttackSession({ target: targetOf(scene.monsters, scene.ranks ?? {}), seed: 1 });
      bare.load(yardOf(scene.buildings));
      bare.appendFling(scene.fling);
      for (let step = 0; step < ticks && !bare.ended; step += 1) bare.advance(1 / TICKS_PER_SECOND);

      expect(bare.battle()?.tick).toBe(ticks);
      expect(bare.battle()?.state()).toEqual(drawn.session.battle()?.state());
    });
  }
});
