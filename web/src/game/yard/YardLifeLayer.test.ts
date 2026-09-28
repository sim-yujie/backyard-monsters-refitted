import { Container, Texture, TextureSource } from "pixi.js";
import { describe, expect, it } from "vitest";
import { MonsterSheetTextures } from "@/game/attack/AttackBattleLayer";
import { MONSTER_SPRITES } from "@/game/attack/monsterSpriteData";
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
  groups: [
    { id: "C1", level: 1, count: 3 },
    { id: "C14", level: 1, count: 1 },
  ],
  pens: [{ id: 5, x: 0, y: 0 }],
  cage: { id: 6, x: -200, y: -200 },
  champions: [{ id: "G1", level: 2, sheetLevel: 2 }],
  ...overrides,
});

const setUp = (reducedMotion = false) => {
  const layer = new YardLifeLayer({ textures: textures(), reducedMotion });
  const tops = new Container();
  const shadows = new Container();
  return { layer, tops, shadows };
};

describe("YardLifeLayer", () => {
  it("puts a body per creature in the building container, a flyer's shadow below", async () => {
    const { layer, tops, shadows } = setUp();
    layer.set(life(), bounds);
    expect(layer.attach(tops, shadows)).toBe(true);
    // 3 Pokeys, a Teratorn, a Gorgo.
    expect(layer.count).toBe(5);
    expect(tops.children).toHaveLength(5);
    expect(shadows.children).toHaveLength(1);

    layer.update(everywhere, 0);
    await flush();
    layer.update(everywhere, 1 / 60);
    expect(tops.children.every((child) => child.visible)).toBe(true);
    expect(shadows.children[0]?.visible).toBe(true);
    // Depth-sorted among the buildings, like the attack screen's creeps.
    expect(tops.children.every((child) => child.zIndex > 0)).toBe(true);
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

  it("drops the bodies of creatures that are gone, and clears on null", () => {
    const { layer, tops, shadows } = setUp();
    layer.set(life(), bounds);
    layer.attach(tops, shadows);
    layer.set(life({ groups: [{ id: "C1", level: 1, count: 1 }] }), bounds);
    expect(layer.count).toBe(2);
    expect(tops.children).toHaveLength(2);
    expect(shadows.children).toHaveLength(0);
    layer.set(null, bounds);
    expect(layer.count).toBe(0);
    expect(tops.children).toHaveLength(0);
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

});
