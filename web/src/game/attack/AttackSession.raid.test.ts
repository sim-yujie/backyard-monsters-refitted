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

  describe("a raid whose waves are spread out (the Trojan Horse, patch 6.4)", () => {
    // One Pokey at a time at the towers, as the horse spews its army: the
    // first is dead long before the last comes out.
    const SPREAD: RaidEvent[] = [
      { kind: "raid", t: 0, x: 100, y: 100, r: 0, monsters: { C1: 1 } },
      { kind: "raid", t: 1400, x: 100, y: 100, r: 0, monsters: { C1: 1 } },
      { kind: "raid", t: 2800, x: 100, y: 100, r: 0, monsters: { C1: 1 } },
    ];
    // The first Pokey falls to the two Cannon Towers at about tick 1190 (15 s).
    const LAST = 2800;
    const END = 8000;

    /** `trojanFight.ts`'s way: the waves at their ticks, held open to the last spawn. */
    const serverSpread = (end: number) => {
      const load = yard();
      const battle = createBattle(
        buildEngineYard({
          buildingdata: load.buildingdata ?? {},
          buildinghealthdata: null,
          resources: load.resources ?? null,
          kind: "main",
          height: 0,
        }),
        { seed: SEED, raid: true, raidSpawnsUntil: LAST },
      );
      for (const event of SPREAD) {
        battle.runTo(event.t);
        battle.apply(event);
      }
      battle.runTo(end);
      return battle.state();
    };

    it("without the last spawn's tick, the fight ended once the first raider died (the bug)", () => {
      const session = new AttackSession({ target: target(), seed: SEED, raid: true });
      session.playScript(SPREAD, END);
      session.start();
      watch(session);
      expect(session.state().phase).toBe("ended");
      expect(session.state().tick).toBeLessThan(1400);
      expect(session.state().creepsFlung).toBe(1);
    });

    it("plays every wave and ends where the server's fight did", () => {
      const server = serverSpread(END);
      expect(server.over).toBe(true);
      expect(server.creepsFlung).toBe(3);

      const session = new AttackSession({ target: target(), seed: SEED, raid: true, raidSpawnsUntil: LAST });
      session.playScript(SPREAD, server.tick);
      session.start();
      watch(session, 16);
      // Between spawns with the field empty, the fight is still on.
      expect(session.battle()!.state().creepsAlive).toBe(0);
      expect(session.state().phase).toBe("running");
      watch(session);

      const state = session.state();
      expect(state.phase).toBe("ended");
      expect(state.creepsFlung).toBe(3);
      expect(state.tick).toBe(server.tick);
      const battle = session.battle()!.state();
      expect(battle.health).toEqual(server.health);
      expect(battle.creepsKilled).toBe(server.creepsKilled);
    });

    it("leaves a raid whose waves all land at once as it was", () => {
      const session = new AttackSession({ target: target(), seed: SEED, raid: true, raidSpawnsUntil: 0 });
      session.playScript(WAVES, 60_000);
      session.start();
      watch(session);
      const state = session.state();
      expect(state.phase).toBe("ended");
      expect(session.battle()!.state().health).toEqual(serverBattle(state.tick).health);
    });
  });
});
