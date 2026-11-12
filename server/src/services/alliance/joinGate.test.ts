import { describe, expect, test } from "bun:test";

import { allianceJoinGateErr, assertRejoinAllowed, hasObservatory, joinRefusal, rejoinAvailableAt } from "./joinGate.js";

const OBSERVATORY = { o1: { t: 150, l: 1 } };
const ready = { worldid: "w1", mapversion: 2, mr2upgraded: true, buildingdata: OBSERVATORY };

describe("the alliance join gate (owner, 10 Nov 2026)", () => {
  test("a Map Room 2 yard with a finished Observatory may found or join in its own world", () => {
    expect(joinRefusal(ready)).toBeNull();
    expect(joinRefusal(ready, { allianceWorld: "w1" })).toBeNull();
  });

  test("the reasons, in the order they are asked", () => {
    expect(joinRefusal(null)).toBe("noWorld");
    expect(joinRefusal({ ...ready, worldid: null })).toBe("noWorld");
    expect(joinRefusal({ ...ready, mapversion: 1, mr2upgraded: false })).toBe("notMapRoom2");
    expect(joinRefusal({ ...ready, mapversion: 3, mr2upgraded: false })).toBe("notMapRoom2");
    expect(joinRefusal({ ...ready, buildingdata: {} })).toBe("noObservatory");
    expect(joinRefusal(ready, { allianceWorld: "w2" })).toBe("otherWorld");
  });

  test("an Observatory still being built does not count", () => {
    expect(hasObservatory({ o1: { t: 150, cB: 1_700_000_000 } })).toBe(false);
    expect(hasObservatory({ o1: { t: "150", cB: 0 } })).toBe(true);
    expect(hasObservatory({ o1: { t: 14 }, o2: null })).toBe(false);
    expect(hasObservatory(null)).toBe(false);
  });

  test("the error says who, and carries the reason", () => {
    const self = allianceJoinGateErr("noObservatory");
    const other = allianceJoinGateErr("otherWorld", "Bob");

    expect(self.message).toContain("Observatory");
    expect(other.message).toBe("Bob is in another world.");
    expect(other.data).toEqual({ reason: "otherWorld" });
    expect(other.status).toBe(403);
  });

  test("the 24-hour re-join wait", () => {
    const now = new Date("2026-11-10T12:00:00Z");

    expect(rejoinAvailableAt(null, now)).toBeNull();
    expect(rejoinAvailableAt(new Date("2026-11-09T11:59:59Z"), now)).toBeNull();
    expect(rejoinAvailableAt("2026-11-10T00:00:00Z", now)).toEqual(new Date("2026-11-11T00:00:00Z"));

    try {
      assertRejoinAllowed("2026-11-10T00:00:00Z", now, "Bob");
      throw new Error("not refused");
    } catch (error) {
      expect((error as Error).message).toBe("Bob left an alliance less than 24 hours ago.");
      expect((error as { data: object }).data).toEqual({
        reason: "rejoinCooldown",
        available_at: Date.parse("2026-11-11T00:00:00Z") / 1000,
      });
    }
  });
});
