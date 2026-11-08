import { describe, expect, test } from "bun:test";
import { packAmount, packCode, packFunds, packPoints, packPrice, readPack } from "./resourcePacks.js";

describe("resource packs (STORE.as:212-330)", () => {
  test("reads the twelve surface codes and the twelve Inferno codes, nothing else", () => {
    expect(readPack("BR11")).toEqual({ item: "BR11", resource: "r1", size: 1, inferno: false });
    expect(readPack("BR43")).toEqual({ item: "BR43", resource: "r4", size: 3, inferno: false });
    expect(readPack("BR22I")).toEqual({ item: "BR22I", resource: "r2", size: 2, inferno: true });
    for (const code of ["BR", "BR14", "BR51", "BR01", "BRTOPUP", "BIP", "BR11X", "br11"]) {
      expect(readPack(code)).toBeNull();
    }
    expect(packCode("r3", 2, false)).toBe("BR32");
    expect(packCode("r4", 1, true)).toBe("BR41I");
  });

  test("10% and 50% of the cap, offered only while they fit whole (strict <)", () => {
    expect(packAmount(1, 0, 1_000_000)).toBe(100_000);
    expect(packAmount(2, 0, 1_000_000)).toBe(500_000);
    expect(packAmount(1, 899_999, 1_000_000)).toBe(100_000);
    expect(packAmount(1, 900_000, 1_000_000)).toBe(0);
    expect(packAmount(2, 500_000, 1_000_000)).toBe(0);
    expect(packAmount(2, 499_999, 1_000_000)).toBe(500_000);
  });

  test("fill is the room left, nothing once full or over", () => {
    expect(packAmount(3, 250_000, 1_000_000)).toBe(750_000);
    expect(packAmount(3, 1_000_000, 1_000_000)).toBe(0);
    expect(packAmount(3, 1_200_000, 1_000_000)).toBe(0);
    expect(packAmount(3, Number.NaN, 1_000)).toBe(1_000);
  });

  test("prices on Flash's curve ceil((sqrt(n / 2)) ^ 0.75)", () => {
    expect(packPrice(100_000)).toBe(Math.ceil(Math.pow(Math.sqrt(50_000), 0.75)));
    expect(packPrice(100_000)).toBe(58);
    expect(packPrice(500_000)).toBe(106);
    expect(packPrice(10_000_000)).toBe(326);
    expect(packPrice(0)).toBe(0);
  });

  test("funds the amount rounded up and gives 30% of it as points, rounded up", () => {
    expect(packFunds(1_234.5)).toBe(1_235);
    expect(packPoints(100_000)).toBe(30_000);
    expect(packPoints(1_001)).toBe(301);
    expect(packPoints(-5)).toBe(0);
  });
});
