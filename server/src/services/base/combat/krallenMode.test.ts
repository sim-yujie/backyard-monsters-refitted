import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FlingLog } from "../../../game-rules/combat/index.js";
import { RULES_VERSION } from "../../defences/rulesVersion.js";
import { checkpointSession, newCheckpoint } from "../attackCheckpoint.js";
import { brainsOf, newAttackSession, type AttackSession } from "../attackSession.js";
import { replayAbandonedAttack } from "./abandonedAttack.js";
import { battleReplayInput, type BattleDefender } from "./battle.js";

/**
 * Krallen has no Mode (owner, 25 Nov 2026, patch 8.7): the attack screen
 * offered Offensive, Defensive and Hybrid on her row, and the pick changed
 * whom she went for. She now always fights as Flash's Krallen did, unlooted
 * buildings first, then the nearest. The engine is unchanged: the server
 * fights a new attack's log with no Mode and no learned brain for her
 * (`withFrozenBrain`, `brainsOf`), and an attack started under older rules
 * (its session's `rules`) replays with the Mode and brain it was fought with.
 */

const SANDBOX = fileURLToPath(new URL("../../../../../web/test/fixtures/baseload-sandbox-yard.json", import.meta.url));
const sandbox = JSON.parse(readFileSync(SANDBOX, "utf8"));

const REPLAY_TIMEOUT_MS = 60_000;
/** 8.5's rules, live before this patch. */
const OLD_RULES = "2b60802884bcf7e6";
const HOME = "2000241207";
/** A brain that sends Krallen at towers, as an old one could. */
const BRAIN = { tower: 150, loot: -150, finish: 0, focus: 0, threat: 0 };

const defender: BattleDefender = {
  type: "main",
  buildingdata: sandbox.buildingdata,
  buildinghealthdata: sandbox.buildinghealthdata,
  resources: sandbox.resources,
};

const attacker = {
  academy: {},
  champion: [
    { t: 5, l: 5, hp: 62000, pl: 2 },
    { t: 3, l: 6, hp: 42200, pl: 3, fb: 2 },
  ],
  catapult: 0,
  buildingdata: {},
};

type Flung = { t: number; l: number; s?: string; b?: unknown };

const logOf = (...champions: Flung[]): FlingLog =>
  ({
    v: 1,
    seed: 4242,
    events: champions.map((champion, index) => ({
      kind: "fling",
      t: 10 + index * 5,
      x: 380,
      y: 380,
      r: 100,
      monsters: {},
      champion,
    })),
  }) as FlingLog;

const sessionOf = (rules: string | undefined, championBrains?: AttackSession["championBrains"]): AttackSession => ({
  attackerid: 2505,
  attackid: 7,
  startedat: 0,
  entryHoused: { [HOME]: {} },
  ...(rules !== undefined && { rules }),
  ...(championBrains && { championBrains }),
});

const inputOf = (log: FlingLog, session: AttackSession) =>
  battleReplayInput({ flinglog: log, session, defender, attacker, tick: 1_800 })!;

const flungOf = (log: FlingLog, session: AttackSession) =>
  inputOf(log, session).log.events.map((event) => (event.kind === "fling" ? event.champion : undefined));

/** What the battle did to the yard: each building's health, and the loot. */
const outcomeOf = (log: FlingLog, session: AttackSession) => {
  const outcome = replayAbandonedAttack(inputOf(log, session));
  return { health: outcome.buildinghealthdata, loot: outcome.attackloot, damage: outcome.damage };
};

describe("Krallen has no Mode in a new attack (patch 8.7)", () => {
  const fresh = sessionOf(RULES_VERSION);

  test("her log is fought with no Mode, whatever was sent; Fomor beside her keeps his", () => {
    expect(flungOf(logOf({ t: 5, l: 5, s: "offensive" }, { t: 3, l: 6, s: "offensive" }), fresh)).toEqual([
      { t: 5, l: 5 },
      expect.objectContaining({ t: 3, l: 6, s: "offensive" }),
    ]);
  });

  test(
    "she goes for the same buildings in every Mode a client sends",
    () => {
      const flash = outcomeOf(logOf({ t: 5, l: 5 }), fresh);
      expect(outcomeOf(logOf({ t: 5, l: 5, s: "offensive" }), fresh)).toEqual(flash);
      expect(outcomeOf(logOf({ t: 5, l: 5, s: "defensive" }), fresh)).toEqual(flash);
      expect(outcomeOf(logOf({ t: 5, l: 5, s: "hybrid" }), fresh)).toEqual(flash);
      // A brain sent in the log never counts, as before.
      expect(outcomeOf(logOf({ t: 5, l: 5, s: "offensive", b: BRAIN }), fresh)).toEqual(flash);
    },
    REPLAY_TIMEOUT_MS
  );

  test("a new session freezes no brain for her, so none is fought with", () => {
    expect(brainsOf([{ t: 5, l: 5, b: BRAIN }])).toBeUndefined();
  });

  test("a checkpointed attack keeps its rules, so the finaliser fights her the same", () => {
    const session = newAttackSession(2505, 7, { [HOME]: {} });
    expect(session.rules).toBe(RULES_VERSION);
    const checkpoint = newCheckpoint(session, 77, { tick: 100, flinglog: logOf({ t: 5, l: 5 }), sources: [HOME] }, 1);
    expect(checkpointSession(checkpoint).rules).toBe(RULES_VERSION);
    expect(flungOf(logOf({ t: 5, l: 5, s: "offensive" }), checkpointSession(checkpoint))).toEqual([
      { t: 5, l: 5 },
    ]);
  });
});

describe("an attack started under older rules replays exactly as it was fought", () => {
  const sent = logOf({ t: 5, l: 5, s: "offensive" });

  test("its log keeps her Mode and the brain its session froze", () => {
    for (const old of [sessionOf(OLD_RULES, { "5": BRAIN }), sessionOf(undefined, { "5": BRAIN })]) {
      expect(flungOf(sent, old)).toEqual([{ t: 5, l: 5, s: "offensive", b: BRAIN }]);
    }
    expect(flungOf(sent, sessionOf(OLD_RULES))).toEqual([{ t: 5, l: 5, s: "offensive" }]);
  });

  test(
    "and is fought with them: it is not the battle a new attack's Krallen fights",
    () => {
      const old = outcomeOf(sent, sessionOf(OLD_RULES, { "5": BRAIN }));
      expect(outcomeOf(sent, sessionOf(OLD_RULES, { "5": BRAIN }))).toEqual(old);
      expect(old).not.toEqual(outcomeOf(sent, sessionOf(RULES_VERSION)));
    },
    REPLAY_TIMEOUT_MS
  );
});
