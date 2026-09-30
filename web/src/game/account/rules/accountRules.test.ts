import { describe, expect, it } from "vitest";
import { AccountMessage, emailProblem, passwordProblem, usernameProblem } from "./accountRules";

/**
 * The shared account rules (issue #213). The server's own test
 * (`server/src/schemas/AuthSchemas.test.ts`) checks that its registration
 * schema agrees with these case for case; this pins the rules themselves.
 */

describe("usernameProblem", () => {
  it("takes 2 to 12 letters, digits and underscores", () => {
    for (const name of ["ab", "Bob_1", "abcdefghijkl", "__"])
      expect(usernameProblem(name)).toBeNull();
  });

  it("trims before it counts, as the server does", () => {
    expect(usernameProblem("  ab  ")).toBeNull();
    expect(usernameProblem(" a ")).toBe(AccountMessage.usernameLength);
  });

  it("refuses a name too short or too long", () => {
    expect(usernameProblem("a")).toBe(AccountMessage.usernameLength);
    expect(usernameProblem("abcdefghijklm")).toBe(AccountMessage.usernameLength);
  });

  it("refuses spaces, dashes and letters outside a-z", () => {
    for (const name of ["bad name", "x-y", "émile"]) {
      expect(usernameProblem(name)).toBe(AccountMessage.usernameCharset);
    }
  });
});

describe("emailProblem", () => {
  it("takes an ordinary address, in any case, with stray spaces", () => {
    for (const email of [
      "player@example.com",
      " Player@Example.COM ",
      "a.b+tag@sub.example.co.uk",
    ]) {
      expect(emailProblem(email)).toBeNull();
    }
  });

  it("refuses what is not an address", () => {
    for (const email of ["", "player", "a@b", "a@b.c", ".a@example.com", "a..b@example.com"]) {
      expect(emailProblem(email)).toBe(AccountMessage.email);
    }
  });
});

describe("passwordProblem", () => {
  it("takes 8 characters with a symbol", () => {
    expect(passwordProblem("hunter22!")).toBeNull();
    expect(passwordProblem("pässwörd")).toBeNull();
  });

  it("counts the length after trimming, as the server does", () => {
    expect(passwordProblem("  a!b    ")).toBe(AccountMessage.passwordLength);
  });

  it("wants a symbol", () => {
    expect(passwordProblem("longenough1")).toBe(AccountMessage.passwordSymbol);
  });
});
