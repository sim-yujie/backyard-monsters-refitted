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
import { SURFACE_RISE_TICKS } from "./burrowFx";
import { MONSTER_SPRITES } from "./monsterSpriteData";
import { sheetUrl } from "./monsterSprites";

/**
 * A Wormzer tunnels as Flash's did (`MonsterBase.renderBurrow`): nothing of it
 * is drawn underground but its dirt, and it hops out of the ground to swing.
 */

const yardOf = (): BaseLoadResponse =>
  ({
    error: 0,
    id: 1,
    baseid: "3502",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: 1_700_000_000,
    buildingdata: { "1": { id: 1, t: 1, l: 5, X: 0, Y: 0 } },
    buildinghealthdata: {},
    resources: { r1: 1000, r2: 0, r3: 0, r4: 0 },
    attackid: 77,
    storedata: {},
  }) as unknown as BaseLoadResponse;

const targetOf = (): AttackTarget => ({
  baseid: "3502",
  kind: "wild",
  cell: { col: 241, row: 208 },
  name: "Kozu",
  roster: {
    monsters: { C13: 1 },
    levels: {},
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
    centreOf: () => ({ x: 300, y: 200 }),
    setBuildingDamage: () => {},
    setConcealed: () => {},
    setAnimFrame: () => {},
  };
};

const setUp = () => {
  const session = new AttackSession({ target: targetOf(), seed: 1 });
  const response = yardOf();
  session.load(response);
  const layer = new AttackBattleLayer({
    session,
    yard: readYard(response),
    host: hostOf(),
    overlay: new Container(),
    reducedMotion: false,
    textures: new MonsterSheetTextures(blankSheet),
  });
  session.appendFling({ x: -250, y: -250, monsters: { C13: 1 } });
  return { session, layer };
};

const frame = (session: AttackSession, layer: AttackBattleLayer): void => {
  session.advance(1 / TICKS_PER_SECOND);
  layer.update();
};

const wormzer = (session: AttackSession) =>
  session.battle()?.creeps().find((creep) => creep.monsterId === "C13");

describe("a tunnelling Wormzer, drawn as Flash drew it", () => {
  it("is not drawn underground, bar and all, and leaves dirt behind it", () => {
    const { session, layer } = setUp();
    let underFrames = 0;
    for (let step = 0; step < TICKS_PER_SECOND; step += 1) {
      frame(session, layer);
      const creep = wormzer(session);
      if (!creep?.burrowed) continue;
      underFrames += 1;
      expect(layer.bodyOf(creep.id)).toMatchObject({ alpha: 0, barAlpha: 0 });
    }
    expect(underFrames).toBeGreaterThan(TICKS_PER_SECOND / 2);
    // The trail clods linger most of a second, so a second under ground
    // leaves a line of them (Flash's faded after a third of one).
    expect(layer.splatCount).toBeGreaterThanOrEqual(6);
  });

  it("comes up whole and hops out of its hole to swing", async () => {
    const { session, layer } = setUp();
    // Let the sheet arrive, so the body is drawn from it rather than as a marker.
    frame(session, layer);
    await new Promise((resolve) => setTimeout(resolve, 0));
    let surfaced = -1;
    for (let step = 0; step < TICKS_PER_SECOND * 30 && surfaced < 0; step += 1) {
      frame(session, layer);
      const creep = wormzer(session);
      if (creep && !creep.burrowed && creep.state === "attacking") surfaced = creep.id;
    }
    expect(surfaced).toBeGreaterThanOrEqual(0);
    const start = layer.bodyOf(surfaced);
    expect(start).toMatchObject({ alpha: 1, barAlpha: 1 });
    // Half way up the hop it is drawn higher than it landed.
    for (let step = 0; step < SURFACE_RISE_TICKS; step += 1) frame(session, layer);
    const top = layer.bodyOf(surfaced);
    for (let step = 0; step < SURFACE_RISE_TICKS * 4; step += 1) frame(session, layer);
    const after = layer.bodyOf(surfaced);
    if (!start || !top || !after) throw new Error("no body");
    expect(top.y).toBeLessThan(after.y - 5);
  });
});
