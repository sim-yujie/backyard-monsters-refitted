import { describe, expect, test } from "bun:test";
import { MAX_OUTPOSTS, reportedDamage, takeoverRefusal, type TakeoverTargetInput } from "./takeoverRules.js";

const TAKER = 2505;
const OWNER = 77;
const NOW = 1_800_000_000;

/** A destroyed player outpost, open to the taker. */
const outpost = (save: Partial<TakeoverTargetInput["save"]> = {}, over: Partial<TakeoverTargetInput> = {}) =>
  takeoverRefusal({
    takerId: TAKER,
    outpostCount: 1,
    now: NOW,
    cell: { uid: OWNER, base_type: 3 },
    save: { userid: OWNER, saveuserid: OWNER, type: "outpost", damage: 92, protected: 0, locked: 0, wmid: 0, savetime: NOW - 60, ...save },
    underAttack: false,
    ...over,
  });

/** A destroyed wild camp, last saved `age` seconds ago. */
const camp = (age: number, save: Partial<TakeoverTargetInput["save"]> = {}) =>
  takeoverRefusal({
    takerId: TAKER,
    outpostCount: 1,
    now: NOW,
    cell: { uid: 0, base_type: 1 },
    save: { userid: 0, saveuserid: 0, type: "tribe", damage: 95, protected: 0, locked: 0, wmid: 41, savetime: NOW - age, ...save },
    underAttack: false,
  });

describe("takeoverRefusal", () => {
  test("a destroyed outpost, unprotected, unlocked and quiet, may be taken", () => {
    expect(outpost()).toBeNull();
  });

  test("a destroyed wild camp inside its 12 hours may be taken", () => {
    expect(camp(11 * 3600)).toBeNull();
  });

  test("a wild camp past its 12-hour regeneration reads as rebuilt", () => {
    expect(camp(12 * 3600 + 1)).toBe("regenerated");
  });

  test("a main yard is never taken, however damaged", () => {
    expect(outpost({ type: "main" })).toBe("mainYard");
    expect(outpost({}, { cell: { uid: OWNER, base_type: 2 } })).toBe("mainYard");
  });

  test("the taker's own yard is refused", () => {
    expect(outpost({ userid: TAKER, saveuserid: TAKER }, { cell: { uid: TAKER, base_type: 3 } })).toBe("ownYard");
    expect(outpost({ saveuserid: TAKER })).toBe("ownYard");
  });

  test("below 90% damage is not destroyed", () => {
    expect(outpost({ damage: 89 })).toBe("notDestroyed");
    expect(outpost({ damage: 90 })).toBeNull();
    expect(camp(60, { damage: 50 })).toBe("notDestroyed");
  });

  test("a yard whose protection ran out reads as the map shows it: undamaged", () => {
    expect(outpost({ protected: NOW - 1 })).toBe("notDestroyed");
  });

  test("damage protection refuses", () => {
    expect(outpost({ protected: NOW + 60 })).toBe("protected");
  });

  test("a lock held by someone else refuses; the taker's own lock does not", () => {
    expect(outpost({ locked: 1 })).toBe("locked");
    expect(outpost({ locked: TAKER })).toBeNull();
  });

  test("an attack running on the target refuses", () => {
    expect(outpost({}, { underAttack: true })).toBe("underAttack");
  });

  test("the outpost cap refuses", () => {
    expect(outpost({}, { outpostCount: MAX_OUTPOSTS })).toBe("maxOutposts");
    expect(outpost({}, { outpostCount: MAX_OUTPOSTS - 1 })).toBeNull();
  });
});

describe("reportedDamage", () => {
  test("the stored damage, or 0 once protection has run out", () => {
    expect(reportedDamage({ damage: 92, protected: 0 }, NOW)).toBe(92);
    expect(reportedDamage({ damage: 92, protected: NOW + 1 }, NOW)).toBe(92);
    expect(reportedDamage({ damage: 92, protected: NOW }, NOW)).toBe(0);
  });
});
