import { describe, expect, mock, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The golden defence replay's version guard (issue #364,
 * `docs/design/defence-replays.md` §4 and §10).
 *
 * `web/test/fixtures/defence-replay-mixed-waves.json` holds a stored replay
 * (the payload), the result stored with it and the `rulesVersion` it was
 * stamped with. While the server's rules version is still that stamp, the
 * server's replay of the payload must land exactly on the stored result. A
 * change that moves the result without moving the version (code outside the
 * rules folder: the load-to-battle conversion, playback) is a missed
 * `REPLAY_FORMAT` bump, and every older replay would show a battle that never
 * happened. `web/src/game/defences/defenceGolden.test.ts` guards the web
 * engine with the same file.
 *
 * When the rules change, the version changes, and the stamp test fails until
 * the fixture is re-recorded on purpose:
 *
 *   cd server && RECORD_DEFENCE_GOLDEN=1 bun test src/services/defences/defenceGolden.test.ts
 */

// The stand-in other server tests use, so importing the recorder opens no
// connection (Bun keeps the module mock for the files that run after this one).
mock.module("../../server.js", () => ({
  postgres: { em: {}, orm: { em: {} } },
  redis: { get: async () => null, setex: async () => "OK", del: async () => 0 },
}));

const { defenceReplayInput } = await import("./recordDefenceReplay.js");
const { replayAbandonedAttack } = await import("../base/combat/abandonedAttack.js");
const { RULES_VERSION } = await import("./rulesVersion.js");

const FIXTURE = fileURLToPath(new URL("../../../../web/test/fixtures/defence-replay-mixed-waves.json", import.meta.url));

/** A whole battle replays in about a second alone, several with the suite running alongside. */
const REPLAY_TIMEOUT_MS = 30_000;

const RECORD = process.env.RECORD_DEFENCE_GOLDEN === "1";

const RECORD_HINT =
  "re-record it on purpose: cd server && RECORD_DEFENCE_GOLDEN=1 bun test src/services/defences/defenceGolden.test.ts";

const MISSED_BUMP =
  "the stored defence replay no longer lands on its stored result, but the rules version did not change: " +
  "bump REPLAY_FORMAT in web/src/game/combat/rules/replay.ts and run `node tools/sync-combat-rules.mjs` from web/";

const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));

/** The payload as the finaliser lands it at `tick`: only the events up to it. */
const leftAt = (payload: any, tick: number): any => ({
  ...payload,
  tick,
  events: payload.events.filter((event: { t: number }) => event.t <= tick),
});

/** What the server stores of a landed replay: the tick, damage and health it fought to, the defender's loss. */
const outcomeOf = (payload: any) => {
  const outcome = replayAbandonedAttack(defenceReplayInput(payload));
  const loot: Record<string, number> = {};
  for (const [key, delta] of Object.entries(outcome.defenderDelta)) loot[key] = Math.max(0, -Number(delta));
  return {
    server: { tick: outcome.tick, damage: outcome.damage, buildinghealthdata: outcome.buildinghealthdata },
    damage: Math.min(100, Math.max(0, Math.trunc(outcome.damage))),
    loot,
  };
};

/** The fixture's stored figures, in `outcomeOf`'s shape. */
const storedOf = (server: any, defence: any) => ({
  server: { tick: server.tick, damage: server.damage, buildinghealthdata: server.buildinghealthdata },
  damage: defence.damageAfter,
  loot: defence.loot,
});

if (RECORD) {
  // A fresh yard: the damage this attack did is all the damage it has.
  const full = outcomeOf(fixture.replay);
  const left = outcomeOf(leftAt(fixture.replay, fixture.left.tick));
  const stamp = (defence: any, run: ReturnType<typeof outcomeOf>) => ({
    ...defence,
    damageDone: run.damage,
    damageAfter: run.damage,
    loot: run.loot,
    rulesVersion: RULES_VERSION,
  });
  fixture.defence = stamp(fixture.defence, full);
  fixture.server = full.server;
  fixture.left = { ...fixture.left, defence: stamp(fixture.left.defence, left), server: left.server };
  writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
}

describe("the golden defence replay (issue #364)", () => {
  test("is stamped with the server's rules version", () => {
    expect(fixture.defence.rulesVersion, `the rules version changed; ${RECORD_HINT}`).toBe(RULES_VERSION);
    expect(fixture.left.defence.rulesVersion, `the rules version changed; ${RECORD_HINT}`).toBe(RULES_VERSION);
  });

  test.if(fixture.defence.rulesVersion === RULES_VERSION)(
    "lands on its stored result under that version",
    () => {
      expect(outcomeOf(fixture.replay), MISSED_BUMP).toEqual(storedOf(fixture.server, fixture.defence));
    },
    REPLAY_TIMEOUT_MS,
  );

  test.if(fixture.left.defence.rulesVersion === RULES_VERSION)(
    "and so does the attack the finaliser landed from a checkpoint",
    () => {
      expect(outcomeOf(leftAt(fixture.replay, fixture.left.tick)), MISSED_BUMP).toEqual(
        storedOf(fixture.left.server, fixture.left.defence),
      );
    },
    REPLAY_TIMEOUT_MS,
  );
});
