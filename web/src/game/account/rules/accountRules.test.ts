import { describe, expect, it } from "vitest";
import {
  AccountMessage,
  RESERVED_USERNAME_WORDS,
  emailProblem,
  isReservedUsername,
  passwordProblem,
  usernameProblem,
} from "./accountRules";

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

  it("refuses a name that reads as the game's own team", () => {
    for (const name of ["admin", " Admin ", "MOD", "Admin_2", "the_mod", "SupportBob", "staff9"]) {
      expect(usernameProblem(name)).toBe(AccountMessage.usernameReserved);
    }
  });
});

describe("isReservedUsername", () => {
  it("refuses every reserved word on its own, in any case", () => {
    for (const word of RESERVED_USERNAME_WORDS) {
      expect(isReservedUsername(word)).toBe(true);
      expect(isReservedUsername(word.toUpperCase())).toBe(true);
    }
  });

  it("finds a reserved word between underscores, digits and a case change", () => {
    for (const name of ["x_admin", "mod_bob", "bob2staff", "iAmSupport", "System_1"]) {
      expect(isReservedUsername(name)).toBe(true);
    }
  });

  it("finds the team's names run together with other letters", () => {
    for (const name of ["bymrhelp", "TheModerator", "kixeyefan", "unofficial", "adminbob", "theadmin"]) {
      expect(isReservedUsername(name)).toBe(true);
    }
  });

  it("leaves ordinary words that only hold a reserved word's letters", () => {
    for (const name of ["modern", "supporter", "badminton", "Devon", "systematic", "rooted", "MODERN"]) {
      expect(isReservedUsername(name)).toBe(false);
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
