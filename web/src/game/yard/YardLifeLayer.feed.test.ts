import { Container, Texture, TextureSource } from "pixi.js";
import { describe, expect, it } from "vitest";
import { MonsterSheetTextures } from "@/game/attack/AttackBattleLayer";
import { MONSTER_SPRITES } from "@/game/attack/monsterSpriteData";
import { sheetUrl } from "@/game/attack/monsterSprites";
import { yardBounds } from "./YardGrid";
import { EMPTY_LIFE, type TripRoute, type YardLife } from "./yardLifeModel";
import { YardLifeLayer } from "./YardLifeLayer";

/** Monsters walking into the champion that eats them (`feedShow.ts`). */

const textures = () =>
  new MonsterSheetTextures((url) => {
    const sheet = Object.values(MONSTER_SPRITES).find((one) => url === sheetUrl(one));
    if (!sheet) return Promise.reject(new Error(url));
    return Promise.resolve(new Texture({ source: new TextureSource({ width: sheet.width, height: sheet.height }) }));
  });

const bounds = yardBounds(0);
const everywhere = { x: -10_000, y: -10_000, width: 20_000, height: 20_000 };
const straight: TripRoute = (from, to) => [from, to];

const life = (octos: number, teratorns = 0): YardLife => ({
  ...EMPTY_LIFE,
  plot: { width: bounds.yardWidth, height: bounds.yardHeight },
  groups: [
    ...(octos > 0 ? [{ id: "C2", level: 1, count: octos }] : []),
    ...(teratorns > 0 ? [{ id: "C14", level: 1, count: teratorns }] : []),
  ],
  pens: [{ id: 5, x: 0, y: 0 }],
  cage: { id: 8, x: 400, y: 400 },
  champions: [{ id: "G1", level: 1, sheetLevel: 1 }],
});

const setUp = (reducedMotion = false) => {
  const layer = new YardLifeLayer({ textures: textures(), reducedMotion });
  layer.attach(new Container(), new Container());
  const arrived: { monster: string; x: number; y: number; altitude: number }[] = [];
  layer.onFeedArrive = (monster, at, altitude) => arrived.push({ monster, ...at, altitude });
  const juiced: string[] = [];
  layer.onJuiceArrive = (monster) => juiced.push(monster);
  return { layer, arrived, juiced };
};

/** Runs the yard for `seconds` in 1/40 s frames. */
const run = (layer: YardLifeLayer, seconds: number): void => {
  for (let t = 0; t < seconds; t += 1 / 40) layer.update(everywhere, 1 / 40);
};

describe("YardLifeLayer.feed", () => {
  it("knows where the champion paces its cage, and nothing for a champion not there", () => {
    const { layer } = setUp();
    layer.set(life(2), bounds);
    const spot = layer.championSpot("G1");
    expect(spot).not.toBeNull();
    expect(spot!.x).toBeGreaterThan(380);
    expect(spot!.y).toBeGreaterThan(380);
    expect(layer.championSpot("G2")).toBeNull();
  });

  it("walks the eaten monsters from the pen into the champion, each heard where it gets there", () => {
    const { layer, arrived, juiced } = setUp();
    layer.set(life(5, 1), bounds);
    // The server's answer: three Octo-oozes and the Teratorn eaten.
    layer.set(life(2), bounds);
    const spot = layer.championSpot("G1")!;
    expect(layer.feed("C2", 3, spot, straight, 108)).toBe(3);
    expect(layer.feed("C14", 1, spot, straight, 108)).toBe(1);
    expect(layer.count).toBe(2 + 1 + 4);
    run(layer, 40);
    expect(arrived.map((one) => one.monster).sort()).toEqual(["C14", "C2", "C2", "C2"]);
    expect(juiced).toEqual([]);
    // Each one bursts on the champion's spot, a flyer up in the air over it.
    const world = { x: spot.x - spot.y + bounds.originX, y: (spot.x + spot.y) / 2 + bounds.originY };
    for (const one of arrived) {
      expect(one.x).toBeCloseTo(world.x, 3);
      expect(one.y).toBeCloseTo(world.y, 3);
    }
    expect(arrived.find((one) => one.monster === "C14")!.altitude).toBeGreaterThan(25);
    expect(arrived.find((one) => one.monster === "C2")!.altitude).toBe(0);
    expect(layer.count).toBe(2 + 1);
  });

  it("sends none under reduced motion or with no way there", () => {
    const still = setUp(true);
    still.layer.set(life(2), bounds);
    expect(still.layer.feed("C2", 2, { x: 420, y: 420 }, straight, 108)).toBe(0);
    const blocked = setUp();
    blocked.layer.set(life(2), bounds);
    expect(blocked.layer.feed("C2", 2, { x: 420, y: 420 }, () => null, 108)).toBe(0);
  });

  it("drops every walk to the champion when the yard is left, with no burst heard", () => {
    const { layer, arrived } = setUp();
    layer.set(life(2), bounds);
    expect(layer.feed("C2", 2, layer.championSpot("G1")!, straight, 108)).toBe(2);
    layer.set(null, bounds);
    layer.set(life(0), yardBounds(1));
    run(layer, 1);
    expect(arrived).toEqual([]);
  });
});
