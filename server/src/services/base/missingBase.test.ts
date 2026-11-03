import { describe, expect, mock, test } from "bun:test";

mock.module("../../server.js", () => ({ postgres: { em: {} }, redis: {} }));

const { missingBaseCause } = await import("./missingBase.js");

describe("missingBaseCause", () => {
  test("a save naming no row", () => {
    expect(missingBaseCause(0, null)).toBe("noBasesaveid");
    expect(missingBaseCause(Number.NaN, { basesaveid: 3 })).toBe("noBasesaveid");
  });

  test("a row named, and another holding the base now", () => {
    expect(missingBaseCause(9, { basesaveid: 31 })).toBe("replaced");
  });

  test("a row named, and nothing holding the base", () => {
    expect(missingBaseCause(9, null)).toBe("gone");
  });

  test("a route that names no row (updatesaved)", () => {
    expect(missingBaseCause(undefined, { basesaveid: 31 })).toBe("notShown");
    expect(missingBaseCause(undefined, null)).toBe("gone");
  });
});
