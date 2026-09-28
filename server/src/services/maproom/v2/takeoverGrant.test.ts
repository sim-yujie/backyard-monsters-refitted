import { describe, expect, test } from "bun:test";
import {
  OUTPOST_PROTECTION_SECONDS,
  TAKEOVER_GRANT_SECONDS,
  earnsTakeoverGrant,
  grantProtectedUntil,
  holdsTakeoverGrant,
  newTakeoverGrant,
} from "./takeoverGrant.js";

const NOW = 1_800_000_000;
const ATTACKER = 2505;

describe("earnsTakeoverGrant", () => {
  test("a player outpost left at 90% or more earns one", () => {
    expect(earnsTakeoverGrant({ type: "outpost", damage: 90 })).toBe(true);
    expect(earnsTakeoverGrant({ type: "outpost", damage: 100 })).toBe(true);
  });

  test("25-89% on an outpost does not: that is the normal 8 hours", () => {
    expect(earnsTakeoverGrant({ type: "outpost", damage: 89 })).toBe(false);
    expect(earnsTakeoverGrant({ type: "outpost", damage: 25 })).toBe(false);
  });

  test("main yards and wild camps never do", () => {
    expect(earnsTakeoverGrant({ type: "main", damage: 100 })).toBe(false);
    expect(earnsTakeoverGrant({ type: "tribe", damage: 100 })).toBe(false);
  });
});

describe("the grant and its protection", () => {
  const grant = newTakeoverGrant(ATTACKER, { basesaveid: 900, baseid: "2000240208" }, NOW);

  test("runs 10 minutes from the end of the attack", () => {
    expect(TAKEOVER_GRANT_SECONDS).toBe(600);
    expect(grant).toEqual({ attackerid: ATTACKER, basesaveid: 900, baseid: "2000240208", expiresAt: NOW + 600 });
  });

  test("the outpost is protected until the grant ends plus the normal 8 hours", () => {
    expect(OUTPOST_PROTECTION_SECONDS).toBe(8 * 3600);
    expect(grantProtectedUntil(grant)).toBe(NOW + 600 + 8 * 3600);
  });

  test("only its attacker holds it, and only until it ends", () => {
    expect(holdsTakeoverGrant(grant, ATTACKER, NOW)).toBe(true);
    expect(holdsTakeoverGrant(grant, ATTACKER, NOW + 599)).toBe(true);
    expect(holdsTakeoverGrant(grant, ATTACKER, NOW + 600)).toBe(false);
    expect(holdsTakeoverGrant(grant, 77, NOW)).toBe(false);
    expect(holdsTakeoverGrant(null, ATTACKER, NOW)).toBe(false);
  });
});
