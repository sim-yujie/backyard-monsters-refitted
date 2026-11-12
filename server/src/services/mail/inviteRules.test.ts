import { describe, expect, mock, test } from "bun:test";

mock.module("../../server.js", () => ({ postgres: { em: {} }, redis: {} }));

const {
  INVITE_LIFETIME,
  INVITE_PRICE,
  LEGACY_INVITE_PRICE,
  invitedPrice,
  InviteState,
  inviteAcceptRefusal,
  inviteRefusal,
  inviteSendRefusal,
  inviteState,
} = await import("./inviteRules.js");
const { chargeRelocation } = await import("../maproom/v2/relocateRules.js");

/** The pure rules of an invitation to move (#205). */

const NOW = 1_800_000_000;
const ALICE = 2505;
const WORLD = "world-a";

const invite = (over: Record<string, unknown> = {}) => ({
  userid: ALICE,
  updatetime: NOW - 60,
  migratestate: "requested",
  ...over,
});

const hers = { saveuserid: ALICE, type: "outpost" };

describe("where an invitation stands", () => {
  test("waiting while it is young and the outpost is still its inviter's", () => {
    expect(inviteState(invite(), hers, NOW)).toBe(InviteState.REQUESTED);
  });

  test("lapsed 7 days after it was sent", () => {
    expect(inviteState(invite({ updatetime: NOW - INVITE_LIFETIME + 1 }), hers, NOW)).toBe(InviteState.REQUESTED);
    expect(inviteState(invite({ updatetime: NOW - INVITE_LIFETIME }), hers, NOW)).toBe(InviteState.EXPIRED);
  });

  test("void once the outpost is gone, someone else's, or no longer an outpost", () => {
    expect(inviteState(invite(), null, NOW)).toBe(InviteState.VOID);
    expect(inviteState(invite(), { saveuserid: 77, type: "outpost" }, NOW)).toBe(InviteState.VOID);
    expect(inviteState(invite(), { saveuserid: ALICE, type: "main" }, NOW)).toBe(InviteState.VOID);
  });

  test("an answer, a withdrawal or a written void stands whatever the outpost or the clock", () => {
    for (const stored of ["accepted", "rejected", "revoked", "void"]) {
      expect(inviteState(invite({ migratestate: stored, updatetime: 0 }), null, NOW)).toBe(stored as never);
    }
  });
});

describe("who may be invited", () => {
  const invited = { userid: 77, mapVersion: 2, worldid: WORLD };
  const send = (over: Record<string, unknown> = {}, player: Record<string, unknown> = {}) =>
    inviteSendRefusal({
      inviterId: ALICE,
      ownsOutpost: true,
      outpostWorld: WORLD,
      invited: { ...invited, ...player },
      ...over,
    });

  test("another Map Room 2 player in the outpost's world, in an alliance or not", () => {
    expect(send()).toBeNull();
  });

  test("refused, in this order: not the inviter's outpost, oneself, not Map Room 2, another world", () => {
    expect(send({ ownsOutpost: false }, { userid: ALICE })).toBe("notYourOutpost");
    expect(send({}, { userid: ALICE })).toBe("self");
    expect(send({}, { mapVersion: 1 })).toBe("notMapRoom2");
    expect(send({}, { worldid: "world-b" })).toBe("otherWorld");
    expect(send({ outpostWorld: null })).toBe("otherWorld");
  });
});

describe("whether the invited player may move now", () => {
  const accept = (over: Record<string, unknown> = {}, player: Record<string, unknown> = {}) =>
    inviteAcceptRefusal({
      invited: { userid: 77, mapVersion: 2, worldid: WORLD, ...player },
      outpostWorld: WORLD,
      cantMoveTill: 0,
      underAttack: false,
      hasHomeCell: true,
      now: NOW,
      ...over,
    });

  test("free to go", () => {
    expect(accept()).toBeNull();
    expect(accept({ cantMoveTill: NOW })).toBeNull();
  });

  test("each check, again at accept", () => {
    expect(accept({}, { mapVersion: 3 })).toBe("notMapRoom2");
    expect(accept({}, { worldid: "world-b" })).toBe("otherWorld");
    expect(accept({ cantMoveTill: NOW + 1 })).toBe("coolingDown");
    expect(accept({ hasHomeCell: false })).toBe("noHomeCell");
    expect(accept({ underAttack: true })).toBe("underAttack");
  });
});

describe("the refusals' words", () => {
  test("each side reads its own", () => {
    expect(inviteRefusal("notEnoughShiny", "inviter")).toEqual({
      error: 1,
      message: "You need 750 Shiny for your share of the move.",
      reason: "notEnoughShiny",
    });
    expect(inviteRefusal("notEnoughShiny", "invitee").message).toBe("You do not have enough Shiny.");
    expect(inviteRefusal("hostCantPay", "invitee").message).toBe(
      "They can't pay their share right now, so nothing was charged. Try again later."
    );
  });

  test("a cooldown says when it ends", () => {
    expect(inviteRefusal("coolingDown", "invitee", NOW, NOW + 5 * 3_600)).toEqual({
      error: 1,
      message: "You have already moved your main yard. Try again in 5 h.",
      reason: "coolingDown",
      retryat: NOW + 5 * 3_600,
    });
  });
});

describe("the price", () => {
  const purse = { credits: 1_500, resources: { r1: 17_000_000, r2: 17_000_000, r3: 17_000_000, r4: 17_000_000 } };

  test("each player's share: 15,000,000 of each resource, or 750 Shiny (design v5 §12)", () => {
    expect(chargeRelocation(purse, "resources", INVITE_PRICE)).toEqual({
      ok: true,
      credits: 1_500,
      resources: { r1: 2_000_000, r2: 2_000_000, r3: 2_000_000, r4: 2_000_000 },
    });
    expect(chargeRelocation(purse, "shiny", INVITE_PRICE)).toMatchObject({ ok: true, credits: 750 });
  });

  test("an invitation without the inviter's choice keeps Flash's deal: the invited player alone, 10M or 1,200", () => {
    expect(invitedPrice({ hostpayment: null })).toEqual(LEGACY_INVITE_PRICE);
    expect(LEGACY_INVITE_PRICE).toEqual({ shiny: 1_200, resources: 10_000_000 });
    expect(invitedPrice({ hostpayment: "shiny" })).toEqual(INVITE_PRICE);
  });

  test("the relocation's own price is unchanged when none is given", () => {
    expect(chargeRelocation(purse, "resources")).toEqual({ ok: false, reason: "notEnoughResources" });
    expect(chargeRelocation(purse, "shiny")).toMatchObject({ ok: true, credits: 0 });
  });
});
