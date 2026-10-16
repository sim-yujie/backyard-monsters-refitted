import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Container, Texture, TextureSource } from "pixi.js";
import type { BaseLoadResponse } from "@/api/types";
import { watchEvents, watchTarget } from "@/game/autoAttack/watchRun";
import { TICKS_PER_SECOND, type AttackEvent } from "@/game/combat/rules";
import { fixtureRun, type DefenceReplayFixture } from "@/game/defences/defenceFixture";
import { CLIENT_RULES_VERSION } from "@/game/defences/defenceWatch";
import { readYard } from "@/game/yard/yardModel";
import { AttackBattleLayer, MonsterSheetTextures, type BattleYardHost } from "./AttackBattleLayer";
import { AttackSession, type AttackSpeed } from "./AttackSession";
import type { AttackTarget } from "./attackTarget";
import { MONSTER_SPRITES } from "./monsterSpriteData";
import { sheetUrl } from "./monsterSprites";
import { WALK_OFF_PAUSE_TICKS, WALK_OFF_TICKS } from "./walkOff";

/**
 * The battle layer on a playback (issue #362, `docs/design/defence-replays.md`
 * §7). Skip to end draws nothing while the rest of the battle runs, then
 * shows the yard as the battle left it: settled at once, nobody left on the
 * field, no walk-off and no wait for the result. A playback watched to its
 * end walks its army off and holds the result at 1x and 4x, as a live attack
 * does (`AttackBattleLayer.walkoff.test.ts`).
 */

const FIXTURE = fileURLToPath(new URL("../../../test/fixtures/defence-replay-mixed-waves.json", import.meta.url));
const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as DefenceReplayFixture;

/** A whole battle played through takes a second or so alone, several with the full suite running alongside. */
const BATTLE_TIMEOUT_MS = 30_000;

const blankSheet = (url: string): Promise<Texture> => {
  const sheet = Object.values(MONSTER_SPRITES).find((candidate) => url === sheetUrl(candidate));
  if (!sheet) throw new Error(`no sheet at ${url}`);
  return Promise.resolve(new Texture({ source: new TextureSource({ width: sheet.width, height: sheet.height }) }));
};

interface Host extends BattleYardHost {
  readonly depth: Container;
}

const hostOf = (): Host => {
  const depth = new Container();
  depth.sortableChildren = true;
  return {
    depth,
    depthSortedLayer: () => depth,
    centreOf: () => ({ x: 400, y: 400 }),
    setBuildingDamage: () => {},
    setConcealed: () => {},
    setAnimFrame: () => {},
  };
};

const layerOf = (session: AttackSession, load: BaseLoadResponse) => {
  const host = hostOf();
  const clock = { ms: 0 };
  const layer = new AttackBattleLayer({
    session,
    yard: readYard(load),
    host,
    overlay: new Container(),
    reducedMotion: false,
    textures: new MonsterSheetTextures(blankSheet),
    now: () => clock.ms,
  });
  return { layer, host, clock };
};

/** One frame of 1/60 s, with the wall clock moving along. */
const frame = (session: AttackSession, layer: AttackBattleLayer, clock: { ms: number }): void => {
  session.advance(1 / 60);
  clock.ms += 1000 / 60;
  layer.update();
};

const bodies = (host: Host) =>
  host.depth.children.filter((child) => child.visible).map((child) => ({ x: child.x, y: child.y, alpha: child.alpha }));

describe("Skip to end on the battle layer", { timeout: BATTLE_TIMEOUT_MS }, () => {
  const defenceSession = (now?: () => number): { session: AttackSession; load: BaseLoadResponse } => {
    const run = fixtureRun(fixture, { rulesVersion: CLIENT_RULES_VERSION });
    const target = watchTarget(run);
    const session = new AttackSession({
      target,
      seed: run.replay.seed,
      declareWar: run.replay.declareWar,
      ...(now ? { now } : {}),
    });
    session.playScript(watchEvents(run), run.replay.tick);
    session.start();
    return { session, load: target.load! };
  };

  it("draws nothing while it skips, then the yard at rest, with nobody walking off", () => {
    let wall = 0;
    // Every look at the clock is 7 ms on, so the skip takes many frames.
    const { session, load } = defenceSession(() => (wall += 7));
    const { layer, host, clock } = layerOf(session, load);
    // Some of it watched first: the attack is on the field.
    for (let step = 0; step < 20 * 60; step += 1) frame(session, layer, clock);
    expect(layer.creepCount).toBeGreaterThan(0);
    const drawn = bodies(host);
    const drawnCount = layer.creepCount;

    session.skipToEnd();
    let skippingFrames = 0;
    while (session.skipping && skippingFrames < 10_000) {
      frame(session, layer, clock);
      skippingFrames += 1;
      if (!session.skipping) break;
      // The picture stays where it was: no creep moves, comes or goes.
      expect(layer.creepCount).toBe(drawnCount);
      expect(bodies(host)).toEqual(drawn);
      expect(layer.isSettled).toBe(false);
    }
    expect(skippingFrames).toBeGreaterThan(10);
    expect(session.ended).toBe(true);
    expect(session.skipped).toBe(true);
    // Asked before the next frame, nothing holds the result.
    expect(layer.settling).toBe(false);

    layer.update();
    expect(layer.isSettled).toBe(true);
    expect(layer.creepCount).toBe(0);
    expect(layer.walkingOffCount).toBe(0);
    expect(layer.settling).toBe(false);
    expect(bodies(host)).toHaveLength(0);
    const state = session.battle()!.state();
    expect(layer.shownDamage()).toBe(session.damageFor(state.health, state.firedTraps));
    expect(layer.shownDamage()).toBe(session.state().damagePercent);

    // Later frames draw nothing back.
    clock.ms += 10_000;
    layer.update();
    expect(layer.creepCount).toBe(0);
    expect(layer.settling).toBe(false);
    layer.destroy();
  });

  it("skipped before a frame was drawn, shows only the end", () => {
    const { session, load } = defenceSession();
    const { layer, host, clock } = layerOf(session, load);
    session.skipToEnd();
    for (let step = 0; step < 10_000 && !session.ended; step += 1) frame(session, layer, clock);
    expect(session.skipped).toBe(true);
    layer.update();
    expect(layer.isSettled).toBe(true);
    expect(layer.creepCount).toBe(0);
    expect(bodies(host)).toHaveLength(0);
    expect(layer.settling).toBe(false);
    layer.destroy();
  });
});

describe("a playback watched to its end", { timeout: BATTLE_TIMEOUT_MS }, () => {
  type BuildingRow = { id: number; t: number; l: number; X: number; Y: number };
  /** A lone Twig Snapper: something a Pokey can knock down. */
  const SNAPPER: BuildingRow = { id: 1, t: 1, l: 1, X: 0, Y: 0 };
  const yard = (): BaseLoadResponse =>
    ({
      error: 0,
      id: 1,
      baseid: "3502",
      basesaveid: 1,
      worldsize: [800, 800],
      currenttime: 1_700_000_000,
      buildingdata: { "1": SNAPPER },
      buildinghealthdata: {},
      resources: { r1: 1000, r2: 0, r3: 0, r4: 0 },
      attackid: 77,
      storedata: {},
    }) as unknown as BaseLoadResponse;
  const target = (): AttackTarget => ({
    baseid: "3502",
    kind: "wild",
    cell: { col: 241, row: 208 },
    name: "Kozu",
    roster: {
      monsters: { C1: 30 },
      levels: {},
      champions: [],
      flingerLevel: 4,
      catapultLevel: 0,
      sources: [],
      siege: null,
      resources: null,
    },
  });

  /** A live attack whose last target falls with its army standing: its log and end tick. */
  const recorded = (): { events: readonly AttackEvent[]; tick: number } => {
    const live = new AttackSession({ target: target(), seed: 1 });
    live.load(yard());
    live.start();
    live.appendFling({ x: -150, y: -150, monsters: { C1: 30 } });
    for (let step = 0; step < 120 * TICKS_PER_SECOND && !live.ended; step += 1) live.advance(1 / TICKS_PER_SECOND);
    expect(live.endedBy).toBe("destroyed");
    return { events: live.flingLog().events, tick: live.state().tick };
  };

  const playback = (): AttackSession => {
    const { events, tick } = recorded();
    const session = new AttackSession({ target: target(), seed: 1 });
    session.load(yard());
    session.playScript(events, tick);
    session.start();
    return session;
  };

  const walkOffMs = (speed: number): number => ((WALK_OFF_TICKS + WALK_OFF_PAUSE_TICKS) / TICKS_PER_SECOND / speed) * 1000;

  for (const speed of [1, 4] as const satisfies readonly AttackSpeed[]) {
    it(`walks its army off and holds the result at ${speed}x`, () => {
      const session = playback();
      session.setSpeed(speed);
      expect(session.speed).toBe(speed);
      const { layer, clock } = layerOf(session, yard());
      for (let step = 0; step < 120 * 60 && !session.ended; step += 1) {
        session.advance(1 / 60);
        clock.ms += 1000 / 60;
        if (!session.ended) layer.update();
      }
      expect(session.endedBy).toBe("destroyed");
      expect(session.skipped).toBe(false);
      const endedAt = clock.ms;
      expect(layer.settling).toBe(true);
      layer.update();
      expect(layer.walkingOffCount).toBeGreaterThan(0);
      clock.ms = endedAt + walkOffMs(speed) - 100;
      layer.update();
      expect(layer.settling).toBe(true);
      clock.ms = endedAt + walkOffMs(speed) + 50;
      layer.update();
      expect(layer.settling).toBe(false);
      expect(layer.creepCount).toBe(0);
      layer.destroy();
    });
  }

  it("skipped instead, walks nobody off and holds nothing", () => {
    const session = playback();
    const { layer, clock } = layerOf(session, yard());
    frame(session, layer, clock);
    session.skipToEnd();
    for (let step = 0; step < 10_000 && !session.ended; step += 1) frame(session, layer, clock);
    expect(session.endedBy).toBe("destroyed");
    expect(layer.settling).toBe(false);
    layer.update();
    expect(layer.walkingOffCount).toBe(0);
    expect(layer.creepCount).toBe(0);
    layer.destroy();
  });
});
