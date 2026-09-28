import { describe, expect, it } from "vitest";
import { ApiError, NetworkError } from "@/api/http";
import type { MapCell, TakeoverQuoteResponse } from "@/api/types";
import {
  OUTPOST_CAPACITY,
  TAKEOVER_TEXT,
  clockSkew,
  firstOpenText,
  grantCountdownText,
  outpostTitle,
  priceText,
  quoteKey,
  refusalText,
  takenOverResources,
  takeoverActionView,
  takeoverCandidate,
  takeoverFailureText,
  takeoverGrantOf,
  useShinyLabel,
} from "./takeover";

const camp = (over: Partial<MapCell> = {}): MapCell =>
  ({ uid: 0, b: 1, i: 150, bid: "2000241208", n: "Kozu", l: 38, dm: 0, d: 0, ...over }) as MapCell;

const outpost = (over: Record<string, unknown> = {}): MapCell =>
  ({
    uid: 77,
    b: 3,
    i: 150,
    bid: "2000240208",
    aid: null,
    n: "Bramble",
    l: 20,
    v: 1,
    f: 2,
    c: 0,
    dm: 95,
    d: 1,
    lo: 0,
    p: 1,
    mine: 0,
    pic_square: null,
    pi: 0,
    fr: 0,
    ...over,
  }) as MapCell;

const quote = (over: Partial<TakeoverQuoteResponse> = {}): TakeoverQuoteResponse => ({
  error: 0,
  baseid: "2000241208",
  kind: "camp",
  eligible: true,
  reason: null,
  resources: 3_500_000,
  shiny: 924,
  adjacent: true,
  affordable: { resources: true, shiny: true },
  shinyLocked: false,
  now: 1_000,
  ...over,
});

describe("takeover candidates", () => {
  it("asks about wild camps and other players' outposts only", () => {
    expect(takeoverCandidate(camp())).toEqual({ baseid: "2000241208", kind: "camp", name: "Kozu" });
    expect(takeoverCandidate(outpost())).toEqual({ baseid: "2000240208", kind: "outpost", name: "Bramble" });
    expect(takeoverCandidate(outpost({ mine: 1 }))).toBeNull();
    expect(takeoverCandidate(outpost({ b: 2 }))).toBeNull();
    expect(takeoverCandidate({ i: 50 } as MapCell)).toBeNull();
    expect(takeoverCandidate(undefined)).toBeNull();
  });

  it("asks again only when what a takeover depends on changes", () => {
    const key = quoteKey(camp());
    expect(quoteKey(camp({ dm: 40 } as Partial<MapCell>))).toBe(key);
    expect(quoteKey(camp({ d: 1 } as Partial<MapCell>))).not.toBe(key);
    const base = quoteKey(outpost());
    expect(quoteKey(outpost({ p: 0 }))).not.toBe(base);
    expect(quoteKey(outpost({ lo: 5 }))).not.toBe(base);
    expect(quoteKey(outpost({ mine: 1 }))).toBeNull();
  });
});

describe("the map's Take over control", () => {
  it("on a camp: checking, then the price when eligible", () => {
    expect(takeoverActionView("camp", { status: "loading" })).toMatchObject({ visible: true, enabled: false });
    expect(takeoverActionView("camp", { status: "quoted", quote: quote() })).toEqual({
      visible: true,
      enabled: true,
      note: "3,500,000 of each resource or 924 Shiny",
    });
  });

  it("on a camp that cannot be taken: disabled with the reason in plain words", () => {
    const view = takeoverActionView("camp", {
      status: "quoted",
      quote: quote({ eligible: false, reason: "notDestroyed" }),
    });
    expect(view).toEqual({
      visible: true,
      enabled: false,
      note: "Not yet: destroy at least 90% of this yard first.",
    });
    expect(takeoverActionView("camp", { status: "failed" }).enabled).toBe(false);
  });

  it("on a player outpost: hidden unless the caller's grant is live", () => {
    expect(takeoverActionView("outpost", { status: "loading" }).visible).toBe(false);
    expect(
      takeoverActionView("outpost", {
        status: "quoted",
        quote: quote({ kind: "outpost", eligible: false, reason: "noTakeoverChance" }),
      }).visible,
    ).toBe(false);
    expect(
      takeoverActionView("outpost", {
        status: "quoted",
        quote: quote({ kind: "outpost", grantExpiresAt: 1_500 }),
      }),
    ).toMatchObject({ visible: true, enabled: true, expiresAt: 1_500 });
  });
});

describe("refusals", () => {
  it("says every reason in plain words, with Flash's lock wording per kind", () => {
    expect(refusalText("locked", "camp")).toBe("This yard is currently under attack by another player.");
    expect(refusalText("locked", "outpost")).toBe(
      "This yard is currently being worked on by its owner or is under attack by another player.",
    );
    expect(refusalText("outOfRange")).toBe("None of your Flingers reach this yard.");
    expect(refusalText("notEnoughResources")).toBe(TAKEOVER_TEXT.needResources);
    for (const reason of [
      "notFound",
      "mainYard",
      "ownYard",
      "noTakeoverChance",
      "regenerated",
      "protected",
      "underAttack",
      "maxOutposts",
      "notEnoughShiny",
    ] as const) {
      expect(refusalText(reason).length).toBeGreaterThan(10);
    }
  });

  it("puts a failed takeover in Flash's err_takeoverproblem wording", () => {
    const refused = new ApiError("that yard is under damage protection.", {
      status: 200,
      details: { data: { reason: "protected" } } as never,
    });
    expect(takeoverFailureText(refused, "camp")).toBe(
      "There was a problem taking over this yard: this yard is under damage protection.",
    );
    expect(takeoverFailureText(new NetworkError("down", null), "camp")).toBe(
      "There was a problem taking over this yard: the server could not be reached.",
    );
  });
});

describe("Flash's words", () => {
  it("titles, buttons and the first-open line", () => {
    expect(outpostTitle("Bramble")).toBe("Take Over Bramble's Outpost");
    expect(useShinyLabel(1301)).toBe("Use 1,301 Shiny");
    expect(firstOpenText("camp", "Kozu")).toBe(
      "You destroyed a Kozu base. Take over their yard and expand your empire.",
    );
    expect(firstOpenText("outpost", "Bramble")).toBe(
      "You destroyed Bramble's Outpost. Take over their yard and expand your empire.",
    );
    expect(priceText({ resources: 1_000_000, shiny: 549 })).toBe("1,000,000 of each resource or 549 Shiny");
  });
});

describe("the grant's clock", () => {
  it("counts down against the server's time", () => {
    expect(clockSkew(1_010, 1_000)).toBe(10);
    expect(clockSkew(undefined, 1_000)).toBe(0);
    expect(grantCountdownText(1_600, 1_000)).toBe("Offer ends in 10m 0s");
    expect(grantCountdownText(1_000, 1_000)).toBe("The offer has ended.");
  });

  it("reads a grant off the final save only for the target just attacked", () => {
    const grant = { baseid: "2000240208", expiresAt: 1_600, resources: 1_000_000, shiny: 549, adjacent: false };
    expect(takeoverGrantOf({ takeovergrant: grant }, "2000240208")).toEqual(grant);
    expect(takeoverGrantOf({ takeovergrant: grant }, "2000240209")).toBeNull();
    expect(takeoverGrantOf({}, "2000240208")).toBeNull();
    expect(takeoverGrantOf({ takeovergrant: { baseid: "2000240208" } }, "2000240208")).toBeNull();
  });
});

describe("the HUD after a takeover", () => {
  const pool = { r1: 5_000_000, r2: 5_000_000, r3: 5_000_000, r4: 5_000_000, r1max: 10e6, r2max: 10e6, r3max: 10e6, r4max: 10e6 };

  it("takes the resource price off and adds the outpost's storage", () => {
    const { resources, credits } = takenOverResources(pool, 900, { resources: 1_000_000, shiny: 549 }, "resources");
    expect(resources).toMatchObject({ r1: 4_000_000, r4: 4_000_000, r1max: 10e6 + OUTPOST_CAPACITY });
    expect(credits).toBe(900);
  });

  it("or the Shiny", () => {
    const { resources, credits } = takenOverResources(pool, 900, { resources: 1_000_000, shiny: 549 }, "shiny");
    expect(resources.r1).toBe(5_000_000);
    expect(credits).toBe(351);
  });
});
