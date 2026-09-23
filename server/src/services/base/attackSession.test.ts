import { describe, expect, test } from "bun:test";
import {
  ATTACK_SESSION_TTL,
  ATTACK_SESSION_WINDOW,
  attackSessionKey,
  checkAttackBinding,
  parseAttackSession,
  serialiseAttackSession,
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
