import { describe, expect, it } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import { buildEngineYard, createBattle, type RaidEvent } from "@/game/combat/rules";
import { AttackSession } from "./AttackSession";
import type { AttackTarget } from "./attackTarget";

/**
 * A wild monster raid played back (issue #226 WP4): the session fights the
 * raid as the server's `raidFight.ts` did (a main yard, the seed, the waves
 * at their ticks, no hit limit), keeps the waves out of the fling log, and
 * runs on to where the server's fight ended.
 */

/** Two Cannon Towers and a Town Hall on the player's own yard. */
const yard = (): BaseLoadResponse =>
  ({
    error: 0,
    id: 1,
    baseid: "1000241208",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: 1_700_000_000,
    buildingdata: {
      "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 20, l: 1, X: 200, Y: 200 },
      "3": { id: 3, t: 14, l: 1, X: -200, Y: 100 },
    },
    buildinghealthdata: {},
    resources: { r1: 100_000, r2: 100_000, r3: 0, r4: 0 },
  }) as unknown as BaseLoadResponse;

const SEED = 22601;

const WAVES: RaidEvent[] = [
  { kind: "raid", t: 0, x: 900, y: -700, r: 80, monsters: { C2: 12 } },
  { kind: "raid", t: 0, x: 925, y: -725, r: 60, monsters: { C4: 6 } },
];

const target = (): AttackTarget => ({
  baseid: "1000241208",
  kind: "main",
  name: "Kozu raid",
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

/** The server's way (`raidFight.ts`): apply the waves at their ticks, run to the end. */
const serverBattle = (end: number) => {
  const load = yard();
  const battle = createBattle(
    buildEngineYard({
      buildingdata: load.buildingdata ?? {},
      buildinghealthdata: null,
      resources: load.resources ?? null,
      kind: "main",
      height: 0,
    }),
    { seed: SEED, raid: true },
  );
  for (const event of WAVES) {
    battle.runTo(event.t);
    battle.apply(event);
  }
  battle.runTo(end);
  return battle.state();
};

const watch = (session: AttackSession, seconds = 900): void => {
  const frames = Math.ceil(seconds * 60);
  for (let frame = 0; frame < frames && session.state().phase !== "ended"; frame += 1) session.advance(1 / 60);
};

describe("AttackSession raid playback", () => {
  it("fights the server's raid: the same health and loot at the same tick", () => {
    const session = new AttackSession({ target: target(), seed: SEED, raid: true });
    expect(session.raiding).toBe(true);
    session.playScript(WAVES, 60_000);
    session.start();
    watch(session);

    const state = session.state();
    expect(state.phase).toBe("ended");
    const server = serverBattle(state.tick);
    const battle = session.battle()!.state();
    expect(battle.health).toEqual(server.health);
    expect(battle.loot).toEqual(server.loot);
    expect(battle.creepsKilled).toBe(server.creepsKilled);
  });

  it("keeps the waves out of the fling log but counts the raiders", () => {
    const session = new AttackSession({ target: target(), seed: SEED, raid: true });
    session.playScript(WAVES, 400);
    session.start();
    watch(session, 1);
    expect(session.flingLog().events).toEqual([]);
    expect(session.state().creepsFlung).toBe(18);
  });

  it("runs on to the server's end tick when the raiders are still about", () => {
    const session = new AttackSession({ target: target(), seed: SEED, raid: true });
    session.playScript(WAVES, 400);
    session.start();
    watch(session, 3);
    expect(session.state().phase).toBe("running");
    watch(session);
    expect(session.state().phase).toBe("ended");
    expect(session.state().tick).toBeGreaterThanOrEqual(400);
    expect(session.state().tick).toBeLessThan(400 + 10);
  });
});
