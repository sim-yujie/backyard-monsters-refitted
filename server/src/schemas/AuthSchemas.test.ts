import { describe, expect, test } from "bun:test";
import z from "zod";
import {
  EMAIL_PATTERN,
  emailProblem,
  passwordProblem,
  usernameProblem,
} from "../game-rules/account/accountRules.js";
import { UserRegistrationSchema } from "./AuthSchemas.js";

/**
 * The registration schema and the shared account rules the sign-up form runs
 * (issue #213) refuse exactly the same things, with the same message: a form
 * that passed what the server then refused would leave a player guessing.
 */

const VALID = { username: "zz_signup", email: "player@example.com", password: "hunter22!" };

/** The schema's message for one field, or null when it accepts it. */
const serverProblem = (field: keyof typeof VALID, value: string): string | null => {
  const parsed = UserRegistrationSchema.safeParse({ ...VALID, [field]: value });
  return parsed.success ? null : parsed.error.issues[0].message;
};

const USERNAMES = ["ab", "a", "abcdefghijkl", "abcdefghijklm", "Bob_1", " padded ", "bad name", "émile", "x-y", ""];
const EMAILS = [
  "player@example.com",
  " Player@Example.COM ",
  "not-an-email",
  "a@b",
  "a@b.c",
  "first.last+tag@sub.example.co.uk",
  ".dot@example.com",
  "a..b@example.com",
  "",
];
const PASSWORDS = ["hunter22!", "longenough", "short!", " a!b ", "        !", "pässwörd1", "12345678#", ""];

describe("the registration schema and the shared account rules", () => {
  test("agree on every username", () => {
    for (const username of USERNAMES) {
      expect([username, usernameProblem(username)]).toEqual([username, serverProblem("username", username)]);
    }
  });

  test("agree on every email address", () => {
    for (const email of EMAILS) {
      expect([email, emailProblem(email)]).toEqual([email, serverProblem("email", email)]);
    }
  });

  test("agree on every password", () => {
    for (const password of PASSWORDS) {
      expect([password, passwordProblem(password)]).toEqual([password, serverProblem("password", password)]);
    }
  });

  test("the shared email pattern is still zod's own", () => {
    expect(EMAIL_PATTERN.source).toBe(z.regexes.email.source);
  });
});
