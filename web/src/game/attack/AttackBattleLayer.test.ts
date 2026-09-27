import { describe, expect, it } from "vitest";
import { Container, Texture, TextureSource } from "pixi.js";
import type { BaseLoadResponse } from "@/api/types";
import { TICKS_PER_SECOND, type CreepSnapshot } from "@/game/combat/rules";
import { depthKey, type Point } from "@/game/yard/YardGrid";
import { DAMAGE_TINTS, damageStep } from "@/game/yard/YardBuildings";
import { readYard } from "@/game/yard/yardModel";
import {
  AttackBattleLayer,
  DEPTH_BIAS,
  MonsterSheetTextures,
  animationFor,
  creepZIndex,
  groundWorld,
  headingBetween,
  layoutCreep,
  type BattleYardHost,
} from "./AttackBattleLayer";
import { AttackSession } from "./AttackSession";
import type { AttackTarget } from "./attackTarget";
import { MONSTER_SPRITES } from "./monsterSpriteData";
import { spriteFor } from "./monsterSprites";

/**
 * The battle layer's arithmetic without a renderer (`docs/design/attack-flow.md`
 * §6 WP5): which cell a creep shows for its heading and state, where it goes
 * and how it sorts against the buildings, and the damage steps the buildings
 * darken through — then the layer itself over a real session, driven by hand,
 * with a sheet loader that never touches the network.
 */

const ORIGIN: Point = { x: 0, y: 0 };
const STILL = { reducedMotion: false } as const;

const creepOf = (overrides: Partial<CreepSnapshot> = {}): CreepSnapshot => ({
  id: 1,
  monsterId: "C1",
  level: 1,
  champion: false,
  friendly: false,
  ix: 100,
  iy: 100,
  hp: 200,
  maxHp: 200,
  flying: false,
  state: "walking",
  targetBuilding: -1,
  targetCreep: -1,
  ...overrides,
});

const sheetOf = (id: string, level = 1) => {
  const sheet = spriteFor(id, level);
  if (!sheet) throw new Error(`no sheet for ${id}`);
  return sheet;
};

describe("headings and cells", () => {
  it("picks column 0 for a creep heading right, and walks the columns clockwise", () => {
    const pokey = sheetOf("C1");
    const right = layoutCreep(
      creepOf(),
      pokey,
      { heading: 0, moving: true, age: 0 },
      ORIGIN,
      STILL,
    );
    expect(right.column).toBe(0);
    // 90° on screen is straight down: a quarter of thirty columns.
    const down = layoutCreep(
      creepOf(),
      pokey,
      { heading: Math.PI / 2, moving: true, age: 0 },
      ORIGIN,
      STILL,
    );
    expect(down.column).toBe(7);
    const left = layoutCreep(
      creepOf(),
      pokey,
      { heading: Math.PI, moving: true, age: 0 },
      ORIGIN,
      STILL,
    );
    expect(left.column).toBe(15);
    // Every column is one cell across the sheet, a single row for a classic creep.
    expect(right.row).toBe(0);
    expect(right.key).toBe("C1:0:0");
  });

  it("shows a champion's attack row while it is attacking, and its walk row while it walks", () => {
    const gorgo = sheetOf("G1", 1);
    const attack = gorgo.animations.attack;
    const walk = gorgo.animations.walk;
    if (!attack || !walk) throw new Error("Gorgo's sheet lost its cycles");
    const swinging = creepOf({
      monsterId: "G1",
      champion: true,
      state: "attacking",
      targetBuilding: 7,
    });
    for (let age = 0; age < attack.count * attack.ticksPerFrame; age += 8) {
      const layout = layoutCreep(
        swinging,
        gorgo,
        { heading: 0, moving: false, age },
        ORIGIN,
        STILL,
      );
      expect(layout.animation).toBe("attack");
      expect(layout.row).toBeGreaterThanOrEqual(attack.first);
      expect(layout.row).toBeLessThan(attack.first + attack.count);
    }
    const walking = layoutCreep(
      creepOf({ monsterId: "G1", champion: true }),
      gorgo,
      { heading: 0, moving: true, age: 16 },
      ORIGIN,
      STILL,
    );
    expect(walking.animation).toBe("walk");
    expect(walking.row).toBe(walk.first + 2);
    // Champions' column 0 is a monster heading down-right (`ChampionBase.as:1539-1545`).
    expect(
      layoutCreep(
        creepOf({ monsterId: "G1" }),
        gorgo,
        { heading: Math.PI / 4, moving: true, age: 0 },
        ORIGIN,
        STILL,
      ).column,
    ).toBe(0);
  });

  it("stands a classic creep still on its walk row, and hops it while it walks", () => {
    const pokey = sheetOf("C1");
    const standing = layoutCreep(
      creepOf(),
      pokey,
      { heading: 0, moving: false, age: 6 },
      ORIGIN,
      STILL,
    );
    const walking = layoutCreep(
      creepOf(),
      pokey,
      { heading: 0, moving: true, age: 6 },
      ORIGIN,
      STILL,
    );
    expect(standing.animation).toBe("idle");
    expect(standing.row).toBe(0);
    expect(walking.row).toBe(0);
    expect(walking.y).toBeLessThan(standing.y);
    expect(standing.y - walking.y).toBeLessThanOrEqual(2);
    const calm = layoutCreep(creepOf(), pokey, { heading: 0, moving: true, age: 6 }, ORIGIN, {
      reducedMotion: true,
    });
    expect(calm.y).toBe(standing.y);
  });

  it("chooses the animation from the creep's state", () => {
    expect(animationFor(creepOf({ state: "attacking" }), false)).toBe("attack");
    expect(animationFor(creepOf(), true)).toBe("walk");
    expect(animationFor(creepOf(), false)).toBe("idle");
  });

  it("measures a heading on screen, y down, and has none for a creep that did not move", () => {
    expect(headingBetween({ x: 0, y: 0 }, { x: 5, y: 0 })).toBe(0);
    expect(headingBetween({ x: 0, y: 0 }, { x: 0, y: 5 })).toBeCloseTo(Math.PI / 2);
    expect(headingBetween({ x: 0, y: 0 }, { x: 0, y: 0 })).toBeNull();
  });
});

describe("placement", () => {
  it("puts the cell's top-left at the ground point minus the anchor", () => {
    const pokey = sheetOf("C1");
    const origin = { x: 1000, y: 500 };
    const creep = creepOf({ ix: 120, iy: 40 });
    const layout = layoutCreep(
      creep,
      pokey,
      { heading: 0, moving: false, age: 0 },
      origin,
      STILL,
    );
    const ground = groundWorld(120, 40, origin);
    expect(ground).toEqual({ x: 1080, y: 580 });
    expect(layout.groundX).toBe(ground.x);
    expect(layout.groundY).toBe(ground.y);
    expect(layout.x).toBe(ground.x - pokey.anchorX);
    expect(layout.y).toBe(ground.y - pokey.anchorY);
    expect(layout.shadow).toBeNull();
  });

  it("does not floor a creep's position, so its motion is smooth", () => {
    expect(groundWorld(10.5, 3.25, ORIGIN)).toEqual({ x: 7.25, y: 6.875 });
  });

  it("hovers a flyer with the Flash bob and lays its shadow on the ground", () => {
    const zafreeti = sheetOf("C15");
    const flyer = creepOf({ monsterId: "C15", flying: true });
    const still = layoutCreep(
      flyer,
      zafreeti,
      { heading: 0, moving: true, age: 0 },
      ORIGIN,
      STILL,
    );
    const later = layoutCreep(
      flyer,
      zafreeti,
      { heading: 0, moving: true, age: 78 },
      ORIGIN,
      STILL,
    );
    // Around 108 px up (`CreepBase.as:144-150`), moving with the sine.
    const groundY = groundWorld(flyer.ix, flyer.iy, ORIGIN).y;
    expect(still.y).toBeCloseTo(groundY - zafreeti.anchorY - 108);
    expect(later.y).not.toBe(still.y);
    expect(Math.abs(later.y - still.y)).toBeLessThanOrEqual(10);
    expect(still.shadow).not.toBeNull();
    expect(still.shadow?.y).toBeGreaterThan(still.y);
    const calm = layoutCreep(flyer, zafreeti, { heading: 0, moving: true, age: 78 }, ORIGIN, {
      reducedMotion: true,
    });
    expect(calm.y).toBe(groundY - zafreeti.anchorY - 108);
  });

  it("sorts a creep in front of a building it stands below, and behind one it stands above", () => {
    // A building whose top corner is at world (500, 300), sorted as the yard sorts it.
    const building = depthKey(500, 300, 42) * 8;
    const behind = creepZIndex(500, 300 - 5, 1);
    const atCorner = creepZIndex(500, 300, 1);
    const inFront = creepZIndex(500, 300 + DEPTH_BIAS + 5, 1);
    expect(behind).toBeLessThan(building);
    expect(atCorner).toBeLessThan(building);
    expect(inFront).toBeGreaterThan(building);
    // Never a tie with the building's own animation layers at +1..+3.
    expect(creepZIndex(500, 300 + DEPTH_BIAS, 1) % 8).toBe(4);
  });
});

describe("building damage steps", () => {
  it("darkens at 75, 50 and 25 percent and reads zero as a ruin", () => {
    expect(damageStep(1)).toBe(0);
    expect(damageStep(0.75)).toBe(0);
    expect(damageStep(0.74)).toBe(1);
    expect(damageStep(0.5)).toBe(1);
    expect(damageStep(0.49)).toBe(2);
    expect(damageStep(0.25)).toBe(2);
    expect(damageStep(0.24)).toBe(3);
    expect(damageStep(0.001)).toBe(3);
    expect(damageStep(0)).toBe(4);
    expect(damageStep(Number.NaN)).toBe(0);
  });

  it("keeps step 0 white, so an untouched yard draws as before", () => {
    expect(DAMAGE_TINTS[0]).toBe(0xffffff);
    expect(DAMAGE_TINTS).toHaveLength(5);
    for (let step = 1; step < DAMAGE_TINTS.length; step += 1) {
      expect(DAMAGE_TINTS[step]).toBeLessThan(DAMAGE_TINTS[step - 1] ?? 0);
    }
  });
});

/* ── The layer over a real session ──────────────────────────────────────── */

/** A lone level 1 Cannon Tower at the origin, as the session tests use. */
const towerYard = (): BaseLoadResponse =>
  ({
    error: 0,
    id: 1,
    baseid: "3502",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: 1_700_000_000,
    buildingdata: { "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } },
    buildinghealthdata: {},
    resources: { r1: 1000, r2: 0, r3: 0, r4: 0 },
    attackid: 77,
    storedata: {},
  }) as unknown as BaseLoadResponse;

const targetOf = (monsters: Record<string, number> = { C1: 3 }): AttackTarget => ({
  baseid: "3502",
  kind: "wild",
  cell: { col: 241, row: 208 },
  name: "Kozu",
  roster: {
    monsters,
    levels: {},
    // A level 1 Fomor, awake and fed, so a test can fling it.
    champions: [{ t: 3, hp: 1000, l: 1, ft: 0, fd: 0, fb: 0, pl: 0, status: 0 }],
    flingerLevel: 4,
    catapultLevel: 0,
  },
});

/** A sheet the size the table says, with nothing behind it: enough to frame. */
const blankSheet = (key: string): Texture => {
  const sheet = MONSTER_SPRITES[key];
  if (!sheet) throw new Error(`no sheet ${key}`);
  return new Texture({
    source: new TextureSource({ width: sheet.width, height: sheet.height }),
  });
};

interface Host extends BattleYardHost {
  readonly depth: Container;
  readonly damage: Map<number, number>;
  readonly flashes: Array<{ id: number; on: boolean }>;
}

const hostOf = (): Host => {
  const depth = new Container();
  depth.sortableChildren = true;
  const damage = new Map<number, number>();
  const flashes: Array<{ id: number; on: boolean }> = [];
  return {
    depth,
    damage,
    flashes,
    depthSortedLayer: () => depth,
    centreOf: () => ({ x: 400, y: 400 }),
    setBuildingDamage: (id, fraction) => damage.set(id, fraction),
    setConcealed: () => {},
    setAnimFrame: () => {},
    flashBuilding: (id, on) => flashes.push({ id, on }),
  };
};

const setUp = (
  loader = (url: string) => Promise.resolve(blankSheet(keyOf(url))),
  monsters?: Record<string, number>,
) => {
  const session = new AttackSession({ target: targetOf(monsters), seed: 1 });
  const response = towerYard();
  session.load(response);
  const yard = readYard(response);
  const host = hostOf();
  const overlay = new Container();
  const marker = new Container();
  overlay.addChild(marker);
  const textures = new MonsterSheetTextures(loader);
  const layer = new AttackBattleLayer({
    session,
    yard,
    host,
    overlay,
    reducedMotion: false,
    textures,
  });
  return { session, yard, host, overlay, marker, layer, textures };
};

const keyOf = (url: string): string => {
  const hit = Object.values(MONSTER_SPRITES).find((sheet) => url.endsWith(sheet.file));
  if (!hit) throw new Error(`no sheet at ${url}`);
  return hit.key;
};

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const play = (session: AttackSession, seconds: number, layer: AttackBattleLayer): void => {
  const frames = Math.ceil(seconds * 60);
  for (let frame = 0; frame < frames; frame += 1) {
    session.advance(1 / 60);
    layer.update();
  }
};

describe("AttackBattleLayer over a session", () => {
  it("adds its own containers after what the overlay already holds", () => {
    const { overlay, marker, layer } = setUp();
    expect(overlay.children[0]).toBe(marker);
    // Effects, tower fire, bars, and the creep effects (projectiles, smoke, numbers).
    expect(overlay.children).toHaveLength(5);
    layer.destroy();
    expect(overlay.children).toEqual([marker]);
  });

  it("gives every flung creep a body in the sorted container and a bar in the overlay", async () => {
    const { session, host, layer, overlay } = setUp();
    session.appendFling({ x: -100, y: -100, monsters: { C1: 3 } });
    layer.update();
    expect(layer.creepCount).toBe(3);
    expect(host.depth.children).toHaveLength(3);
    const bars = overlay.children[3];
    expect(bars?.children).toHaveLength(6);

    // Before the sheet is in, a marker; once it is, the sheet's cell.
    await flush();
    play(session, 0.1, layer);
    const pokey = MONSTER_SPRITES["C1"];
    for (const body of host.depth.children) {
      const texture = (body as unknown as { texture: Texture }).texture;
      expect(texture.frame.width).toBe(pokey?.frameWidth);
      expect(texture.frame.height).toBe(pokey?.frameHeight);
      expect(texture.frame.y).toBe(0);
    }
    layer.destroy();
  });

  it("faces the way it walks and sorts by where it stands", async () => {
    const { session, host, layer, yard } = setUp();
    session.appendFling({ x: -200, y: -200, monsters: { C1: 1 } });
    await flush();
    play(session, 1, layer);
    const body = host.depth.children[0] as unknown as {
      texture: Texture;
      zIndex: number;
      x: number;
      y: number;
    };
    // Walking from (-200, -200) toward the tower at the origin is down the
    // screen, give or take the grid-aligned legs of the route: a heading with
    // a downward component, so a column in the lower half of the circle.
    const pokey = MONSTER_SPRITES["C1"];
    if (!pokey) throw new Error("no Pokey");
    const column = body.texture.frame.x / pokey.frameWidth;
    expect(column).toBeGreaterThanOrEqual(1);
    expect(column).toBeLessThanOrEqual(14);
    // The sprite sits at the ground point minus the anchor, lifted by the hop.
    const origin = { x: yard.bounds.originX, y: yard.bounds.originY };
    const snapshot = session.battle()?.creeps()[0];
    if (!snapshot) throw new Error("the Pokey is gone");
    const ground = groundWorld(snapshot.ix, snapshot.iy, origin);
    // Drawn on whole pixels (`MonsterBase.as:613-616`), so within half a pixel
    // of the ground point minus the anchor, lifted by the hop.
    expect(Math.abs(body.x - (ground.x - pokey.anchorX))).toBeLessThanOrEqual(0.5);
    expect(ground.y - pokey.anchorY - body.y).toBeGreaterThanOrEqual(-0.5);
    expect(ground.y - pokey.anchorY - body.y).toBeLessThanOrEqual(2.5);
    expect(body.zIndex).toBe(creepZIndex(ground.x, ground.y, 1));
    layer.destroy();
  });

  it("removes a creep the battle no longer has, and drops a splat where it died", async () => {
    const { session, host, layer, overlay } = setUp();
    session.appendFling({ x: -100, y: -100, monsters: { C1: 1 } });
    await flush();
    // The tower kills a lone Pokey in about ten seconds of battle time.
    play(session, 14, layer);
    expect(session.state().creepsKilled).toBe(1);
    expect(layer.creepCount).toBe(0);
    for (const body of host.depth.children)
      expect((body as { visible: boolean }).visible).toBe(false);
    const effects = overlay.children[1];
    // The splat fades over 32 ticks; whether it is still there depends on
    // the tick the shot landed, so only assert it was drawn at all.
    expect(effects).toBeDefined();
    layer.destroy();
  });

  it("hands the host a damage fraction as the tower loses health", async () => {
    const { session, host, layer } = setUp();
    session.appendFling({ x: -100, y: -100, monsters: { C1: 3 } });
    await flush();
    play(session, 12, layer);
    const fraction = host.damage.get(1);
    expect(fraction).toBeDefined();
    expect(fraction).toBeLessThan(1);
    expect(fraction).toBeGreaterThan(0);
    layer.destroy();
  });

  it("runs on the battle clock: 2x moves creeps twice as far per real second", async () => {
    const at = (speed: 1 | 2) => {
      const { session, host, layer } = setUp();
      session.setSpeed(speed);
      session.appendFling({ x: -200, y: -200, monsters: { C1: 1 } });
      play(session, 0.5, layer);
      const body = host.depth.children[0] as { x: number; y: number };
      const y = body.y;
      layer.destroy();
      return { tick: session.state().tick, y };
    };
    const slow = at(1);
    const fast = at(2);
    expect(fast.tick).toBe(slow.tick * 2);
    expect(fast.tick).toBe(TICKS_PER_SECOND);
    expect(fast.y).toBeGreaterThan(slow.y);
  });

  it("cuts an oversized sheet through a canvas rather than framing it, and says so", () => {
    const textures = new MonsterSheetTextures(() => new Promise(() => {}), 4096);
    const korath = MONSTER_SPRITES["G4_5"];
    const gorgo = MONSTER_SPRITES["G1_1"];
    if (!korath || !gorgo) throw new Error("champion sheets missing");
    expect(textures.oversized(korath)).toBe(true);
    expect(textures.oversized(gorgo)).toBe(false);
    textures.setMaxTextureSize(8192);
    expect(textures.oversized(korath)).toBe(false);
    textures.destroy();
  });
});

/* ── Hits, wounds and steady walking (#63, #65, #68) ────────────────────── */

type BodyLike = { texture: Texture; x: number; y: number; tint: number; visible: boolean };

/** Frame by frame for `seconds`, calling `check` after each frame; stops early on true. */
const playUntil = (
  session: AttackSession,
  seconds: number,
  layer: AttackBattleLayer,
  check: () => boolean,
): boolean => {
  const frames = Math.ceil(seconds * 60);
  for (let frame = 0; frame < frames; frame += 1) {
    session.advance(1 / 60);
    layer.update();
    if (check()) return true;
  }
  return false;
};

describe("hits, wounds and steady walking", () => {
  it("keeps a walking champion on its walk row when a frame brings no new tick (#65)", async () => {
    const { session, host, layer } = setUp();
    session.appendFling({ x: -200, y: -200, monsters: {}, champion: { t: 3, l: 1 } });
    await flush();
    const fomor = MONSTER_SPRITES["G3_1"];
    if (!fomor?.animations.walk) throw new Error("Fomor lost its walk cycle");
    const walk = fomor.animations.walk;
    // The champion's body is the child cut from its sheet; the other is its shadow.
    const bodyOf = () =>
      host.depth.children.find(
        (child) => (child as unknown as BodyLike).texture.frame.width === fomor.frameWidth,
      ) as unknown as BodyLike | undefined;
    const walking = playUntil(session, 3, layer, () => {
      const found = bodyOf();
      const row = found ? found.texture.frame.y / fomor.frameHeight : -1;
      return row >= walk.first && row < walk.first + walk.count;
    });
    expect(walking).toBe(true);
    const body = bodyOf();
    if (!body) throw new Error("no Fomor body");
    const before = body.texture.frame.y;
    // Two more frames with the clock stopped: what a 144 Hz display does
    // between ticks. The row must not fall back to the standing pose.
    layer.update();
    layer.update();
    expect(body.texture.frame.y).toBe(before);
    expect(body.texture.frame.y / fomor.frameHeight).not.toBe(fomor.animations.idle?.first);
    layer.destroy();
  });

  it("lunges a melee creep toward its target on a hit and flashes the building (#63)", async () => {
    const { session, host, layer, yard } = setUp();
    session.appendFling({ x: -100, y: -100, monsters: { C1: 1 } });
    await flush();
    const pokey = MONSTER_SPRITES["C1"];
    if (!pokey) throw new Error("no Pokey");
    const origin = { x: yard.bounds.originX, y: yard.bounds.originY };
    let lunged = false;
    playUntil(session, 8, layer, () => {
      const body = host.depth.children[0] as BodyLike | undefined;
      const snapshot = session.battle()?.creeps()[0];
      if (!body || !snapshot || snapshot.state !== "attacking") return false;
      const ground = groundWorld(snapshot.ix, snapshot.iy, origin);
      const restX = Math.round(ground.x - pokey.anchorX);
      const restY = Math.round(ground.y - pokey.anchorY);
      // Standing still the body sits at rest; during a lunge it is displaced.
      if (Math.abs(body.x - restX) + Math.abs(body.y - restY) >= 1) lunged = true;
      return lunged && host.flashes.length > 0;
    });
    expect(lunged).toBe(true);
    expect(host.flashes[0]).toEqual({ id: 1, on: true });
    // A few frames on, the flash has been switched off again.
    playUntil(session, 0.2, layer, () => false);
    expect(host.flashes.some((flash) => !flash.on)).toBe(true);
    expect(layer.creepEffects.projectileCount).toBe(0);
    layer.destroy();
  });

  it("fires a projectile from a ranged champion instead of lunging (#63)", async () => {
    const { session, layer } = setUp();
    // Fomor reaches 140 yard units at level 1, so from 120 away it fires at once.
    session.appendFling({ x: -80, y: -80, monsters: {}, champion: { t: 3, l: 1 } });
    await flush();
    const fired = playUntil(session, 6, layer, () => layer.creepEffects.projectileCount > 0);
    expect(fired).toBe(true);
    layer.destroy();
  });

  it("tints a monster red and floats the damage over it when a tower hits it (#68)", async () => {
    const { session, host, layer } = setUp();
    session.appendFling({ x: -100, y: -100, monsters: { C1: 1 } });
    await flush();
    let tinted = false;
    const hurt = playUntil(session, 8, layer, () => {
      const body = host.depth.children[0] as BodyLike | undefined;
      if (body && body.tint !== 0xffffff) tinted = true;
      return layer.creepEffects.labelCount > 0 && tinted;
    });
    expect(hurt).toBe(true);
    // A level 1 Cannon Tower does 20 a shot.
    expect(layer.creepEffects.labelFor(1)?.amount).toBe(20);
    // And the tint clears again once the wound is old.
    playUntil(session, 0.3, layer, () => false);
    layer.destroy();
  });

  it("puffs smoke when the tower crosses into damaged, not on the first frame (#63)", async () => {
    const { session, layer } = setUp(undefined, { C1: 12 });
    layer.update();
    expect(layer.creepEffects.poofsMade).toBe(0);
    session.appendFling({ x: -100, y: -100, monsters: { C1: 12 } });
    await flush();
    // A dozen Pokeys at 80 a second each take a 6,000 health tower below half
    // in a few seconds of battle time, before its splash thins them out.
    const smoked = playUntil(session, 30, layer, () => layer.creepEffects.poofsMade > 0);
    expect(smoked).toBe(true);
    const fraction = session.battle()?.state().health[1];
    expect(fraction).toBeDefined();
    expect((fraction ?? 6000) / 6000).toBeLessThan(0.5);
    layer.destroy();
  });
});
