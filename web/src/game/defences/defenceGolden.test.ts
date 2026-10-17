import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AttackSession } from "@/game/attack/AttackSession";
import { watchEvents, watchTarget } from "@/game/autoAttack/watchRun";
import { fixtureRun, type DefenceReplayFixture } from "./defenceFixture";
import { CLIENT_RULES_VERSION, defenceDrift, defenceWatchRefusal, storedDamageOf, type DefenceWatch } from "./defenceWatch";

/**
 * The golden defence replay's version guard on the web engine (issue #364,
 * `docs/design/defence-replays.md` §4 and §10).
 *
 * The fixture holds a stored replay, the result stored with it and the
 * `rulesVersion` it was stamped with. While the bundle's rules version is
 * still that stamp, Watch is offered for it, so the engine must play it to the
 * stored result. A change that moves the result without moving the version
 * (code outside the rules folder: the load-to-battle conversion, playback) is
 * a missed `REPLAY_FORMAT` bump, and players would watch a battle that never
 * happened. `server/src/services/defences/defenceGolden.test.ts` guards the
 * server's replay with the same file and re-records it.
 */

const FIXTURE = fileURLToPath(new URL("../../../test/fixtures/defence-replay-mixed-waves.json", import.meta.url));
const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as DefenceReplayFixture;

/** A whole battle played through takes a second or so alone, several with the full suite running alongside. */
const BATTLE_TIMEOUT_MS = 30_000;

const RECORD_HINT =
  "re-record it on purpose: cd server && RECORD_DEFENCE_GOLDEN=1 bun test src/services/defences/defenceGolden.test.ts";

const MISSED_BUMP =
  "the stored defence replay no longer plays to its stored result, but the rules version did not change: " +
  "bump REPLAY_FORMAT in src/game/combat/rules/replay.ts and run `node tools/sync-combat-rules.mjs`";

/** The run as the viewer gets it, played through at 1x: what it ended on. */
const played = (run: DefenceWatch) => {
  const session = new AttackSession({ target: watchTarget(run), seed: run.replay.seed, declareWar: run.replay.declareWar });
  session.playScript(watchEvents(run), run.replay.tick);
  session.start();
  for (let frames = 0; !session.ended && frames < 200_000; frames += 1) session.advance(1 / 60);
  return { state: session.state(), health: session.battle()!.state().health };
};

const expectStoredResult = (run: DefenceWatch, server: DefenceReplayFixture["server"]): void => {
  // Stamped with the bundle's version, so the viewer offers it.
  expect(defenceWatchRefusal(run)).toBeNull();
  const { state, health } = played(run);
  expect(state.tick, MISSED_BUMP).toBe(server.tick);
  expect(storedDamageOf(state.damagePercent), MISSED_BUMP).toBe(run.defence.damageAfter);
  for (const key of ["r1", "r2", "r3", "r4"] as const) {
    expect(Math.floor(state.defenderLoss[key]), `${MISSED_BUMP} (loot ${key})`).toBe(run.defence.loot[key]);
  }
  for (const [id, hp] of Object.entries(server.buildinghealthdata)) {
    expect(Math.abs(Math.max(0, health[id] ?? 0) - hp), `${MISSED_BUMP} (building ${id})`).toBeLessThanOrEqual(1);
  }
  expect(defenceDrift(run, state.damagePercent, state.tick, state.defenderLoss), MISSED_BUMP).toBeNull();
};

describe("the golden defence replay (issue #364)", { timeout: BATTLE_TIMEOUT_MS }, () => {
  it("is stamped with the bundle's rules version", () => {
    expect(fixture.defence.rulesVersion, `the rules version changed; ${RECORD_HINT}`).toBe(CLIENT_RULES_VERSION);
    expect(fixture.left.defence.rulesVersion, `the rules version changed; ${RECORD_HINT}`).toBe(CLIENT_RULES_VERSION);
  });

  it.runIf(fixture.defence.rulesVersion === CLIENT_RULES_VERSION)("plays to its stored result under that version", () => {
    expectStoredResult(fixtureRun(fixture), fixture.server);
  });

  it.runIf(fixture.left.defence.rulesVersion === CLIENT_RULES_VERSION)(
    "and so does the attack the finaliser landed from a checkpoint",
    () => {
      expectStoredResult(fixtureRun(fixture, { left: true }), fixture.left.server);
    },
  );

  it("is not offered once the bundle's version moves on", () => {
    expect(defenceWatchRefusal(fixtureRun(fixture, { rulesVersion: "0000000000000000" }))).not.toBeNull();
  });
});
