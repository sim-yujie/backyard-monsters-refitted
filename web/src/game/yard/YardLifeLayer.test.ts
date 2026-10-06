import { Container, Texture, TextureSource, type Sprite } from "pixi.js";
import { describe, expect, it } from "vitest";
import { creepZIndex, MonsterSheetTextures } from "@/game/attack/AttackBattleLayer";
import { MONSTER_SPRITES } from "@/game/attack/monsterSpriteData";
import { mulberry32 } from "@/game/combat/rules/rng";
import { championFlightTop, shadowOffset } from "@/game/attack/monsterSprites";
import { yardBounds } from "./YardGrid";
import { EMPTY_LIFE, type YardLife } from "./yardLifeModel";
import { YardLifeLayer } from "./YardLifeLayer";

/** Every sheet arrives at once as a blank of the right size. */
const textures = () =>
  new MonsterSheetTextures((url) => {
    const sheet = Object.values(MONSTER_SPRITES).find((one) => url.endsWith(one.file));
    if (!sheet) return Promise.reject(new Error(url));
    return Promise.resolve(
      new Texture({ source: new TextureSource({ width: sheet.width, height: sheet.height }) }),
    );
  });

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const bounds = yardBounds(0);
const everywhere = { x: -10_000, y: -10_000, width: 20_000, height: 20_000 };
const nowhere = { x: 50_000, y: 50_000, width: 10, height: 10 };

const life = (overrides: Partial<YardLife> = {}): YardLife => ({
  ...EMPTY_LIFE,
  plot: { width: bounds.yardWidth, height: bounds.yardHeight },
  groups: [
    { id: "C1", level: 1, count: 3 },
    { id: "C14", level: 1, count: 1 },
  ],
  pens: [{ id: 5, x: 0, y: 0 }],
  cage: { id: 6, x: -200, y: -200 },
  champions: [{ id: "G1", level: 2, sheetLevel: 2 }],
  workers: 2,
  ...overrides,
});

const setUp = (reducedMotion = false, random?: () => number) => {
  const layer = new YardLifeLayer({ textures: textures(), reducedMotion, ...(random && { random }) });
  const tops = new Container();
  const shadows = new Container();
  return { layer, tops, shadows };
};

describe("YardLifeLayer", () => {
  it("puts a body per creature and worker in the building container, a flyer's shadow below", async () => {
    const { layer, tops, shadows } = setUp();
    layer.set(life(), bounds);
    expect(layer.attach(tops, shadows)).toBe(true);
    // 3 Pokeys, a Teratorn, a Gorgo, two workers.
    expect(layer.count).toBe(7);
    expect(tops.children).toHaveLength(7);
    expect(shadows.children).toHaveLength(1);

    layer.update(everywhere, 0);
    await flush();
    layer.update(everywhere, 1 / 60);
    expect(tops.children.every((child) => child.visible)).toBe(true);
    expect(shadows.children[0]?.visible).toBe(true);
    // Depth-sorted among the buildings, like the attack screen's creeps.
    expect(tops.children.every((child) => child.zIndex > 0)).toBe(true);
  });

  it("keeps Teratorn, Zafreeti, Vorg and Balthazar on the ground in their pens, flapping (#211)", async () => {
    for (const id of ["C14", "C15", "C16", "IC5", "C1"]) {
      const { layer, tops, shadows } = setUp();
      layer.set(life({ groups: [{ id, level: 1, count: 1 }], champions: [], workers: 0 }), bounds);
      layer.attach(tops, shadows);
      layer.update(everywhere, 0);
      await flush();
      const [walker] = layer.walkerList;
      const body = tops.children[0] as Sprite | undefined;
      if (!walker || !body) throw new Error(`no ${id}`);
      const sheet = MONSTER_SPRITES[id]!;
      for (let frame = 0; frame < 40; frame++) {
        layer.update(everywhere, 1 / 10);
        const groundX = walker.x - walker.y + bounds.originX;
        const groundY = (walker.x + walker.y) / 2 + bounds.originY;
        // On its ground point, with no altitude and no bob (`CreepBase.as:260`).
        expect(body.y).toBeCloseTo(groundY - sheet.anchorY, 6);
        expect(body.zIndex).toBe(creepZIndex(groundX, groundY, 1));
        const [shadow] = shadows.children;
        if (shadow) expect(shadow.y).toBeCloseTo(groundY + shadowOffset(sheet)!.y, 6);
      }
    }
  });

  it("hides what is off screen and everything while hidden", async () => {
    const { layer, tops, shadows } = setUp();
    layer.set(life(), bounds);
    layer.attach(tops, shadows);
    layer.update(everywhere, 0);
    await flush();
    layer.update(nowhere, 1 / 60);
    expect(tops.children.some((child) => child.visible)).toBe(false);

    layer.update(everywhere, 1 / 60);
    layer.setHidden(true);
    expect(tops.children.some((child) => child.visible)).toBe(false);
    layer.update(everywhere, 1 / 60);
    expect(tops.children.some((child) => child.visible)).toBe(false);
  });

  it("keeps its creatures through a yard redraw", () => {
    const { layer, tops, shadows } = setUp();
    layer.set(life(), bounds);
    layer.attach(tops, shadows);
    const before = layer.walkerList.map((walker) => [walker.key, walker.x, walker.y]);
    const bodies = [...tops.children];

    layer.detach();
    expect(tops.children).toHaveLength(0);
    const fresh = new Container();
    layer.attach(fresh, new Container());
    layer.set(life(), yardBounds(0));
    expect(layer.walkerList.map((walker) => [walker.key, walker.x, walker.y])).toEqual(before);
    expect(fresh.children).toEqual(bodies);
  });

  it("redraws a champion in its new look when it evolves, without a reload (#311)", async () => {
    const { layer, tops, shadows } = setUp(true);
    const at = (level: number) =>
      life({ groups: [], workers: 0, champions: [{ id: "G1", level, sheetLevel: level }] });
    layer.set(at(2), bounds);
    layer.attach(tops, shadows);
    layer.update(everywhere, 0);
    await flush();
    layer.update(everywhere, 0);
    const old = tops.children[0] as Sprite | undefined;
    if (!old) throw new Error("no champion");
    expect(old.width).toBe(MONSTER_SPRITES["G1_2"]!.frameWidth);

    layer.set(at(5), bounds);
    expect(tops.children).toHaveLength(1);
    layer.update(everywhere, 0);
    await flush();
    layer.update(everywhere, 0);
    const body = tops.children[0] as Sprite | undefined;
    expect(body).not.toBe(old);
    expect(body?.visible).toBe(true);
    expect(body?.width).toBe(MONSTER_SPRITES["G1_5"]!.frameWidth);
  });

  it("drops the bodies of creatures that are gone, and clears on null", () => {
    const { layer, tops, shadows } = setUp();
    layer.set(life(), bounds);
    layer.attach(tops, shadows);
    layer.set(life({ groups: [{ id: "C1", level: 1, count: 1 }], workers: 1 }), bounds);
    expect(layer.count).toBe(3);
    expect(tops.children).toHaveLength(3);
    expect(shadows.children).toHaveLength(0);
    layer.set(null, bounds);
    expect(layer.count).toBe(0);
    expect(tops.children).toHaveLength(0);
  });

  it("keeps a flying Fomor hovering and flapping in its cage, standing or pacing (#206)", async () => {
    const fomorAt = async (sheetLevel: number, reduced = false) => {
      const { layer, tops, shadows } = setUp(reduced);
      layer.set(
        life({ groups: [], workers: 0, champions: [{ id: "G3", level: sheetLevel, sheetLevel }] }),
        bounds,
      );
      layer.attach(tops, shadows);
      layer.update(everywhere, 0);
      await flush();
      layer.update(everywhere, 0);
      const [walker] = layer.walkerList;
      const body = tops.children[0] as Sprite | undefined;
      const [shadow] = shadows.children;
      if (!walker || !body) throw new Error("no Fomor");
      const groundX = walker.x - walker.y + bounds.originX;
      const groundY = (walker.x + walker.y) / 2 + bounds.originY;
      return { layer, walker, body, shadow, groundX, groundY };
    };

    for (const level of [3, 6]) {
      const sheet = MONSTER_SPRITES[`G3_${level}`]!;
      const walk = sheet.animations.walk!;
      const fomor = await fomorAt(level);
      const { layer, walker, body, shadow } = fomor;
      expect(walker.moving).toBe(false);
      const rows = new Set<number>();
      const heights = new Set<number>();
      for (let frame = 0; frame < 60; frame++) {
        layer.update(everywhere, 1 / 40);
        const groundY = (walker.x + walker.y) / 2 + bounds.originY;
        // At its flight height with the bob, not on its level's offset.
        expect(body.y).toBeCloseTo(groundY + championFlightTop(walker.age), 6);
        expect(body.x).toBeCloseTo(walker.x - walker.y + bounds.originX - sheet.anchorX, 6);
        // On a wing-beat row, never row 0, the folded-wing standing pose.
        const row = Math.round(body.texture.frame.y / sheet.frameHeight);
        expect(row).toBeGreaterThanOrEqual(walk.first);
        rows.add(row);
        heights.add(Math.round(body.y - groundY));
        // Its shadow stays on the ground.
        expect(shadow?.y).toBeCloseTo(groundY + shadowOffset(sheet)!.y, 6);
      }
      expect(rows.size).toBeGreaterThan(1);
      expect(heights.size).toBeGreaterThan(1);
      // It sorts at its altitude, as on the attack screen.
      expect(body.zIndex).toBeGreaterThan(creepZIndex(fomor.groundX, fomor.groundY, 1));
    }

    // Under reduced motion it holds still at -144, still in the air.
    const calm = await fomorAt(6, true);
    expect(calm.body.y).toBe(calm.groundY - 144);

    // A Fomor on foot, at level 2, stands on its offset.
    const two = await fomorAt(2, true);
    expect(two.body.y).toBe(two.groundY - MONSTER_SPRITES["G3_2"]!.anchorY);
  });

  it("walks the creatures on the clock, and under reduced motion does not", () => {
    for (const reduced of [false, true]) {
      const { layer, tops, shadows } = setUp(reduced);
      layer.set(life({ groups: [{ id: "C1", level: 1, count: 1 }], champions: [] }), bounds);
      layer.attach(tops, shadows);
      const [walker] = layer.walkerList;
      if (!walker) throw new Error("no walker");
      walker.moving = true;
      walker.targetX = walker.x + 50;
      const from = walker.x;
      layer.update(everywhere, 0.25);
      if (reduced) expect(walker.x).toBe(from);
      else expect(walker.x).toBeGreaterThan(from);
    }
  });

  it("sends a worker walking to a job that starts, and stands one at a job there on load", () => {
    const job = { id: 9, x: 300, y: 300, width: 40, height: 40 };
    // Seeded (issue #210): with `Math.random` the worker now and then starts
    // on the very spot the job sends it to, and has nowhere to walk.
    const { layer, tops, shadows } = setUp(false, mulberry32(7).float);
    layer.set(life({ workers: 1 }), bounds);
    layer.attach(tops, shadows);
    const [worker] = layer.workerList;
    if (!worker) throw new Error("no worker");
    const start = { x: worker.x, y: worker.y };
    layer.set(life({ workers: 1, jobs: [job] }), bounds);
    expect(worker.job).toBe(9);
    expect({ x: worker.x, y: worker.y }).toEqual(start);
    layer.update(everywhere, 1);
    expect(Math.hypot(worker.x - start.x, worker.y - start.y)).toBeGreaterThan(5);

    const loaded = setUp();
    loaded.layer.set(life({ workers: 1, jobs: [job] }), bounds);
    const [there] = loaded.layer.workerList;
    expect(there?.x).toBe(there?.targetX);
    expect(there?.y).toBe(there?.targetY);
  });
});

describe("YardLifeLayer champion trips (#314)", () => {
  const chamber = { x: 300, y: 300, width: 60, height: 60 };
  const caged = life({ groups: [], pens: [], workers: 0, chamber });
  const frozen = life({ groups: [], pens: [], workers: 0, chamber, champions: [], frozen: ["G1"] });
  const straight = (from: { x: number; y: number }, to: { x: number; y: number }) => [from, to];
  const champion = (layer: YardLifeLayer) => layer.walkerList.find((walker) => walker.champion);

  it("walks a frozen champion to the Chamber's door, then takes it and its body off", () => {
    const { layer, tops, shadows } = setUp();
    layer.set(caged, bounds, straight);
    layer.attach(tops, shadows);
    const walker = champion(layer);
    layer.set(frozen, bounds, straight);
    expect(champion(layer)).toBe(walker);
    expect(walker?.leaving).toBe(true);
    expect(tops.children).toHaveLength(1);
    for (let frame = 0; frame < 600 && layer.count > 0; frame++) layer.update(everywhere, 1 / 10);
    expect(layer.count).toBe(0);
    expect(tops.children).toHaveLength(0);
  });

  it("brings a thawed champion out of the Chamber's door and leaves it pacing its cage", () => {
    const { layer, tops, shadows } = setUp();
    layer.set(frozen, bounds, straight);
    layer.attach(tops, shadows);
    expect(layer.count).toBe(0);
    layer.set(caged, bounds, straight);
    const walker = champion(layer);
    expect(walker).toMatchObject({ x: 360, y: 360, leaving: false, moving: true });
    for (let frame = 0; frame < 600 && walker?.trip; frame++) layer.update(everywhere, 1 / 10);
    expect(walker?.trip).toBeNull();
    expect(layer.count).toBe(1);
    const area = walker!.area;
    expect(walker!.x).toBeGreaterThanOrEqual(area.x);
    expect(walker!.x).toBeLessThanOrEqual(area.x + area.width);
  });

  it("snaps with no route, under reduced motion, and on a yard read fresh", () => {
    const noRoute = setUp();
    noRoute.layer.set(caged, bounds, () => null);
    noRoute.layer.set(frozen, bounds, () => null);
    expect(noRoute.layer.count).toBe(0);

    const still = setUp(true);
    still.layer.set(caged, bounds, straight);
    still.layer.set(frozen, bounds, straight);
    expect(still.layer.count).toBe(0);
    still.layer.set(caged, bounds, straight);
    expect(champion(still.layer)?.trip).toBeNull();

    const fresh = setUp();
    fresh.layer.set(frozen, bounds, straight);
    fresh.layer.set(null, bounds, straight);
    fresh.layer.set(caged, bounds, straight);
    expect(champion(fresh.layer)?.trip).toBeNull();
  });

  it("drops a champion still walking in when the player leaves the yard", () => {
    const { layer } = setUp();
    layer.set(caged, bounds, straight);
    layer.set(frozen, bounds, straight);
    expect(layer.count).toBe(1);
    layer.set(null, bounds, straight);
    expect(layer.count).toBe(0);
  });
});
