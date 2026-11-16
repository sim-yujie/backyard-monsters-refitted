// @vitest-environment jsdom
// jsdom: a zombie's colour-matrix filter asks for a canvas when it is made.
import { describe, expect, it } from "vitest";
import { Container, Texture, TextureSource } from "pixi.js";
import type { BaseLoadResponse } from "@/api/types";
import { TICKS_PER_SECOND } from "@/game/combat/rules";
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
import { RISE_TICKS } from "./raiseFx";

/**
 * Rezghul's raise, drawn (`raiseFx.ts`): its orb flies while the engine says
 * it is in the air, the raised monster climbs out of the ground, and it greys
 * over its first second. Six Pokeys and a level 3 Rezghul on a harvester
 * between two level 6 Cannon Towers, as the engine's own Rezghul tests.
 */

const yardOf = (): BaseLoadResponse =>
  ({
    error: 0,
    id: 1,
    baseid: "3502",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: 1_700_000_000,
    buildingdata: {
      "1": { id: 1, t: 20, l: 6, X: 0, Y: 0 },
      "2": { id: 2, t: 20, l: 6, X: 100, Y: 0 },
      "4": { id: 4, t: 1, l: 1, X: 150, Y: 150 },
    },
    buildinghealthdata: {},
    resources: { r1: 100000, r2: 0, r3: 0, r4: 0 },
    attackid: 77,
    storedata: {},
  }) as unknown as BaseLoadResponse;

const targetOf = (): AttackTarget => ({
  baseid: "3502",
  kind: "wild",
  cell: { col: 241, row: 208 },
  name: "Kozu",
  roster: {
    monsters: { C1: 6, C19: 1 },
    levels: { C19: 3 },
    ranks: {},
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
  if (!sheet)
    return Promise.resolve(
      new Texture({ source: new TextureSource({ width: 20, height: 20 }) }),
    );
  return Promise.resolve(
    new Texture({ source: new TextureSource({ width: sheet.width, height: sheet.height }) }),
  );
};

const hostOf = (): BattleYardHost => {
  const depth = new Container();
  depth.sortableChildren = true;
  return {
    depthSortedLayer: () => depth,
    centreOf: () => ({ x: 300, y: 200 }),
    setBuildingDamage: () => {},
    setConcealed: () => {},
    setAnimFrame: () => {},
  };
};

describe("Rezghul's raise, drawn", () => {
  for (const classic of [true, false]) {
    it(`flies its orb, raises the zombie out of the ground and greys it (${classic ? "Classic" : "Modern"})`, () => {
      const session = new AttackSession({ target: targetOf(), seed: 3 });
      const response = yardOf();
      session.load(response);
      const layer = new AttackBattleLayer({
        session,
        yard: readYard(response),
        host: hostOf(),
        overlay: new Container(),
        reducedMotion: false,
        classic,
        textures: new MonsterSheetTextures(blankSheet),
      });
      session.appendFling({ x: 150, y: 150, monsters: { C1: 6, C19: 1 } });

      let flewFor = 0;
      let burstFor = 0;
      let bolts = 0;
      let zombie: { id: number; tick: number; y: number } | null = null;
      const saturations: number[] = [];
      const climb: number[] = [];
      for (let step = 0; step < 40 * TICKS_PER_SECOND; step += 1) {
        session.advance(1 / TICKS_PER_SECOND);
        layer.update();
        const battle = session.battle();
        if (!battle || battle.over()) break;
        if (layer.raiseEffects.flightCount > 0) flewFor += 1;
        if (layer.raiseEffects.burstCount > 0) burstFor += 1;
        bolts += layer.raiseEffects.boltCount;
        if (!zombie) {
          const raised = battle.creeps().find((creep) => creep.zombie === true);
          const body = raised ? layer.bodyOf(raised.id) : null;
          if (raised && body) zombie = { id: raised.id, tick: battle.tick, y: body.y };
          continue;
        }
        const body = layer.bodyOf(zombie.id);
        if (!body || battle.tick - zombie.tick > 2 * TICKS_PER_SECOND) break;
        saturations.push(body.saturation);
        if (battle.tick - zombie.tick <= RISE_TICKS) climb.push(body.y);
      }

      // The orb was in the air for the frames between the throw and the landing.
      expect(flewFor).toBeGreaterThan(10);
      expect(zombie).not.toBeNull();
      // It threw its clods and goo, and no lightning: the owner turned the lines down.
      expect(burstFor).toBeGreaterThan(10);
      expect(bolts).toBe(0);
      // It greys from colour to none over a second, and stays grey.
      expect(saturations[0]).toBeGreaterThan(0.9);
      expect(saturations.at(-1)).toBe(0);
      // It came up out of the ground: drawn lowest on its first frame.
      expect(zombie?.y).toBeGreaterThanOrEqual(Math.max(...climb) - 1);
      layer.destroy();
    });
  }
});
