import { describe, expect, test } from "bun:test";
import { MAX_OUTPOSTS, takeoverRefusal, type TakeoverTargetInput } from "./takeoverRules.js";

const TAKER = 2505;
const OWNER = 77;
const NOW = 1_800_000_000;

/**
 * A destroyed player outpost, and by default a taker holding its grant: the
 * grant's protection runs to its end plus 8 hours (`takeoverGrant.ts`).
 */
const outpost = (save: Partial<TakeoverTargetInput["save"]> = {}, over: Partial<TakeoverTargetInput> = {}) =>
  takeoverRefusal({
    takerId: TAKER,
    outpostCount: 1,
    now: NOW,
    cell: { uid: OWNER, base_type: 3 },
    save: {
      userid: OWNER,
      saveuserid: OWNER,
      type: "outpost",
      damage: 92,
      protected: NOW + 600 + 8 * 3600,
      locked: 0,
      wmid: 0,
      savetime: NOW - 60,
      ...save,
    },
    underAttack: false,
    holdsGrant: true,
    ...over,
  });

/** A destroyed wild camp, last saved `age` seconds ago. */
const camp = (age: number, save: Partial<TakeoverTargetInput["save"]> = {}, over: Partial<TakeoverTargetInput> = {}) =>
  takeoverRefusal({
    takerId: TAKER,
    outpostCount: 1,
    now: NOW,
    cell: { uid: 0, base_type: 1 },
    save: { userid: 0, saveuserid: 0, type: "tribe", damage: 95, protected: 0, locked: 0, wmid: 41, savetime: NOW - age, ...save },
    underAttack: false,
    holdsGrant: false,
    ...over,
  });

describe("takeoverRefusal, player outposts (the owner's one-chance rule)", () => {
  test("the grant holder may take the destroyed outpost, through the grant's own protection", () => {
    expect(outpost()).toBeNull();
  });

  test("without the grant nobody may, protected or not", () => {
    expect(outpost({}, { holdsGrant: false })).toBe("noTakeoverChance");
    expect(outpost({ protected: 0 }, { holdsGrant: false })).toBe("noTakeoverChance");
  });

  test("below 90% damage is not destroyed, grant or not", () => {
    expect(outpost({ damage: 89 })).toBe("notDestroyed");
    expect(outpost({ damage: 90 })).toBeNull();
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

describe("takeoverRefusal, wild camps (Flash's rule)", () => {
  test("a destroyed wild camp inside its 12 hours may be taken by anyone, no grant needed", () => {
    expect(camp(11 * 3600)).toBeNull();
  });

  test("a wild camp past its 12-hour regeneration reads as rebuilt", () => {
    expect(camp(12 * 3600 + 1)).toBe("regenerated");
  });

  test("below 90% damage is not destroyed", () => {
    expect(camp(60, { damage: 50 })).toBe("notDestroyed");
  });

  test("a protected camp is refused, as Flash's !_protected would", () => {
    expect(camp(60, { protected: NOW + 60 })).toBe("protected");
  });

  test("locked and under attack refuse", () => {
    expect(camp(60, { locked: 1 })).toBe("locked");
    expect(camp(60, {}, { underAttack: true })).toBe("underAttack");
  });
});

describe("takeoverRefusal, never", () => {
  test("a main yard is never taken, however damaged", () => {
    expect(outpost({ type: "main" })).toBe("mainYard");
    expect(outpost({}, { cell: { uid: OWNER, base_type: 2 } })).toBe("mainYard");
  });

  test("the taker's own yard is refused", () => {
    expect(outpost({ userid: TAKER, saveuserid: TAKER }, { cell: { uid: TAKER, base_type: 3 } })).toBe("ownYard");
    expect(outpost({ saveuserid: TAKER })).toBe("ownYard");
  });
});

describe("takeoverRefusal reads the real damage (issue #182 B)", () => {
  test("a destroyed camp whose protection ran out is still destroyed", () => {
    expect(camp(60, { protected: NOW - 1 })).toBeNull();
  });

  test("a grant holder's outpost is judged on its stored damage whatever its protection says", () => {
    expect(outpost({ protected: NOW - 1 })).toBeNull();
    expect(outpost({ protected: NOW - 1, damage: 50 })).toBe("notDestroyed");
  });
});
