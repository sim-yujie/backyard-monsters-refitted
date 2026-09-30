import { describe, expect, it } from "vitest";
import { ApiError, NetworkError } from "@/api/http";
import { AccountMessage } from "@/game/account/rules/accountRules";
import {
  PASSWORDS_DIFFER,
  describeSignUpFailure,
  isDefiniteProblem,
  signUpProblems,
  signUpRequest,
  type SignUpValues,
} from "./signUp";

const VALID: SignUpValues = {
  username: "zz_signup",
  email: "Player@Example.com",
  password: "hunter22!",
  confirm: "hunter22!",
};

/** An ApiError as `post` raises a ClientSafeError refusal. */
const refusal = (status: number, message: string, data: unknown): ApiError =>
  new ApiError(message, {
    status,
    code: message,
    details: { status, message, data },
  });

describe("signUpProblems", () => {
  it("finds nothing wrong with a good sign-up", () => {
    expect(signUpProblems(VALID)).toEqual({
      username: null,
      email: null,
      password: null,
      confirm: null,
    });
  });

  it("names each broken rule with the shared message", () => {
    expect(
      signUpProblems({ username: "a b", email: "nope", password: "short", confirm: "short" }),
    ).toEqual({
      username: AccountMessage.usernameCharset,
      email: AccountMessage.email,
      password: AccountMessage.passwordLength,
      confirm: null,
    });
  });

  it("wants the two passwords to match", () => {
    expect(signUpProblems({ ...VALID, confirm: "hunter22?" }).confirm).toBe(PASSWORDS_DIFFER);
  });
});

describe("isDefiniteProblem", () => {
  it("waits on a name that is only too short so far", () => {
    expect(isDefiniteProblem("username", { ...VALID, username: "a" })).toBe(false);
  });

  it("speaks up at once for a space, a dash or a thirteenth letter", () => {
    expect(isDefiniteProblem("username", { ...VALID, username: "a b" })).toBe(true);
    expect(isDefiniteProblem("username", { ...VALID, username: "a-" })).toBe(true);
    expect(isDefiniteProblem("username", { ...VALID, username: "abcdefghijklm" })).toBe(true);
  });

  it("waits while the confirmation is still on its way to the password", () => {
    expect(isDefiniteProblem("confirm", { ...VALID, confirm: "hunt" })).toBe(false);
    expect(isDefiniteProblem("confirm", { ...VALID, confirm: "hunx" })).toBe(true);
  });

  it("never rushes an email or a password", () => {
    expect(isDefiniteProblem("email", { ...VALID, email: "a" })).toBe(false);
    expect(isDefiniteProblem("password", { ...VALID, password: "a" })).toBe(false);
  });
});

describe("signUpRequest", () => {
  it("sends the name trimmed and the email trimmed and lower case", () => {
    expect(
      signUpRequest({ ...VALID, username: " zz_signup ", email: " Player@Example.com " }),
    ).toEqual({
      username: "zz_signup",
      email: "player@example.com",
      password: "hunter22!",
    });
  });
});

describe("describeSignUpFailure", () => {
  it("puts a taken username on the username field", () => {
    const failure = describeSignUpFailure(
      refusal(409, "An account with this username already exists.", {
        reason: "usernameTaken",
      }),
    );
    expect(failure).toEqual({
      field: "username",
      message: "That username is taken. Try another one.",
    });
  });

  it("puts a taken email on the email field", () => {
    const failure = describeSignUpFailure(
      refusal(409, "An account with this email address already exists.", {
        reason: "emailTaken",
      }),
    );
    expect(failure.field).toBe("email");
    expect(failure.message).toContain("already uses this email");
  });

  it("puts a broken rule on the field the server named, with its message", () => {
    const failure = describeSignUpFailure(
      refusal(400, AccountMessage.passwordSymbol, {
        reason: "invalidAccount",
        field: "password",
      }),
    );
    expect(failure).toEqual({ field: "password", message: AccountMessage.passwordSymbol });
  });

  it("says a rate limit is about the whole form, and does not promise a time", () => {
    const limited = new ApiError("Too many accounts were created from your network.", {
      status: 429,
      code: "Too many accounts were created from your network.",
    });
    const failure = describeSignUpFailure(limited);
    expect(failure.field).toBeNull();
    expect(failure.message).toMatch(/too many accounts/i);
  });

  it("explains an unreachable server", () => {
    expect(describeSignUpFailure(new NetworkError("down", null)).message).toMatch(
      /reach the server/,
    );
  });

  it("falls back to the server's words for anything else", () => {
    expect(describeSignUpFailure(refusal(500, "Something went wrong.", {}))).toEqual({
      field: null,
      message: "Something went wrong.",
    });
  });
});
