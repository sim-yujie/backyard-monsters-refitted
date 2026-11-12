import { describe, expect, it } from "vitest";
import {
  NO_ROOM,
  packAmount,
  packCode,
  packGroup,
  sellsInfernoPacks,
  shinyForResources,
  topUpPrice,
} from "./resourcePacks";

/**
 * Flash's resource packs (`STORE.as:183-330`, issue #393) as the screens show
 * them; the server's copy (`server/src/services/yard/resourcePacks.ts`)
 * prices and refuses every purchase itself, with the same numbers.
 */

describe("shinyForResources", () => {
  it("prices on Flash's curve, ceil((sqrt(amount / 2)) ^ 0.75)", () => {
    expect(shinyForResources(100_000)).toBe(58);
    expect(shinyForResources(500_000)).toBe(106);
    expect(shinyForResources(10_000_000)).toBe(326);
  });

  it("is 0 for nothing, and 1 for a crumb", () => {
    expect(shinyForResources(0)).toBe(0);
    expect(shinyForResources(-5)).toBe(0);
    expect(shinyForResources(1)).toBe(1);
  });
});

describe("topUpPrice", () => {
  it("sums the four shortfalls before pricing, as BRTOPUP did", () => {
    expect(topUpPrice({ r1: 60_000, r3: 40_000 })).toBe(shinyForResources(100_000));
    expect(topUpPrice({})).toBe(0);
    expect(topUpPrice({ r1: -10, r2: Number.NaN })).toBe(0);
  });
});

describe("packCode", () => {
  it("spells Flash's store codes", () => {
    expect(packCode("r1", 1, false)).toBe("BR11");
    expect(packCode("r2", 3, false)).toBe("BR23");
    expect(packCode("r4", 1, true)).toBe("BR41I");
  });
});

describe("packAmount", () => {
  it("offers 10% and 50% of the cap only while they fit whole (Flash's strict <)", () => {
    expect(packAmount(1, 0, 1_000_000)).toBe(100_000);
    expect(packAmount(2, 0, 1_000_000)).toBe(500_000);
    expect(packAmount(1, 900_000, 1_000_000)).toBe(0);
    expect(packAmount(2, 500_000, 1_000_000)).toBe(0);
    expect(packAmount(2, 499_999, 1_000_000)).toBe(500_000);
  });

  it("fills to the cap, nothing when full or over", () => {
    expect(packAmount(3, 250_000, 1_000_000)).toBe(750_000);
    expect(packAmount(3, 1_000_000, 1_000_000)).toBe(0);
    expect(packAmount(3, 2_000_000, 1_000_000)).toBe(0);
    expect(packAmount(3, Number.NaN, 0)).toBe(0);
  });
});

describe("packGroup", () => {
  it("gives each offer its item, amount and price, and why it cannot be bought", () => {
    const group = packGroup("r1", 950_000, 1_000_000, false, 100);
    expect(group.offers.map((offer) => offer.item)).toEqual(["BR11", "BR12", "BR13"]);
    expect(group.offers[0]).toMatchObject({ amount: 0, price: 0, blocked: NO_ROOM });
    expect(group.offers[1]).toMatchObject({ amount: 0, blocked: NO_ROOM });
    expect(group.offers[2]).toMatchObject({ amount: 50_000, price: shinyForResources(50_000), blocked: null });
  });

  it("blocks what the Shiny cannot pay", () => {
    const group = packGroup("r3", 0, 10_000_000, true, 200);
    expect(group.inferno).toBe(true);
    expect(group.offers[0]!.item).toBe("BR31I");
    expect(group.offers[0]!.blocked).toBeNull();
    expect(group.offers[2]!.blocked).toBe("Not enough Shiny.");
  });
});

describe("sellsInfernoPacks", () => {
  it("sells the Inferno's in the Inferno, and in the main yard once the Descent is passed", () => {
    expect(sellsInfernoPacks("inferno", false)).toBe(true);
    expect(sellsInfernoPacks("main", false)).toBe(false);
    expect(sellsInfernoPacks("main", true)).toBe(true);
    expect(sellsInfernoPacks("outpost", true)).toBe(false);
  });
});
