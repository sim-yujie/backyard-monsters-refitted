import { describe, expect, it, vi } from "vitest";
import { Container, Graphics, Texture, TextureSource } from "pixi.js";
import type { BaseLoadResponse } from "@/api/types";
import {
  CHAMPION_PROPS,
  FLYER_MODE,
  MONSTER_PROPS,
  championMode,
  isFlyingMovement,
  monsterMovement,
  type BattleVisualEvent,
  type CreepSnapshot,
} from "@/game/combat/rules";
import type { Point } from "@/game/yard/YardGrid";
import { readYard } from "@/game/yard/yardModel";
import { AttackBattleLayer, MonsterSheetTextures, groundWorld, layoutCreep } from "./AttackBattleLayer";
import { AttackSession } from "./AttackSession";
import type { AttackTarget } from "./attackTarget";
import { MONSTER_SPRITES } from "./monsterSpriteData";
import { sheetUrl, spriteFor } from "./monsterSprites";
import { TowerFx, towersOf } from "./towerFx";

/**
 * A shot at a flyer meets it in the air, where it is drawn, from every
 * shooter (replay-feedback Q2): the defending Fomor's fireball used to land
 * on the ground under a Teratorn. Every flyer the rules know, at the middle
 * of the cell `layoutCreep` draws it in; every tower that reaches the air;
 * and ranged creeps on both sides, attacking and defending, champions too.
 */

interface Flyer {
  readonly label: string;
  readonly monsterId: string;
  readonly level: number;
  readonly champion: boolean;
}

/** Every flying monster, and every champion at every level it flies, from the stat tables. */
const FLYERS: readonly Flyer[] = [
  ...Object.keys(MONSTER_PROPS)
    .filter((id) => isFlyingMovement(monsterMovement(id)))
    .map((id) => ({ label: id, monsterId: id, level: 1, champion: false })),
  ...Object.entries(CHAMPION_PROPS).flatMap(([id, stat]) =>
    Array.from({ length: stat.props.health?.length ?? 1 }, (_, index) => index + 1)
      .filter((level) => isFlyingMovement(championMode(id, "movement", level)))
      .map((level) => ({ label: `${id} level ${level}`, monsterId: id, level, champion: true })),
  ),
];

const snapshotOf = (
  id: number,
  who: Pick<Flyer, "monsterId" | "level" | "champion">,
  friendly: boolean,
  flying: boolean,
  ix: number,
  iy: number,
): CreepSnapshot => ({
  id,
  monsterId: who.monsterId,
  level: who.level,
  champion: who.champion,
  friendly,
  ix,
  iy,
  hp: 1000,
  maxHp: 1000,
  flying,
  state: "walking",
  targetBuilding: -1,
  targetCreep: -1,
});

/** World px above its ground point the middle of a flyer's drawn cell sits, at rest. */
const drawnLift = (flyer: CreepSnapshot, origin: Point): number => {
  const sheet = spriteFor(flyer.monsterId, flyer.level);
  if (!sheet) throw new Error(`no sheet for ${flyer.monsterId}`);
  const layout = layoutCreep(flyer, sheet, { heading: 0, moving: false, age: 0 }, origin, {
    reducedMotion: true,
  });
  return layout.groundY - (layout.y + sheet.frameHeight / 2);
};

const yardOf = (buildings: Array<{ id: number; t: number; l: number; X: number; Y: number }>): BaseLoadResponse =>
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

describe("the flyers", () => {
  it("are every flyer the rules know, each drawn from a flying sheet", () => {
    expect(FLYERS.map((flyer) => flyer.label)).toEqual([
      "C14",
      "C15",
      "C16",
      "IC5",
      "G3 level 3",
      "G3 level 4",
      "G3 level 5",
      "G3 level 6",
    ]);
    for (const flyer of FLYERS) expect(spriteFor(flyer.monsterId, flyer.level)?.movement).toBe("fly");
  });
});

/* ── Towers ─────────────────────────────────────────────────────────────── */

/** Every tower that can shoot a flyer (`BTOWER._targetFlyerMode` 1 or 2). */
const AIR_TOWERS = Object.entries(FLYER_MODE)
  .filter(([, mode]) => mode !== 0)
  .map(([type]) => Number(type));

describe("a tower's shot at a flyer", () => {
  it("is fired by every air tower", () => {
    // Sniper, Tesla, Aerial Defense, Magma.
    expect(AIR_TOWERS).toEqual([21, 25, 115, 132]);
  });

  describe.each(AIR_TOWERS)("tower %i", (type) => {
    it.each(FLYERS)("lands in the middle of a $label, in the air", (flyer) => {
      const yard = readYard(yardOf([{ id: 1, t: type, l: 1, X: 0, Y: 0 }]));
      const origin = { x: yard.bounds.originX, y: yard.bounds.originY };
      const fx = new TowerFx(new Graphics(), towersOf(yard), { setAnimFrame: () => {} }, origin);
      const target = snapshotOf(9, flyer, false, true, 135, 335);
      fx.onShot({ tick: 1, towerId: 1, creepId: 9, ix: target.ix, iy: target.iy }, target);
      fx.update(2, () => target);
      // A Tesla's bolt strikes at once; every other air tower's round flies at its aim.
      const shots = fx as unknown as { bullets: Array<{ aim: Point }>; bolts: Array<{ to: Point }> };
      const at = type === 25 ? shots.bolts[0]?.to : shots.bullets[0]?.aim;
      expect(at).toBeDefined();
      const ground = groundWorld(target.ix, target.iy, origin);
      expect(at!.x).toBeCloseTo(ground.x, 6);
      expect(ground.y - at!.y).toBeCloseTo(drawnLift(target, origin), 6);
      fx.destroy();
    });
  });
});

/* ── Creeps ─────────────────────────────────────────────────────────────── */

interface Shooter {
  readonly label: string;
  readonly monsterId: string;
  readonly level: number;
  readonly champion: boolean;
  /** Defending: the flyers it shoots are the attackers. */
  readonly friendly: boolean;
  readonly flying: boolean;
}

/**
 * Every kind of creep that fires a projectile at another creep: a ranged
 * walker, a ranged flyer and the flying Fomor, attacking and defending
 * (a Housing or Bunker defender, a caged or guarding champion). Gorgo, Drull,
 * Korath and Krallen stomp: no projectile leaves them (`STOMPING_CHAMPIONS`).
 */
const SHOOTERS: readonly Shooter[] = [true, false].flatMap((friendly) => {
  const side = friendly ? "defending" : "attacking";
  return [
    { label: `${side} Rezghul`, monsterId: "C19", level: 1, champion: false, friendly, flying: false },
    { label: `${side} Sabnox`, monsterId: "IC7", level: 1, champion: false, friendly, flying: false },
    { label: `${side} D.A.V.E.`, monsterId: "C12", level: 1, champion: false, friendly, flying: false },
    { label: `${side} Teratorn`, monsterId: "C14", level: 1, champion: false, friendly, flying: true },
    { label: `${side} Vorg`, monsterId: "C16", level: 1, champion: false, friendly, flying: true },
    { label: `${side} Fomor level 1`, monsterId: "G3", level: 1, champion: true, friendly, flying: false },
    { label: `${side} Fomor level 4`, monsterId: "G3", level: 4, champion: true, friendly, flying: true },
  ];
});

const target: AttackTarget = {
  baseid: "3502",
  kind: "wild",
  cell: { col: 241, row: 208 },
  name: "Kozu",
  roster: {
    monsters: {},
    levels: {},
    champions: [],
    flingerLevel: 4,
    catapultLevel: 0,
    sources: [],
    siege: null,
    resources: null,
  },
};

const blankSheet = (url: string): Promise<Texture> => {
  const sheet = Object.values(MONSTER_SPRITES).find((candidate) => url === sheetUrl(candidate));
  if (!sheet) throw new Error(`no sheet at ${url}`);
  return Promise.resolve(new Texture({ source: new TextureSource({ width: sheet.width, height: sheet.height }) }));
};

/**
 * A layer over a session whose battle holds just `creeps` and plays `events`
 * once: the layer's own path from a `hit` to the projectile it draws.
 */
const layerOver = (creeps: readonly CreepSnapshot[], events: readonly BattleVisualEvent[]) => {
  const session = new AttackSession({ target, seed: 1 });
  const response = yardOf([{ id: 1, t: 21, l: 1, X: 0, Y: 0 }]);
  session.load(response);
  const real = session.battle()!;
  const tick = 10;
  vi.spyOn(session, "battle").mockReturnValue({
    tick,
    creeps: () => creeps,
    recentEvents: (since: number) => events.filter((event) => event.tick > since),
    state: () => real.state(),
    siege: () => real.siege(),
    bunkerPools: () => real.bunkerPools(),
  } as unknown as ReturnType<AttackSession["battle"]>);
  const depth = new Container();
  depth.sortableChildren = true;
  const yard = readYard(response);
  const layer = new AttackBattleLayer({
    session,
    yard,
    host: {
      depthSortedLayer: () => depth,
      centreOf: () => ({ x: 400, y: 400 }),
      setBuildingDamage: () => {},
      setConcealed: () => {},
      setAnimFrame: () => {},
    },
    overlay: new Container(),
    reducedMotion: false,
    textures: new MonsterSheetTextures(blankSheet),
  });
  return { layer, origin: { x: yard.bounds.originX, y: yard.bounds.originY } };
};

describe("a creep's shot at a flyer", () => {
  describe.each(SHOOTERS)("from a $label", (shooter) => {
    it.each(FLYERS)("lands in the middle of a $label, in the air", (flyer) => {
      const from = snapshotOf(1, shooter, shooter.friendly, shooter.flying, 100, 100);
      const quarry = snapshotOf(2, flyer, !shooter.friendly, true, 160, 220);
      const hit: BattleVisualEvent = {
        kind: "hit",
        tick: 10,
        creepId: from.id,
        buildingId: -1,
        creepTargetId: quarry.id,
        ix: from.ix,
        iy: from.iy,
        targetIx: quarry.ix,
        targetIy: quarry.iy,
        ranged: true,
        flying: shooter.flying,
        amount: 50,
      };
      const { layer, origin } = layerOver([from, quarry], [hit]);
      const shots = vi.spyOn(layer.creepEffects, "projectile");
      layer.update();
      expect(shots).toHaveBeenCalledTimes(1);
      const to = shots.mock.calls[0]![2];
      const ground = groundWorld(quarry.ix, quarry.iy, origin);
      expect(to.x).toBeCloseTo(ground.x, 6);
      expect(ground.y - to.y).toBeCloseTo(drawnLift(quarry, origin), 6);
      layer.destroy();
    });
  });
});
