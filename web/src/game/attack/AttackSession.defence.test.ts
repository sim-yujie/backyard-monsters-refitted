import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { watchEvents, watchTarget } from "@/game/autoAttack/watchRun";
import { VISUAL_MEMORY_TICKS } from "@/game/combat/rules/engine";
import { fixtureRun, type DefenceReplayFixture } from "@/game/defences/defenceFixture";
import {
  CLIENT_RULES_VERSION,
  defenceDrift,
  defenceReadout,
  lootTakenOf,
  storedDamageOf,
  type DefenceWatch,
} from "@/game/defences/defenceWatch";
import { AttackSession, SKIP_SLICE_TICKS, type AttackSpeed } from "./AttackSession";

/**
 * Defence replays on the session (issue #362, `docs/design/defence-replays.md`
 * §7): a stored defence played back with `playScript` reaches the result the
 * server stored, at 1x, 4x or skipped to its end, and 4x and Skip to end
 * belong to a playback alone. Like `AttackSession.playback.test.ts`, the
 * session runs here with nothing but the engine: no server, no network.
 */

const FIXTURE = fileURLToPath(new URL("../../../test/fixtures/defence-replay-mixed-waves.json", import.meta.url));
const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as DefenceReplayFixture;

/** A whole battle played through takes a second or so alone, several with the full suite running alongside. */
const BATTLE_TIMEOUT_MS = 30_000;

const sessionFor = (run: DefenceWatch, now?: () => number): AttackSession => {
  const session = new AttackSession({
    target: watchTarget(run),
    seed: run.replay.seed,
    declareWar: run.replay.declareWar,
    ...(now ? { now } : {}),
  });
  session.playScript(watchEvents(run), run.replay.tick);
  session.start();
  return session;
};

/** Frames of `seconds` each until the session ends; how many it took. */
const playThrough = (session: AttackSession, speed: AttackSpeed = 1, seconds = 1 / 60): number => {
  session.setSpeed(speed);
  let frames = 0;
  while (!session.ended && frames < 200_000) {
    session.advance(seconds);
    frames += 1;
  }
  return frames;
};

/** The building health the server stored against the engine's, whole hit points. */
const expectServerHealth = (session: AttackSession, server: DefenceReplayFixture["server"]): void => {
  const health = session.battle()!.state().health;
  for (const [id, hp] of Object.entries(server.buildinghealthdata)) {
    expect(Math.abs(Math.max(0, health[id] ?? 0) - hp), `building ${id}`).toBeLessThanOrEqual(1);
  }
};

/** What two sessions must agree on to have played the same battle. */
const finalState = (session: AttackSession) => {
  const { phase, endReason, tick, damagePercent, loot, creepsFlung, creepsKilled, buildingsDestroyed } = session.state();
  return {
    phase,
    endReason,
    tick,
    damagePercent,
    loot,
    creepsFlung,
    creepsKilled,
    buildingsDestroyed,
    health: session.battle()!.state().health,
    champions: session.championsHpAfter(),
    events: session.flingLog().events,
  };
};

describe("a stored defence played back", { timeout: BATTLE_TIMEOUT_MS }, () => {
  it("reaches the stored damage and the server's building health, where the server stopped", () => {
    const session = sessionFor(fixtureRun(fixture, { rulesVersion: CLIENT_RULES_VERSION }));
    playThrough(session);
    const state = session.state();
    expect(state.phase).toBe("ended");
    expect(state.tick).toBe(fixture.server.tick);
    expect(storedDamageOf(state.damagePercent)).toBe(fixture.defence.damageAfter);
    expectServerHealth(session, fixture.server);
  });

  it("reaches the stored damage of an attack the finaliser landed from its checkpoint", () => {
    const session = sessionFor(fixtureRun(fixture, { left: true }));
    playThrough(session);
    const state = session.state();
    expect(state.tick).toBe(fixture.left.tick);
    expect(storedDamageOf(state.damagePercent)).toBe(fixture.left.defence.damageAfter);
    expectServerHealth(session, fixture.left.server);
  });

  it("loses the defender exactly the stored loot; the attacker's gain is more, with the low-level bonus on it", () => {
    for (const run of [fixtureRun(fixture), fixtureRun(fixture, { left: true })]) {
      const session = sessionFor(run);
      playThrough(session);
      const state = session.state();
      for (const key of ["r1", "r2", "r3", "r4"] as const) {
        expect(Math.floor(state.defenderLoss[key]), key).toBe(run.defence.loot[key]);
        // The top strip used to show this one: 30,597,545 Twigs against the stored 24,752,019.
        expect(state.loot[key], key).toBeGreaterThan(state.defenderLoss[key]);
      }
      expect(defenceDrift(run, state.damagePercent, state.tick, state.defenderLoss)).toBeNull();
      // The strip reads it as the defender's pool lost it: at most 10,000,000 a resource.
      expect(defenceReadout(run.defence, state.damagePercent, state.defenderLoss, false)).toEqual({
        damage: run.defence.damageDone,
        loot: lootTakenOf(run.defence.loot),
      });
    }
  });

  it("never runs past the tick the server stopped at, however long a frame is", () => {
    const session = sessionFor(fixtureRun(fixture, { left: true }));
    session.advance(1_000);
    expect(session.ended).toBe(true);
    expect(session.state().tick).toBe(fixture.left.tick);
  });
});

describe("4x", { timeout: BATTLE_TIMEOUT_MS }, () => {
  it("is offered on a playback only: an attack the player fights keeps 1x and 2x", () => {
    const live = new AttackSession({ target: watchTarget(fixtureRun(fixture)), seed: 1 });
    expect(live.speeds).toEqual([1, 2]);
    live.setSpeed(4);
    expect(live.speed).toBe(1);
    live.setSpeed(2);
    expect(live.speed).toBe(2);

    const playback = sessionFor(fixtureRun(fixture));
    expect(playback.speeds).toEqual([1, 2, 4]);
    playback.setSpeed(4);
    expect(playback.speed).toBe(4);
  });

  it("keeps up frame by frame: a slow frame is a few ticks, well inside what the battle layer reads back", () => {
    const session = sessionFor(fixtureRun(fixture));
    session.setSpeed(4);
    // Pixi caps a frame at 100 ms (its ticker's minFPS of 10).
    session.advance(0.1);
    const step = session.state().tick;
    expect(step).toBe(32);
    expect(step).toBeLessThan(VISUAL_MEMORY_TICKS);
  });

  it("plays the same battle as 1x, four times as fast", () => {
    const one = sessionFor(fixtureRun(fixture));
    const framesAtOne = playThrough(one, 1);
    const four = sessionFor(fixtureRun(fixture));
    const framesAtFour = playThrough(four, 4);
    expect(finalState(four)).toEqual(finalState(one));
    expect(framesAtFour).toBeLessThanOrEqual(Math.ceil(framesAtOne / 4) + 1);
  });
});

describe("Skip to end", { timeout: BATTLE_TIMEOUT_MS }, () => {
  it("reaches the same final state as playing it through", () => {
    const played = sessionFor(fixtureRun(fixture));
    playThrough(played);

    const skipped = sessionFor(fixtureRun(fixture));
    // Some of it watched first, then skipped.
    for (let frame = 0; frame < 600; frame += 1) skipped.advance(1 / 60);
    skipped.skipToEnd();
    expect(skipped.skipping).toBe(true);
    playThrough(skipped);

    expect(skipped.skipping).toBe(false);
    expect(skipped.skipped).toBe(true);
    expect(finalState(skipped)).toEqual(finalState(played));
    expect(storedDamageOf(skipped.state().damagePercent)).toBe(fixture.defence.damageAfter);
  });

  it("runs in slices, a frame's budget at a time, so the page never freezes", () => {
    let clock = 0;
    // Every look at the clock is 7 ms on: two slices fit a 12 ms frame.
    const session = sessionFor(fixtureRun(fixture), () => (clock += 7));
    session.skipToEnd();
    session.advance(1 / 60);
    expect(session.ended).toBe(false);
    expect(session.state().tick).toBe(2 * SKIP_SLICE_TICKS);
    const frames = playThrough(session);
    expect(session.state().tick).toBe(fixture.server.tick);
    expect(frames).toBeGreaterThan(100);
  });

  it("ignores the frame's own length and speed while it skips", () => {
    const session = sessionFor(fixtureRun(fixture), () => 0);
    session.setSpeed(4);
    session.skipToEnd();
    session.advance(0);
    expect(session.ended).toBe(true);
    expect(session.state().tick).toBe(fixture.server.tick);
  });

  it("does nothing on an attack the player fights, or one already over", () => {
    const live = new AttackSession({ target: watchTarget(fixtureRun(fixture)), seed: 1 });
    live.start();
    live.skipToEnd();
    expect(live.skipping).toBe(false);

    const over = sessionFor(fixtureRun(fixture, { left: true }));
    playThrough(over);
    over.skipToEnd();
    expect(over.skipping).toBe(false);
    expect(over.skipped).toBe(false);
  });

  it("ends as left, not skipped, when the screen is left while it skips", () => {
    const session = sessionFor(fixtureRun(fixture));
    session.skipToEnd();
    session.leave();
    expect(session.endedBy).toBe("left");
    expect(session.skipping).toBe(false);
  });
});
