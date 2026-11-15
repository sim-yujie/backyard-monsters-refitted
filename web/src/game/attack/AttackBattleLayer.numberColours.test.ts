import { describe, expect, it, vi } from "vitest";
import { Container, Texture, TextureSource } from "pixi.js";
import type { BaseLoadResponse } from "@/api/types";
import { readYard } from "@/game/yard/yardModel";
import { AttackBattleLayer, MonsterSheetTextures, type BattleYardHost } from "./AttackBattleLayer";
import { AttackSession } from "./AttackSession";
import type { AttackTarget } from "./attackTarget";
import { LABEL_COLOUR, LABEL_FOE_COLOUR, numberColour, type NumberKind, type Side } from "./creepFx";
import { MONSTER_SPRITES } from "./monsterSpriteData";
import { sheetUrl } from "./monsterSprites";
import { viewerSideOf } from "./plugins/battle";

/**
 * The damage numbers' colours by side (owner, beta 8): over a real fight
 * with a Monster Bunker's garrison and a Cannon Tower, the attacker sees the
 * yard's and its defenders' losses in white and its own monsters' in red; a
 * player watching their own yard raided sees the reverse. Heals stay green.
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
      // A Monster Bunker holding two Fangs, a Cannon Tower and a harvester.
      "1": { id: 1, t: 22, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 20, l: 1, X: 100, Y: 100 },
      "3": { id: 3, t: 1, l: 1, X: 200, Y: 200 },
    },
    buildinghealthdata: {},
    resources: { r1: 1000, r2: 0, r3: 0, r4: 0 },
    attackid: 77,
    storedata: {},
    defenderforces: { bunkers: { 1: { C8: 2 } }, defenderLevels: { C8: 3 } },
  }) as unknown as BaseLoadResponse;

const target: AttackTarget = {
  baseid: "3502",
  kind: "main",
  cell: { col: 241, row: 208 },
  name: "Yard",
  roster: {
    monsters: { C1: 8 },
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

const hostOf = (): BattleYardHost => {
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

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

interface Shown {
  readonly key: string;
  readonly kind: NumberKind;
  readonly colour: number | undefined;
}

/** Fights Pokeys into the bunker yard for a few seconds and lists every number, its kind and the colour drawn. */
const fight = async (viewer: Side | undefined, classic: boolean): Promise<{ shown: Shown[]; friendly: Set<number> }> => {
  const session = new AttackSession({ target, seed: 1 });
  session.load(yardOf());
  const layer = new AttackBattleLayer({
    session,
    yard: readYard(yardOf()),
    host: hostOf(),
    overlay: new Container(),
    reducedMotion: false,
    juice: classic ? "off" : "full",
    classic,
    effectsQuality: "full",
    textures: new MonsterSheetTextures(blankSheet),
    shotSheet: () => Promise.resolve(new Texture({ source: new TextureSource({ width: 768, height: 1728 }) })),
    ...(viewer ? { viewer } : {}),
  });
  const fx = layer.creepEffects;
  const shown: Shown[] = [];
  const original = fx.number.bind(fx);
  vi.spyOn(fx, "number").mockImplementation((tick, key, follow, amount, at, kind, mods) => {
    original(tick, key, follow, amount, at, kind, mods);
    const parts = fx.partsFor(key);
    shown.push({ key, kind, colour: parts[parts.length - 1]?.colour });
  });
  const friendly = new Set<number>();
  session.appendFling({ x: 150, y: 150, monsters: { C1: 8 } });
  await flush();
  for (let frame = 0; frame < 60 * 12; frame += 1) {
    session.advance(1 / 60);
    layer.update();
    for (const creep of session.battle()?.creeps() ?? []) if (creep.friendly) friendly.add(creep.id);
  }
  layer.destroy();
  return { shown, friendly };
};

const creepIdOf = (key: string): number => Number(key.slice("creep:".length));

describe("damage numbers by side over a real fight (owner, beta 8)", () => {
  for (const classic of [false, true]) {
    const look = classic ? "Classic" : "Modern";

    it(`${look}, attacking: buildings and the bunker's Fangs lose in white, the Pokeys in red`, async () => {
      const { shown, friendly } = await fight(undefined, classic);
      const buildings = shown.filter((number) => number.key.startsWith("building:"));
      const defenders = shown.filter((number) => number.key.startsWith("creep:") && friendly.has(creepIdOf(number.key)));
      const attackers = shown.filter(
        (number) => number.key.startsWith("creep:") && !friendly.has(creepIdOf(number.key)) && number.kind !== "heal",
      );
      expect(buildings.length).toBeGreaterThan(0);
      expect(defenders.length).toBeGreaterThan(0);
      expect(attackers.length).toBeGreaterThan(0);
      for (const number of [...buildings, ...defenders]) {
        expect(number.kind).toBe("defenderLoss");
        // A number dropped by the per-target cap has no colour of its own to check.
        if (number.colour !== undefined) expect(number.colour).toBe(LABEL_FOE_COLOUR);
      }
      for (const number of attackers) {
        expect(number.kind).toBe("attackerLoss");
        if (number.colour !== undefined) expect(number.colour).toBe(LABEL_COLOUR);
      }
      expect(buildings.some((number) => number.colour === LABEL_FOE_COLOUR)).toBe(true);
      expect(attackers.some((number) => number.colour === LABEL_COLOUR)).toBe(true);
    });

    it(`${look}, watching one's own yard raided: buildings and Fangs lose in red, the raiders in white`, async () => {
      const { shown, friendly } = await fight("defender", classic);
      const buildings = shown.filter((number) => number.key.startsWith("building:"));
      const raiders = shown.filter(
        (number) => number.key.startsWith("creep:") && !friendly.has(creepIdOf(number.key)) && number.kind !== "heal",
      );
      expect(buildings.length).toBeGreaterThan(0);
      expect(raiders.length).toBeGreaterThan(0);
      expect(buildings.some((number) => number.colour === LABEL_COLOUR)).toBe(true);
      expect(raiders.some((number) => number.colour === LABEL_FOE_COLOUR)).toBe(true);
      for (const number of buildings) if (number.colour !== undefined) expect(number.colour).toBe(LABEL_COLOUR);
      for (const number of raiders) if (number.colour !== undefined) expect(number.colour).toBe(LABEL_FOE_COLOUR);
    });
  }

  it("colours a heal green on either side", () => {
    expect(numberColour("heal", "attacker")).toBe(numberColour("heal", "defender"));
    expect(numberColour("heal", "attacker")).not.toBe(LABEL_COLOUR);
    expect(numberColour("heal", "attacker")).not.toBe(LABEL_FOE_COLOUR);
  });
});

describe("whose side the player watching is on", () => {
  it("is the defender's on their own yard, the attacker's otherwise", () => {
    expect(viewerSideOf({})).toBe("attacker");
    expect(viewerSideOf({ raid: {} as never })).toBe("defender");
    expect(viewerSideOf({ practice: {} as never })).toBe("defender");
    expect(viewerSideOf({ watch: { kind: "defence" } as never })).toBe("defender");
    expect(viewerSideOf({ watch: { kind: "autoAttack" } as never })).toBe("attacker");
    expect(viewerSideOf({ watch: {} as never })).toBe("attacker");
  });
});
