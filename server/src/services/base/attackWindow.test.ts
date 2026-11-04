import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import {
  ATTACK_COUNTDOWN_SECONDS,
  DECLARE_WAR_COUNTDOWN_SECONDS,
  RETREAT_GRACE_SECONDS,
} from "../../game-rules/combat/index.js";
import { ATTACK_SESSION_TTL, checkAttackBinding, sessionWindowSeconds } from "./attackSession.js";
import {
  ATTACK_WINDOW_SPARE_SECONDS,
  LONGEST_ATTACK_WINDOW_SECONDS,
  attackEndsAt,
  attackWindowSeconds,
} from "./attackWindow.js";
import { isAttackActive } from "./isAttackActive.js";

/**
 * An attack's window is its own length plus a spare minute (owner, 4 Nov
 * 2026), and the defender's lock and the attacker's save share it, so the
 * yard frees at the very second the attacker's result stops being taken.
 */

const START = 1_900_000_000;
const ATTACKER = 2503;
const ATTACK_ID = 4242;

afterEach(() => {
  setSystemTime();
});

/** The defender's row as the attack load left it. */
const row = (declareWar: boolean) => ({
  attackid: ATTACK_ID,
  attacks: [{ name: "Raider", starttime: START, ...(declareWar && { declarewar: true }) }],
});

/** Whether the row reads as under attack `elapsed` seconds in. */
const lockedAt = (declareWar: boolean, elapsed: number): boolean => {
  setSystemTime(new Date((START + elapsed) * 1000));
  return isAttackActive(row(declareWar) as never);
};

/** Whether the attacker's save is taken `elapsed` seconds in. */
const savesAt = (declareWar: boolean, elapsed: number): boolean =>
  checkAttackBinding({
    session: { attackerid: ATTACKER, attackid: ATTACK_ID, startedat: START, ...(declareWar && { declareWar }) },
    callerid: ATTACKER,
    storedAttackId: ATTACK_ID,
    now: START + elapsed,
  }).ok;

describe("attackWindowSeconds", () => {
  test("is the countdown, the retreat grace and a spare minute", () => {
    expect(attackWindowSeconds(false)).toBe(ATTACK_COUNTDOWN_SECONDS + RETREAT_GRACE_SECONDS + ATTACK_WINDOW_SPARE_SECONDS);
    expect(attackWindowSeconds(false)).toBe(480);
    expect(attackWindowSeconds(true)).toBe(DECLARE_WAR_COUNTDOWN_SECONDS + RETREAT_GRACE_SECONDS + ATTACK_WINDOW_SPARE_SECONDS);
    expect(attackWindowSeconds(true)).toBe(600);
    expect(attackWindowSeconds()).toBe(480);
    expect(LONGEST_ATTACK_WINDOW_SECONDS).toBe(600);
  });

  test("a session without the Declare War flag reads as an ordinary attack", () => {
    expect(sessionWindowSeconds({})).toBe(480);
    expect(sessionWindowSeconds({ declareWar: false })).toBe(480);
    expect(sessionWindowSeconds({ declareWar: true })).toBe(600);
  });

  test("the session key outlives the longest window", () => {
    expect(ATTACK_SESSION_TTL).toBeGreaterThan(LONGEST_ATTACK_WINDOW_SECONDS);
  });
});

describe("the defender's lock and the attacker's save end together", () => {
  test("an ordinary attack: taken at 7 min 30 s, refused at 8 min 10 s", () => {
    expect(savesAt(false, 7 * 60 + 30)).toBe(true);
    expect(lockedAt(false, 7 * 60 + 30)).toBe(true);
    expect(savesAt(false, 8 * 60 + 10)).toBe(false);
    expect(lockedAt(false, 8 * 60 + 10)).toBe(false);
  });

  test("a Declare War attack: taken at 9 min 50 s", () => {
    expect(savesAt(true, 9 * 60 + 50)).toBe(true);
    expect(lockedAt(true, 9 * 60 + 50)).toBe(true);
    expect(savesAt(true, 10 * 60)).toBe(false);
    expect(lockedAt(true, 10 * 60)).toBe(false);
  });

  for (const declareWar of [false, true]) {
    test(`at the same second${declareWar ? " under Declare War" : ""}`, () => {
      const window = attackWindowSeconds(declareWar);
      expect(attackEndsAt(row(declareWar).attacks[0]!)).toBe(START + window);
      expect([savesAt(declareWar, window - 1), lockedAt(declareWar, window - 1)]).toEqual([true, true]);
      expect([savesAt(declareWar, window), lockedAt(declareWar, window)]).toEqual([false, false]);
    });
  }
});
