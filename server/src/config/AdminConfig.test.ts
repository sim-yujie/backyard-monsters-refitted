import { describe, expect, test } from "bun:test";

import { adminUserIds, isAdminUser } from "./AdminConfig.js";

describe("ADMIN_USER_IDS (AdminConfig.ts)", () => {
  test("unset or empty means nobody", () => {
    expect([...adminUserIds({})]).toEqual([]);
    expect([...adminUserIds({ ADMIN_USER_IDS: "" })]).toEqual([]);
    expect(isAdminUser(1, {})).toBe(false);
  });

  test("a comma list of account numbers, with spaces and junk ignored", () => {
    const env = { ADMIN_USER_IDS: " 12, 345 ,abc, -4, 0, 1.5, 99999999999999999999,7 " };
    expect([...adminUserIds(env)].sort((a, b) => a - b)).toEqual([7, 12, 345]);
    expect(isAdminUser(12, env)).toBe(true);
    expect(isAdminUser(345, env)).toBe(true);
    expect(isAdminUser(13, env)).toBe(false);
  });

  test("only a real number matches: not its text, not a missing user", () => {
    const env = { ADMIN_USER_IDS: "12" };
    expect(isAdminUser("12", env)).toBe(false);
    expect(isAdminUser(undefined, env)).toBe(false);
    expect(isAdminUser(null, env)).toBe(false);
  });
});
