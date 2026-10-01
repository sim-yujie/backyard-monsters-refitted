import { describe, expect, it } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import { buildEngineYard, createBattle, type FlingEvent } from "@/game/combat/rules";
import { AttackSession } from "./AttackSession";
import type { AttackTarget } from "./attackTarget";

/**
 * Playback (issue #221, Watch on an auto-attack): the session applies a log
 * the server already fought, each event at its own tick, and so shows the
 * same battle the server's replay ran (`abandonedAttack.ts`: run to the event,
 * apply it, run to the end).
 */

/** Two Cannon Towers and a Town Hall: enough for creeps to fight and fall. */
const camp = (): BaseLoadResponse =>
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

const SEED = 4242;
const LEVELS = { C1: 3 };

const EVENTS: FlingEvent[] = [
  { kind: "fling", t: 80, x: -400, y: 100, r: 100, monsters: { C1: 20 } },
  { kind: "fling", t: 900, x: 400, y: 300, r: 100, monsters: { C1: 15 } },
];

const target = (): AttackTarget => ({
  baseid: "1000241208",
  kind: "wild",
  name: "Kozu",
  load: camp(),
  roster: {
    monsters: { C1: 35 },
    levels: LEVELS,
    champions: [],
    flingerLevel: 0,
    catapultLevel: 0,
    sources: [],
    siege: null,
    resources: null,
  },
});

/** The server's way: run to each event, apply it, run to the end. */
const serverBattle = (events: readonly FlingEvent[], end: number) => {
  const load = camp();
  const battle = createBattle(
    buildEngineYard({
      buildingdata: load.buildingdata ?? {},
      buildinghealthdata: null,
      resources: load.resources ?? null,
      kind: "wild",
      height: 0,
    }),
    { seed: SEED, levels: LEVELS, declareWar: false },
  );
  for (const event of events) {
    battle.runTo(event.t);
    battle.apply(event);
  }
  battle.runTo(end);
  return battle.state();
};

/** Plays the session frame by frame until it ends, or for `seconds`. */
const watch = (session: AttackSession, seconds = 600): void => {
  const frames = Math.ceil(seconds * 60);
  for (let frame = 0; frame < frames && session.state().phase !== "ended"; frame += 1) session.advance(1 / 60);
};

describe("AttackSession playback", () => {
  it("fights the server's battle: the same health, loot and losses at the same tick", () => {
    const session = new AttackSession({ target: target(), seed: SEED, declareWar: false });
    session.playScript(EVENTS, 4_000);
    session.start();
    watch(session);

    const state = session.state();
    expect(state.phase).toBe("ended");
    expect(session.playback).toBe(true);
    const server = serverBattle(EVENTS, state.tick);
    const battle = session.battle()!.state();
    expect(battle.health).toEqual(server.health);
    expect(battle.loot).toEqual(server.loot);
    expect(battle.creepsKilled).toBe(server.creepsKilled);
    expect(session.flingLog().events).toEqual(EVENTS);
    expect(state.creepsFlung).toBe(35);
  });

  it("does not end between drops while the script still has some to play", () => {
    // The first drop's creeps are long dead by the second one at 60 s.
    const late: FlingEvent[] = [
      { kind: "fling", t: 80, x: -400, y: 100, r: 100, monsters: { C1: 1 } },
      { kind: "fling", t: 4_800, x: 400, y: 300, r: 100, monsters: { C1: 1 } },
    ];
    const session = new AttackSession({ target: target(), seed: SEED, declareWar: false });
    session.playScript(late, 6_000);
    session.start();
    watch(session, 59);
    expect(session.state().phase).toBe("running");
    watch(session);
    expect(session.state().creepsFlung).toBe(2);
  });

  it("ends on a retreat where the attack retreated", () => {
    const session = new AttackSession({ target: target(), seed: SEED, declareWar: false });
    session.playScript([...EVENTS, { kind: "retreat", t: 1_200 }], 8_000);
    session.start();
    watch(session);
    expect(session.state().endReason).toBe("retreat");
    expect(session.state().tick).toBe(1_200);
  });

  it("stops where the server stopped the battle", () => {
    const session = new AttackSession({ target: target(), seed: SEED, declareWar: false });
    session.playScript([{ kind: "fling", t: 80, x: -400, y: 100, r: 100, monsters: { C1: 35 } }], 400);
    session.start();
    watch(session);
    expect(session.state().phase).toBe("ended");
    expect(session.state().tick).toBeGreaterThanOrEqual(400);
    expect(session.state().tick).toBeLessThan(400 + 10);
  });
});
