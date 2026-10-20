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
 * The punchy blast (feat/punchy-trial, as the owner picked on 2026-10-19):
 * over a real session it goes off at Korath's quake (full), a Bandito's
 * whirlwind (the flash alone, over its rings) and a Wormzer popping up to
 * bite (light); Project X's death blast and the Town Hall falling keep their
 * old look; and the battle comes out the same as one nobody draws.
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

/** A defence's bunkers, as the base load hands them over. */
interface Forces {
  readonly bunkers: Record<number, Record<string, number>>;
}

const setUp = (scene: Scene, forces?: Forces) => {
  const session = new AttackSession({ target: targetOf(scene.monsters, scene.ranks ?? {}), seed: 1 });
  const response = {
    ...yardOf(scene.buildings),
    ...(forces ? { defenderforces: { ...forces, defenderLevels: {}, defenderChampions: [] } } : {}),
  } as BaseLoadResponse;
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

/**
 * Runs `seconds` of battle, counting each time a Wormzer comes up out of the
 * ground swinging (a bite), a bunker's among them, and its bursts.
 */
const watchBites = (session: AttackSession, layer: AttackBattleLayer, seconds: number) => {
  const under = new Map<number, boolean>();
  let bites = 0;
  let defenderBites = 0;
  let splashes = 0;
  for (let step = 0; step < TICKS_PER_SECOND * seconds && !session.ended; step += 1) {
    const events = frame(session, layer);
    if (splashBy("C13")(events)) splashes += 1;
    for (const creep of session.battle()?.creeps() ?? []) {
      if (creep.monsterId !== "C13") continue;
      const was = under.get(creep.id) ?? false;
      const now = creep.burrowed === true;
      under.set(creep.id, now);
      if (!was || now || creep.state !== "attacking") continue;
      bites += 1;
      if (creep.friendly) defenderBites += 1;
    }
  }
  return { bites, defenderBites, splashes };
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
  it("the fireball for Eye-ra, rings and a flash for Bandito, rings else", () => {
    expect(splashLook("C5")).toBe("fiery");
    expect(splashLook("C7")).toBe("rings-flash");
    expect(splashLook("C11")).toBe("rings");
    expect(splashLook("C13")).toBe("rings");
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

  it("Project X's death blast: the yellow rings, no punchy blast", () => {
    const { session, layer } = setUp(SCENES.projectX);
    const before = layer.splatCount;
    until(session, layer, splashBy("C11"));
    expect(layer.splatCount).toBeGreaterThan(before);
    expect(layer.blasts.blastsMade).toBe(0);
  });

  it("bandito: its rings and the flash alone on every swing, never a shake", () => {
    const { session, layer, root } = setUp(SCENES.bandito);
    let splashes = 0;
    for (let step = 0; step < TICKS_PER_SECOND * 6; step += 1) {
      const rings = layer.splatCount;
      const made = layer.blasts.blastsMade;
      const bits = layer.blasts.bitCount;
      const events = frame(session, layer);
      expect(layer.blasts.shakeAmp).toBe(0);
      expect(root.pivot.x).toBe(0);
      expect(root.pivot.y).toBe(0);
      if (!splashBy("C7")(events)) continue;
      splashes += 1;
      // The yellow rings come back; each blast is one flash, no rings or sparks.
      expect(layer.splatCount).toBeGreaterThan(rings);
      const blasts = layer.blasts.blastsMade - made;
      expect(blasts).toBeGreaterThan(0);
      expect(layer.blasts.bitCount).toBeLessThanOrEqual(bits + blasts);
    }
    expect(splashes).toBeGreaterThan(0);
  });

  it("a crowd of banditos: their rings share one drawing and come from a pool (fix/bandito-lag)", () => {
    const crowd = { C7: 24 };
    const { session, layer } = setUp({
      ...SCENES.bandito,
      monsters: crowd,
      ranks: { C7: 1 },
      fling: { x: 100, y: 100, monsters: crowd },
    });
    let swings = 0;
    let most = 0;
    for (let step = 0; step < TICKS_PER_SECOND * 10 && !session.ended; step += 1) {
      const events = frame(session, layer);
      swings += events.filter((event) => event.kind === "splash" && event.moveId === "C7").length;
      most = Math.max(most, layer.splatCount);
    }
    expect(swings).toBeGreaterThan(48);
    // One drawing for the Bandito's ring, and no more ring objects than were ever alive at once.
    expect(layer.groundRings.shapeCount).toBe(1);
    // (A frame's new swings come in before its old rings go back: one per Bandito at most.)
    expect(layer.groundRings.madeCount).toBeLessThanOrEqual(most + crowd.C7);
    expect(layer.groundRings.madeCount).toBeLessThan(swings / 4);
  });

  it("wormzer: a light blast each time it pops up to bite, none on its burst", () => {
    const { session, layer, root } = setUp(SCENES.wormzer);
    const { bites, splashes } = watchBites(session, layer, 12);
    expect(splashes).toBeGreaterThan(0);
    expect(bites).toBeGreaterThan(0);
    expect(layer.blasts.blastsMade).toBe(bites);
    expect(root.pivot.x).toBe(0);
    expect(root.pivot.y).toBe(0);
  });

  it("wormzer: a bunker's Wormzer gets the blast too when it pops up to bite", () => {
    const scene: Scene = {
      buildings: [{ id: 1, t: 22, l: 1, X: 0, Y: 0 }, { id: 2, t: 6, l: 1, X: 150, Y: 150 }],
      monsters: { C1: 3 },
      fling: { x: 300, y: 300, monsters: { C1: 3 } },
    };
    const { session, layer } = setUp(scene, { bunkers: { 1: { C13: 2 } } });
    const { bites, defenderBites } = watchBites(session, layer, 25);
    expect(defenderBites).toBeGreaterThan(0);
    expect(layer.blasts.blastsMade).toBe(bites);
  });

  it("the Town Hall falling: no punchy blast, the old look", () => {
    const { session, layer } = setUp(SCENES.townHall);
    until(session, layer, () => (session.battle()?.state().health["1"] ?? 1) <= 0);
    expect(layer.blasts.blastsMade).toBe(0);
  });

  for (const [name, scene] of Object.entries<Scene>(SCENES)) {
    it(`${name}: changes nothing in the battle, the same as an undrawn one`, () => {
      const drawn = setUp(scene);
      for (let step = 0; step < TICKS_PER_SECOND * 20 && !drawn.session.ended; step += 1) {
        frame(drawn.session, drawn.layer);
      }
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
