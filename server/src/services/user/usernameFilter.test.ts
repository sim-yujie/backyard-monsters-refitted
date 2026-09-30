import { describe, expect, test } from "bun:test";
import { AccountMessage } from "../../game-rules/account/accountRules.js";
import { assertUsernameAllowed, isProfaneUsername } from "./usernameFilter.js";

/**
 * Usernames go through the same word filter as chat and alliance names
 * (issue #213), with a username's own word breaks understood.
 */

describe("isProfaneUsername", () => {
  test("catches a filtered word on its own, in any case", () => {
    expect(isProfaneUsername("shit")).toBe(true);
    expect(isProfaneUsername("SHIT")).toBe(true);
  });

  test("catches a filtered word joined by an underscore, a digit or a case change", () => {
    for (const name of ["big_shit", "shit_99", "shit2", "BigShit"]) {
      expect(isProfaneUsername(name)).toBe(true);
    }
  });

  test("leaves ordinary names alone, including ones holding a filtered word's letters", () => {
    for (const name of ["zz_signup", "Bob_1", "Scunthorpe", "classic", "grasshopper", "Cocktail"]) {
      expect(isProfaneUsername(name)).toBe(false);
    }
  });
});

describe("assertUsernameAllowed", () => {
  test("refuses a filtered name as a 400 on the username field, politely", () => {
    try {
      assertUsernameAllowed("big_shit");
      throw new Error("not refused");
    } catch (caught) {
      const error = caught as { status: number; message: string; data: { reason: string; field: string } };
      expect(error.status).toBe(400);
      expect(error.message).toBe(AccountMessage.usernameBlocked);
      expect(error.data).toEqual({ reason: "invalidAccount", field: "username" });
    }
  });

  test("lets a clean name through", () => {
    expect(() => assertUsernameAllowed("zz_signup")).not.toThrow();
  });
});
