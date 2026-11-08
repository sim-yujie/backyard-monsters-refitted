import { describe, expect, it } from "vitest";
import { Container, Sprite, Texture, TextureSource } from "pixi.js";
import type { BaseLoadResponse } from "@/api/types";
import type { RaidEvent } from "@/game/combat/rules";
import { readYard } from "@/game/yard/yardModel";
import { AttackBattleLayer, MonsterSheetTextures, type BattleYardHost } from "./AttackBattleLayer";
import { AttackSession } from "./AttackSession";
import type { AttackTarget } from "./attackTarget";
import { MONSTER_SPRITES } from "./monsterSpriteData";
import { sheetStandInUrl, sheetUrl } from "./monsterSprites";

/**
 * Patch 6.4: on a slow line a raid's monsters were green squares until their
 * `@4x` paintings came, about 30 s for a Dreadnaut raid's Crabatrons and
 * Brains on Fast 3G. The battle layer now also fetches each sheet's small 1x
 * copy and draws that until the full one is in.
 */

const CRABATRON = MONSTER_SPRITES["C10"]!;

/** A loader whose fetches the test settles by hand. */
const deferredLoader = () => {
  const waiting = new Map<string, { resolve: (texture: Texture) => void; reject: (error: Error) => void }>();
  const asked: string[] = [];
  const load = (url: string): Promise<Texture> => {
    asked.push(url);
    return new Promise((resolve, reject) => waiting.set(url, { resolve, reject }));
  };
  const texture = (width: number, height: number): Texture =>
    new Texture({ source: new TextureSource({ width, height }) });
  return {
    load,
    asked,
    settle: async (url: string | null, width = CRABATRON.width, height = CRABATRON.height) => {
      waiting.get(url!)!.resolve(texture(width, height));
      await Promise.resolve();
      await Promise.resolve();
    },
    fail: async (url: string | null) => {
      waiting.get(url!)!.reject(new Error("offline"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
};

describe("sheetStandInUrl", () => {
  it("names a painting's 1x copy, with its version", () => {
    expect(sheetUrl(CRABATRON)).toContain("crabatron-anim@4x.png");
    expect(sheetStandInUrl(CRABATRON)).toMatch(/^\/assets\/monsters\/crabatron-anim\.png\?v=/);
  });

  it("has nothing for a sheet that is not painted", () => {
    const plain = Object.values(MONSTER_SPRITES).find((sheet) => !/@\d/.test(sheetUrl(sheet)));
    expect(plain).toBeDefined();
    expect(sheetStandInUrl(plain!)).toBeNull();
  });
});

describe("MonsterSheetTextures stand-ins", () => {
  it("draws the small copy until the full one is in, then the full one", async () => {
    const loader = deferredLoader();
    const textures = new MonsterSheetTextures(loader.load);
    const standIn = sheetStandInUrl(CRABATRON);
    const full = sheetUrl(CRABATRON);

    expect(textures.frame(CRABATRON, 0, 0, true)).toBeNull();
    expect(loader.asked).toEqual([standIn, full]);

    await loader.settle(standIn);
    const small = textures.frame(CRABATRON, 0, 0, true);
    expect(small).not.toBeNull();
    expect(textures.frame(CRABATRON, 0, 0, true)).toBe(small);
    // A caller that did not ask for stand-ins still waits for the full sheet.
    expect(textures.frame(CRABATRON, 0, 0)).toBeNull();

    await loader.settle(full);
    const big = textures.frame(CRABATRON, 0, 0, true);
    expect(big).not.toBeNull();
    expect(big).not.toBe(small);
    // Same cell, same size in world units, whichever copy it came from.
    expect(big!.frame.width).toBe(small!.frame.width);
    expect(loader.asked).toEqual([standIn, full]);
    textures.destroy();
  });

  it("never fetches a stand-in for a caller that does not want one", () => {
    const loader = deferredLoader();
    const textures = new MonsterSheetTextures(loader.load);
    textures.preload(CRABATRON);
    expect(textures.frame(CRABATRON, 0, 0)).toBeNull();
    expect(loader.asked).toEqual([sheetUrl(CRABATRON)]);
  });

  it("does not fetch the stand-in once the full sheet is in", async () => {
    const loader = deferredLoader();
    const textures = new MonsterSheetTextures(loader.load);
    textures.preload(CRABATRON);
    await loader.settle(sheetUrl(CRABATRON));
    expect(textures.frame(CRABATRON, 0, 0, true)).not.toBeNull();
    expect(loader.asked).toEqual([sheetUrl(CRABATRON)]);
  });

  it("keeps drawing the stand-in when the full sheet fails", async () => {
    const loader = deferredLoader();
    const textures = new MonsterSheetTextures(loader.load);
    textures.preload(CRABATRON, true);
    await loader.settle(sheetStandInUrl(CRABATRON));
    const warn = console.warn;
    console.warn = () => {};
    try {
      await loader.fail(sheetUrl(CRABATRON));
    } finally {
      console.warn = warn;
    }
    expect(textures.isMissing(CRABATRON)).toBe(true);
    expect(textures.frame(CRABATRON, 0, 0, true)).not.toBeNull();
  });
});

/* ── The battle layer swaps the stand-in for the full sheet ─────────────── */

const yard = (): BaseLoadResponse =>
  ({
    error: 0,
    id: 1,
    baseid: "1000241208",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: 1_700_000_000,
    buildingdata: { "1": { id: 1, t: 14, l: 1, X: 0, Y: 0 } },
    buildinghealthdata: {},
    resources: { r1: 100_000, r2: 100_000, r3: 0, r4: 0 },
  }) as unknown as BaseLoadResponse;

const target = (): AttackTarget => ({
  baseid: "1000241208",
  kind: "main",
  name: "Dreadnaut raid",
  load: yard(),
  roster: {
    monsters: {},
    levels: {},
    champions: [],
    flingerLevel: 0,
    catapultLevel: 0,
    sources: [],
    siege: null,
    resources: null,
  },
});

const WAVE: RaidEvent[] = [{ kind: "raid", t: 0, x: 600, y: -500, r: 0, monsters: { C10: 1 } }];

describe("AttackBattleLayer: a raider drawn from its stand-in", () => {
  it("shows the small copy, not a square, then the full painting once it lands", async () => {
    const loader = deferredLoader();
    const depth = new Container();
    depth.sortableChildren = true;
    const host: BattleYardHost = {
      depthSortedLayer: () => depth,
      centreOf: () => ({ x: 400, y: 400 }),
      setBuildingDamage: () => {},
      setConcealed: () => {},
      setAnimFrame: () => {},
    };
    const session = new AttackSession({ target: target(), seed: 1, raid: true });
    const layer = new AttackBattleLayer({
      session,
      yard: readYard(yard()),
      host,
      overlay: new Container(),
      reducedMotion: true,
      textures: new MonsterSheetTextures(loader.load),
      bombArt: { cell: () => Texture.WHITE, destroy() {} },
    });
    session.playScript(WAVE, 4_000);
    session.start();
    layer.update();
    // The script's sheets are asked for at once, the stand-in first.
    expect(loader.asked.slice(0, 2)).toEqual([sheetStandInUrl(CRABATRON), sheetUrl(CRABATRON)]);

    const body = (): Sprite => {
      const sprites = depth.children.filter((child): child is Sprite => child instanceof Sprite);
      expect(sprites.length).toBeGreaterThan(0);
      return sprites[sprites.length - 1]!;
    };

    session.advance(0.1);
    layer.update();
    expect(body().texture).toBe(Texture.WHITE);

    await loader.settle(sheetStandInUrl(CRABATRON));
    session.advance(0.1);
    layer.update();
    const small = body().texture;
    expect(small).not.toBe(Texture.WHITE);

    await loader.settle(sheetUrl(CRABATRON));
    session.advance(0.0125);
    layer.update();
    expect(body().texture).not.toBe(small);
    expect(body().texture).not.toBe(Texture.WHITE);
    layer.destroy();
  });
});
