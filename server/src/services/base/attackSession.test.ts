import { describe, expect, test } from "bun:test";
import {
  ATTACK_SESSION_TTL,
  ATTACK_SESSION_WINDOW,
  attackSessionKey,
  checkAttackBinding,
  newAttackSession,
  parseAttackSession,
  serialiseAttackSession,
  sessionFactsOf,
  type AttackSession,
} from "./attackSession.js";

/**
 * The binding rule is pure, so the whole of issue #25's decision is testable
 * without a database, a Redis or a request: the caller is a number, the stored
 * session is three numbers, and the answer is a verdict.
 */

const ATTACKER = 2;
const DEFENDER_ATTACK_ID = 4242;
const START = 1_000_000;

const session = (overrides: Partial<AttackSession> = {}): AttackSession => ({
  attackerid: ATTACKER,
  attackid: DEFENDER_ATTACK_ID,
  startedat: START,
  ...overrides,
});

/** A save arriving `elapsed` seconds into the attack, from `callerid`. */
const check = (
  callerid: number,
  elapsed = 30,
  overrides: {
    session?: AttackSession | null;
    storedAttackId?: number;
    submittedAttackId?: number;
  } = {}
) =>
  checkAttackBinding({
    session: overrides.session === undefined ? session() : overrides.session,
    callerid,
    storedAttackId: overrides.storedAttackId ?? DEFENDER_ATTACK_ID,
    submittedAttackId: overrides.submittedAttackId,
    now: START + elapsed,
  });

describe("checkAttackBinding", () => {
  test("the attacker who started the attack may save its result", () => {
    expect(check(ATTACKER)).toEqual({ ok: true });
  });

  test("the attacker may save with the attackid the client was given", () => {
    expect(check(ATTACKER, 30, { submittedAttackId: DEFENDER_ATTACK_ID })).toEqual({
      ok: true,
    });
  });

  test("another player cannot save against a base someone else is attacking", () => {
    expect(check(2504)).toEqual({ ok: false, reason: "wrong-attacker" });
  });

  test("a player who never started an attack is refused even with the right attackid", () => {
    expect(check(2504, 30, { submittedAttackId: DEFENDER_ATTACK_ID })).toEqual({
      ok: false,
      reason: "wrong-attacker",
    });
  });

  test("a base with no recorded attack refuses every save", () => {
    expect(check(ATTACKER, 30, { session: null })).toEqual({
      ok: false,
      reason: "no-session",
    });
  });

  test("the attacker is refused once the window has run out", () => {
    expect(check(ATTACKER, ATTACK_SESSION_WINDOW)).toEqual({ ok: false, reason: "expired" });
    expect(check(ATTACKER, ATTACK_SESSION_WINDOW + 60)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  test("the last second of the window is still inside it", () => {
    expect(check(ATTACKER, ATTACK_SESSION_WINDOW - 1)).toEqual({ ok: true });
  });

  test("expiry is decided before identity, so a stale session cannot name an attacker", () => {
    expect(check(2504, ATTACK_SESSION_WINDOW + 1)).toEqual({ ok: false, reason: "expired" });
  });

  test("a session for an attack the row has moved on from is stale", () => {
    expect(check(ATTACKER, 30, { storedAttackId: 9999 })).toEqual({
      ok: false,
      reason: "stale-attack",
    });
  });

  test("an attackid the client did not get from this attack is stale", () => {
    expect(check(ATTACKER, 30, { submittedAttackId: 9999 })).toEqual({
      ok: false,
      reason: "stale-attack",
    });
  });

  test("a missing or zero client attackid is not treated as a mismatch", () => {
    expect(check(ATTACKER, 30, { submittedAttackId: undefined })).toEqual({ ok: true });
    expect(check(ATTACKER, 30, { submittedAttackId: 0 })).toEqual({ ok: true });
  });

  test("a clock that reads behind the start is still inside the window", () => {
    expect(check(ATTACKER, -5)).toEqual({ ok: true });
  });
});

describe("the stored session", () => {
  test("survives a round trip", () => {
    const stored = session();

    expect(parseAttackSession(serialiseAttackSession(stored))).toEqual(stored);
  });

  test("is three plain integers", () => {
    expect(serialiseAttackSession(session())).toBe(`${ATTACKER}:${DEFENDER_ATTACK_ID}:${START}`);
  });

  test("carries entryHoused as JSON, and reads it back", () => {
    const stored = { ...session(), entryHoused: { "2000241207": { C1: 120, C4: 3 }, "2000240207": {} } };
    const raw = serialiseAttackSession(stored);

    expect(raw.startsWith("{")).toBe(true);
    expect(parseAttackSession(raw)).toEqual(stored);
  });

  test("carries the defender's served pool, and drops one that is not four amounts", () => {
    const pool = { r1: 1200.5, r2: 0, r3: 7, r4: 3 };
    const stored = { ...session(), entryHoused: { a: { C1: 1 } }, defenderResources: pool };

    expect(parseAttackSession(serialiseAttackSession(stored))).toEqual(stored);
    expect(parseAttackSession(serialiseAttackSession({ ...session(), defenderResources: pool }))).toEqual({
      ...session(),
      defenderResources: pool,
    });
    const broken = JSON.stringify({ ...session(), defenderResources: { r1: 5, r2: -1, r3: 0, r4: 0 } });
    expect(parseAttackSession(broken)?.defenderResources).toBeUndefined();
  });

  test("carries the attacker's level (#167), and drops one that is not a whole level", () => {
    const stored = { ...session(), attackerlevel: 7 };

    expect(parseAttackSession(serialiseAttackSession(stored))).toEqual(stored);
    for (const attackerlevel of [0, -3, 2.5, "7", null]) {
      const raw = JSON.stringify({ ...session(), attackerlevel });
      expect(parseAttackSession(raw)).toEqual(session());
    }
  });

  test("carries the defence the load served (#195), through its own checkpoint copy too", () => {
    const defenderForces = {
      bunkers: { 83: { C1: 10 } },
      defenderLevels: { C1: 6 },
      defenderChampions: [
        { t: 5, l: 3, hp: 8000, pl: 2 },
        { t: 1, l: 2, hp: 5000, pl: 1 },
      ],
    };
    const stored = newAttackSession(ATTACKER, DEFENDER_ATTACK_ID, undefined, undefined, undefined, undefined, defenderForces);
    const read = parseAttackSession(serialiseAttackSession(stored));

    expect(read?.defenderForces).toEqual(defenderForces);
    expect(sessionFactsOf(JSON.parse(JSON.stringify({ defenderForces }))).defenderForces).toEqual(defenderForces);
    expect(sessionFactsOf({ defenderForces: "nope" }).defenderForces).toBeUndefined();
  });

  test("carries the academy and Declare War the attack was fought with (#201), checkpoint copy too", () => {
    const attackerAcademy = { C1: 3, C5: 1 };
    const stored = newAttackSession(
      ATTACKER,
      DEFENDER_ATTACK_ID,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      attackerAcademy,
      false
    );
    const read = parseAttackSession(serialiseAttackSession(stored));

    expect(read?.attackerAcademy).toEqual(attackerAcademy);
    expect(read?.declareWar).toBe(false);
    expect(sessionFactsOf(JSON.parse(JSON.stringify({ attackerAcademy, declareWar: true })))).toEqual({
      attackerAcademy,
      declareWar: true,
    });
    expect(sessionFactsOf({ attackerAcademy: { C1: 0, C2: 2.5, C3: "4", C4: 2 } }).attackerAcademy).toEqual({ C4: 2 });
    expect(sessionFactsOf({ attackerAcademy: "nope", declareWar: "yes" })).toEqual({});
  });

  test("newAttackSession records the attacker's level only when it is given one", () => {
    expect(newAttackSession(ATTACKER, DEFENDER_ATTACK_ID, undefined, undefined, 3).attackerlevel).toBe(3);
    expect("attackerlevel" in newAttackSession(ATTACKER, DEFENDER_ATTACK_ID)).toBe(false);
  });

  test("a JSON session keeps only whole counts, and broken JSON is no session", () => {
    const raw = JSON.stringify({ ...session(), entryHoused: { a: { C1: 5, C2: -1, C3: 1.5, C4: "7" } } });

    expect(parseAttackSession(raw)?.entryHoused).toEqual({ a: { C1: 5 } });
    expect(parseAttackSession("{not json")).toBeNull();
    expect(parseAttackSession(JSON.stringify({ attackerid: 1, attackid: "x", startedat: 3 }))).toBeNull();
  });

  test.each([
    ["an empty key", ""],
    ["a missing key", null],
    ["an undefined key", undefined],
    ["too few fields", "2:4242"],
    ["too many fields", "2:4242:1000000:1"],
    ["a non-numeric field", "2:abc:1000000"],
    ["a fractional field", "2:4242.5:1000000"],
  ])("%s reads back as no session", (_label, raw) => {
    expect(parseAttackSession(raw)).toBeNull();
  });

  test("an unreadable key refuses the save rather than throwing", () => {
    const parsed = parseAttackSession("nonsense");

    expect(
      checkAttackBinding({
        session: parsed,
        callerid: ATTACKER,
        storedAttackId: DEFENDER_ATTACK_ID,
        now: START,
      })
    ).toEqual({ ok: false, reason: "no-session" });
  });

  test("one key per defender row", () => {
    expect(attackSessionKey(1234)).toBe("attack-session:1234");
    expect(attackSessionKey(1234)).not.toBe(attackSessionKey(1235));
  });

  test("the key outlives the window it authorises", () => {
    expect(ATTACK_SESSION_TTL).toBeGreaterThan(ATTACK_SESSION_WINDOW);
  });
});
