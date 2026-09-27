import { describe, expect, test } from "bun:test";
import { storedDamage } from "./storedDamage.js";

describe("storedDamage (#72)", () => {
  test("truncates the client's two-decimal percentage, as Flash's int did", () => {
    expect(storedDamage(99.95)).toBe(99);
    expect(storedDamage(89.99)).toBe(89);
    expect(storedDamage(90)).toBe(90);
    expect(storedDamage(0.4)).toBe(0);
  });

  test("reads the save body's string form", () => {
    expect(storedDamage("99.95")).toBe(99);
    expect(storedDamage("56")).toBe(56);
  });

  test("keeps the result inside 0..100", () => {
    expect(storedDamage(100)).toBe(100);
    expect(storedDamage(140.2)).toBe(100);
    expect(storedDamage(-3)).toBe(0);
  });

  test("refuses what is not a number, so the stored value stands", () => {
    expect(storedDamage(undefined)).toBeNull();
    expect(storedDamage("lots")).toBeNull();
    expect(storedDamage(Number.NaN)).toBeNull();
    expect(storedDamage(null)).toBeNull();
  });
});
