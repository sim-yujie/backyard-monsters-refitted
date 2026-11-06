import { Container, Texture, TextureSource } from "pixi.js";
import { describe, expect, it } from "vitest";
import { MonsterSheetTextures } from "@/game/attack/AttackBattleLayer";
import { MONSTER_SPRITES } from "@/game/attack/monsterSpriteData";
import { sheetUrl } from "@/game/attack/monsterSprites";
import { yardBounds } from "./YardGrid";
import { EMPTY_LIFE, type TripRoute, type YardLife } from "./yardLifeModel";
import { MAX_JUICE_WALKERS, YardLifeLayer } from "./YardLifeLayer";

const textures = () =>
  new MonsterSheetTextures((url) => {
    const sheet = Object.values(MONSTER_SPRITES).find((one) => url === sheetUrl(one));
    if (!sheet) return Promise.reject(new Error(url));
    return Promise.resolve(new Texture({ source: new TextureSource({ width: sheet.width, height: sheet.height }) }));
  });

const bounds = yardBounds(0);
const everywhere = { x: -10_000, y: -10_000, width: 20_000, height: 20_000 };
const straight: TripRoute = (from, to) => [from, to];
const door = { x: 300, y: 300 };

const life = (pokeys: number, teratorns = 0): YardLife => ({
  ...EMPTY_LIFE,
  plot: { width: bounds.yardWidth, height: bounds.yardHeight },
  groups: [
    ...(pokeys > 0 ? [{ id: "C1", level: 1, count: pokeys }] : []),
    ...(teratorns > 0 ? [{ id: "C14", level: 1, count: teratorns }] : []),
  ],
  pens: [{ id: 5, x: 0, y: 0 }],
});

const setUp = (reducedMotion = false) => {
  const layer = new YardLifeLayer({ textures: textures(), reducedMotion });
  layer.attach(new Container(), new Container());
  const arrived: string[] = [];
  layer.onJuiceArrive = (monster, juicer) => arrived.push(`${monster}@${juicer}`);
  return { layer, arrived };
};

/** Runs the yard for `seconds` in 1/40 s frames. */
const run = (layer: YardLifeLayer, seconds: number): void => {
  for (let t = 0; t < seconds; t += 1 / 40) layer.update(everywhere, 1 / 40);
};

describe("YardLifeLayer.juice", () => {
  it("walks the monsters the juice took out of the pen into the Juicer, from where they stood", () => {
    const { layer, arrived } = setUp();
    layer.set(life(3, 1), bounds);
    expect(layer.count).toBe(4);
    // The server's answer: two Pokeys and the Teratorn juiced.
    layer.set(life(1), bounds);
    expect(layer.count).toBe(1);
    expect(layer.juice("C1", 2, 9, door, straight, 108)).toBe(2);
    expect(layer.juice("C14", 1, 9, door, straight, 108)).toBe(1);
    expect(layer.count).toBe(4);
    run(layer, 30);
    expect(arrived.sort()).toEqual(["C14@9", "C1@9", "C1@9"]);
    expect(layer.count).toBe(1);
  });

  it("brings new ones out of a pen when the redraw kept none of them", () => {
    const { layer, arrived } = setUp();
    layer.set(life(2), bounds);
    run(layer, 0.1);
    // The dropped ones are only kept until the next frame.
    expect(layer.juice("C1", 3, 9, door, straight, 108)).toBe(3);
    run(layer, 30);
    expect(arrived).toHaveLength(3);
    expect(layer.count).toBe(2);
  });

  it("sends none under reduced motion or with no way there", () => {
    const still = setUp(true);
    still.layer.set(life(2), bounds);
    expect(still.layer.juice("C1", 2, 9, door, straight, 108)).toBe(0);
    const blocked = setUp();
    blocked.layer.set(life(2), bounds);
    expect(blocked.layer.juice("C1", 2, 9, door, () => null, 108)).toBe(0);
  });

  it("drops every walk into the Juicer when the yard is left, with no arrival heard", () => {
    const { layer, arrived } = setUp();
    layer.set(life(2), bounds);
    layer.set(life(0), bounds);
    expect(layer.juice("C1", 2, 9, door, straight, 108)).toBe(2);
    layer.set(null, bounds);
    layer.set(life(0), yardBounds(1));
    run(layer, 1);
    expect(layer.count).toBe(0);
    // A yard left is a show cut short: nothing more to hear, nothing banked by it.
    expect(arrived).toEqual([]);
  });

  it("caps one juice's walkers", () => {
    expect(MAX_JUICE_WALKERS).toBe(40);
  });
});
