import { describe, expect, it } from "vitest";
import { Container, Texture, TextureSource } from "pixi.js";
import type { BaseLoadResponse } from "@/api/types";
import { TICKS_PER_SECOND, type BattleVisualEvent } from "@/game/combat/rules";
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

/**
 * The three new Eye-ra blasts (feat/eyera-explosion) are drawing only: over
 * a real session, each draws its own blast in place of the yellow rings, and
 * the battle comes out the same in every style.
 */

type BuildingRow = { id: number; t: number; l: number; X: number; Y: number };

const yardOf = (buildings: BuildingRow[]): BaseLoadResponse =>
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

const targetOf = (monsters: Record<string, number> = { C1: 20 }): AttackTarget => ({
  baseid: "3502",
  kind: "wild",
  cell: { col: 241, row: 208 },
  name: "Kozu",
  roster: {
    monsters,
    levels: {},
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

interface Host extends BattleYardHost {
  readonly damage: Map<number, number>;
}

const hostOf = (): Host => {
  const depth = new Container();
  depth.sortableChildren = true;
  const damage = new Map<number, number>();
  return {
    damage,
    depthSortedLayer: () => depth,
    centreOf: () => ({ x: 400, y: 400 }),
    setBuildingDamage: (id, fraction) => damage.set(id, fraction),
    setConcealed: () => {},
    setAnimFrame: () => {},
  };
};

const setUp = (
  buildings: BuildingRow[],
  monsters: Record<string, number>,
  blastStyle: "ring" | "punchy" | "fiery" | "goo",
) => {
  const session = new AttackSession({ target: targetOf(monsters), seed: 1 });
  const response = yardOf(buildings);
  session.load(response);
  const host = hostOf();
  const layer = new AttackBattleLayer({
    session,
    yard: readYard(response),
    host,
    overlay: new Container(),
    reducedMotion: false,
    textures: new MonsterSheetTextures(blankSheet),
    blastStyle,
  });
  return { session, layer, host };
};

/** One frame of `ticks` battle ticks; the events it produced. */
const frame = (
  session: AttackSession,
  layer: AttackBattleLayer,
  ticks = 1,
): readonly BattleVisualEvent[] => {
  const before = session.battle()?.tick ?? 0;
  session.advance(ticks / TICKS_PER_SECOND);
  layer.update();
  return session.battle()?.recentEvents(before) ?? [];
};

/** Runs the battle until the first Eye-ra goes off; that frame's events. */
const untilBlast = (session: AttackSession, layer: AttackBattleLayer) => {
  for (let step = 0; step < TICKS_PER_SECOND * 40; step += 1) {
    const events = frame(session, layer);
    if (events.some((event) => event.kind === "splash" && event.moveId === "C5")) return events;
  }
  throw new Error("no Eye-ra blast");
};

describe("an Eye-ra's blast, drawn in the style picked (feat/eyera-explosion)", () => {
  for (const blastStyle of ["punchy", "fiery", "goo"] as const) {
    it(`${blastStyle}: draws its own blast, not the yellow rings`, () => {
      const { session, layer } = setUp([{ id: 1, t: 14, l: 1, X: 0, Y: 0 }], { C5: 2 }, blastStyle);
      session.appendFling({ x: -150, y: -150, monsters: { C5: 1 } });
      untilBlast(session, layer);
      expect(layer.eyeraBlast.blastsMade).toBe(1);
      expect(layer.eyeraBlast.bitCount).toBeGreaterThan(0);
    });
  }

  it("ring: keeps today's rings and draws nothing more", () => {
    const { session, layer } = setUp([{ id: 1, t: 14, l: 1, X: 0, Y: 0 }], { C5: 2 }, "ring");
    session.appendFling({ x: -150, y: -150, monsters: { C5: 1 } });
    untilBlast(session, layer);
    expect(layer.eyeraBlast.blastsMade).toBe(0);
  });

  it("changes nothing in the battle: the same health in every style", () => {
    const healthAfter = (blastStyle: "ring" | "punchy" | "fiery" | "goo") => {
      const { session, layer } = setUp([{ id: 1, t: 14, l: 1, X: 0, Y: 0 }], { C5: 2 }, blastStyle);
      session.appendFling({ x: -150, y: -150, monsters: { C5: 2 } });
      untilBlast(session, layer);
      for (let step = 0; step < TICKS_PER_SECOND * 3; step += 1) frame(session, layer);
      return session.battle()?.state().health;
    };
    const ring = healthAfter("ring");
    expect(ring?.["1"]).toBeLessThan(Infinity);
    for (const style of ["punchy", "fiery", "goo"] as const) expect(healthAfter(style)).toEqual(ring);
  });
});
