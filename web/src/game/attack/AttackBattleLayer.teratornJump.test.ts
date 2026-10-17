import { describe, expect, it } from "vitest";
import { Container, Texture, TextureSource } from "pixi.js";
import type { BaseLoadResponse } from "@/api/types";
import { TICKS_PER_SECOND, type BattleVisualEvent } from "@/game/combat/rules";
import type { Point } from "@/game/yard/YardGrid";
import { readYard } from "@/game/yard/yardModel";
import {
  AttackBattleLayer,
  MonsterSheetTextures,
  type BattleYardHost,
} from "./AttackBattleLayer";
import { AttackSession } from "./AttackSession";
import type { AttackTarget } from "./attackTarget";
import { PROJECTILE_TICKS, jumpTicks } from "./creepFx";
import { MONSTER_SPRITES } from "./monsterSpriteData";
import { sheetUrl } from "./monsterSprites";

/**
 * A ranked Teratorn's fireball jumping on from building to building (#352) is
 * drawn as Flash drew it: the fireball itself flies on from each building it
 * hits to the next, once per jump, with no rings. Drawing only: the battle
 * comes out the same as one nobody draws.
 */

type BuildingRow = { id: number; t: number; l: number; X: number; Y: number };

/** A row of buildings 60 apart, so a rank-3 fireball has three to jump to. */
const ROW: BuildingRow[] = [0, 60, 120, 180].map((X, index) => ({
  id: index + 1,
  t: 1,
  l: 5,
  X,
  Y: 0,
}));

const FLING = { x: -100, y: 0, monsters: { C14: 1 } };

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

const targetOf = (): AttackTarget => ({
  baseid: "3502",
  kind: "wild",
  cell: { col: 241, row: 208 },
  name: "Kozu",
  roster: {
    monsters: { C14: 1 },
    levels: {},
    ranks: { C14: 3 },
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

/** Each building's drawn middle: far enough apart to tell one jump from another. */
const centreOf = (id: number): Point => ({ x: 300 + id * 70, y: 200 + id * 9 });

const hostOf = (): BattleYardHost & { readonly damage: Map<number, number> } => {
  const depth = new Container();
  depth.sortableChildren = true;
  const damage = new Map<number, number>();
  return {
    damage,
    depthSortedLayer: () => depth,
    centreOf,
    setBuildingDamage: (id, fraction) => damage.set(id, fraction),
    setConcealed: () => {},
    setAnimFrame: () => {},
  };
};

const setUp = () => {
  const session = new AttackSession({ target: targetOf(), seed: 1 });
  const response = yardOf(ROW);
  session.load(response);
  const host = hostOf();
  const layer = new AttackBattleLayer({
    session,
    yard: readYard(response),
    host,
    overlay: new Container(),
    reducedMotion: false,
    textures: new MonsterSheetTextures(blankSheet),
  });
  return { session, layer, host };
};

/** One frame of one battle tick; the events it produced. */
const frame = (session: AttackSession, layer: AttackBattleLayer): readonly BattleVisualEvent[] => {
  const before = session.battle()?.tick ?? 0;
  session.advance(1 / TICKS_PER_SECOND);
  layer.update();
  return session.battle()?.recentEvents(before) ?? [];
};

type Bounce = Extract<BattleVisualEvent, { kind: "bounce" }>;

/** Runs the battle until the Teratorn's first fireball jumps on; that swing's jumps. */
const untilJumps = (session: AttackSession, layer: AttackBattleLayer): Bounce[] => {
  for (let step = 0; step < TICKS_PER_SECOND * 40; step += 1) {
    const jumps = frame(session, layer).filter(
      (event): event is Bounce => event.kind === "bounce",
    );
    if (jumps.length > 0) return jumps;
  }
  throw new Error("no fireball jump");
};

describe("a ranked Teratorn's fireball jumping on, drawn as Flash drew it (#352)", () => {
  it("flies the fireball on from building to building once per jump, with no rings", () => {
    const { session, layer } = setUp();
    session.appendFling(FLING);
    const jumps = untilJumps(session, layer);
    expect(jumps).toHaveLength(3);
    expect(layer.ringCount).toBe(0);

    const swingTick = jumps[0]?.tick ?? -1;
    const shots = layer.creepEffects.shots.filter((shot) => shot.tick > swingTick);
    expect(shots).toHaveLength(3);
    // Each jump leaves from the building the shot before it hit, when that shot lands.
    let leaves = swingTick + PROJECTILE_TICKS;
    jumps.forEach((jump, index) => {
      const shot = shots[index];
      const from = centreOf(jump.fromBuildingId);
      const to = centreOf(jump.toBuildingId);
      expect(shot?.from).toEqual(from);
      expect(shot?.to).toEqual(to);
      expect(shot?.buildingId).toBe(jump.toBuildingId);
      expect(shot?.amount).toBe(jump.amount);
      expect(shot?.tick).toBe(leaves);
      expect(shot?.flight).toBe(jumpTicks(from, to));
      leaves += jumpTicks(from, to);
    });
  });

  it("shows a jump's damage on its building only when the fireball arrives", () => {
    const { session, layer, host } = setUp();
    session.appendFling(FLING);
    const jumps = untilJumps(session, layer);
    const last = jumps.at(-1);
    if (!last) throw new Error("no jump");
    const shot = layer.creepEffects.shots.find((one) => one.buildingId === last.toBuildingId);
    if (!shot) throw new Error("no shot for the last jump");
    // The engine has already dealt it; the building is drawn whole until the fireball lands.
    expect(session.battle()?.state().health[String(last.toBuildingId)]).toBeDefined();
    // The host is handed the health it draws: 1 is whole.
    expect(host.damage.get(last.toBuildingId) ?? 1).toBe(1);
    while ((session.battle()?.tick ?? 0) < shot.tick + shot.flight - 1) frame(session, layer);
    expect(host.damage.get(last.toBuildingId) ?? 1).toBe(1);
    frame(session, layer);
    expect(host.damage.get(last.toBuildingId) ?? 1).toBeLessThan(1);
  });

  it("changes nothing in the battle: the same health as an undrawn one", () => {
    const drawn = setUp();
    drawn.session.appendFling(FLING);
    untilJumps(drawn.session, drawn.layer);
    for (let step = 0; step < TICKS_PER_SECOND * 3; step += 1) frame(drawn.session, drawn.layer);
    const ticks = drawn.session.battle()?.tick ?? 0;

    const bare = new AttackSession({ target: targetOf(), seed: 1 });
    bare.load(yardOf(ROW));
    bare.appendFling(FLING);
    while ((bare.battle()?.tick ?? 0) < ticks) bare.advance(1 / TICKS_PER_SECOND);

    expect(bare.battle()?.tick).toBe(ticks);
    expect(bare.battle()?.state().health).toEqual(drawn.session.battle()?.state().health);
  });
});
