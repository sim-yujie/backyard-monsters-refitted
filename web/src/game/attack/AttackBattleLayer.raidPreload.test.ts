import { describe, expect, it } from "vitest";
import { Container, Texture, TextureSource } from "pixi.js";
import type { BaseLoadResponse } from "@/api/types";
import type { RaidEvent } from "@/game/combat/rules";
import { readYard } from "@/game/yard/yardModel";
import { AttackBattleLayer, MonsterSheetTextures, type BattleYardHost } from "./AttackBattleLayer";
import { AttackSession } from "./AttackSession";
import type { AttackTarget } from "./attackTarget";
import { MONSTER_SPRITES } from "./monsterSpriteData";
import { sheetUrl } from "./monsterSprites";

/**
 * A raid's raiders (a tribe's waves, the Trojan Horse's 51) are in no roster,
 * so the battle layer asks for their sheets from the script as soon as it is
 * handed one. Before, a sheet was asked for only when its first monster came
 * out, and the Trojan Horse's last spawns, Crabatron and Project X with the
 * biggest sheets, fought as green squares while theirs downloaded (Rygnus,
 * 6 Nov).
 */

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
  name: "wild raid",
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

/** The Trojan Horse's opening and its last two kinds, the last of them a minute in. */
const SPAWNS: RaidEvent[] = [
  { kind: "raid", t: 0, x: 900, y: -700, r: 0, monsters: { C1: 1 } },
  { kind: "raid", t: 3_000, x: 900, y: -700, r: 0, monsters: { C10: 1 } },
  { kind: "raid", t: 3_400, x: 900, y: -700, r: 0, monsters: { C11: 1, C9: 0 } },
];

const host = (): BattleYardHost => {
  const depth = new Container();
  depth.sortableChildren = true;
  return {
    depthSortedLayer: () => depth,
    centreOf: () => ({ x: 400, y: 400 }),
    setBuildingDamage: () => {},
    setConcealed: () => {},
    setAnimFrame: () => {},
  };
};

const setUp = () => {
  const asked: string[] = [];
  const load = (url: string): Promise<Texture> => {
    asked.push(url);
    const sheet = Object.values(MONSTER_SPRITES).find((candidate) => url === sheetUrl(candidate));
    return Promise.resolve(
      new Texture({ source: new TextureSource({ width: sheet?.width ?? 8, height: sheet?.height ?? 8 }) }),
    );
  };
  const session = new AttackSession({ target: target(), seed: 1, raid: true });
  const layer = new AttackBattleLayer({
    session,
    yard: readYard(yard()),
    host: host(),
    overlay: new Container(),
    reducedMotion: false,
    textures: new MonsterSheetTextures(load),
    bombArt: { cell: () => Texture.WHITE, destroy() {} },
  });
  return { session, layer, asked };
};

describe("AttackBattleLayer: a raid's sheets", () => {
  it("asks for every raider's sheet when the script arrives, not when each first comes out", () => {
    const { session, layer, asked } = setUp();
    layer.update();
    expect(asked).toEqual([]);

    session.playScript(SPAWNS, 4_000);
    layer.update();
    const sheets = ["C1", "C10", "C11"].map((id) => sheetUrl(MONSTER_SPRITES[id]!));
    expect(asked).toEqual(expect.arrayContaining(sheets));
    // A kind the script brings none of is not fetched.
    expect(asked).not.toContain(sheetUrl(MONSTER_SPRITES["C9"]!));

    // Once per script: later frames do not ask again.
    const count = asked.length;
    layer.update();
    layer.update();
    expect(asked.length).toBe(count);
    layer.destroy();
  });

  it("lists the script's monster kinds on the session", () => {
    const session = new AttackSession({ target: target(), seed: 1, raid: true });
    expect(session.scriptedMonsters()).toEqual([]);
    const before = session.scriptStamp;
    session.playScript(SPAWNS, 4_000);
    expect(session.scriptStamp).toBe(before + 1);
    expect(session.scriptedMonsters().sort()).toEqual(["C1", "C10", "C11"]);
  });
});
