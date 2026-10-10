import { describe, expect, it } from "vitest";
import { PASSWORDS_DIFFER } from "./signUp";
import { resetProblem, resetTokenFromLocation } from "./passwordReset";

describe("resetTokenFromLocation", () => {
  it("reads the token off the emailed link", () => {
    expect(resetTokenFromLocation({ pathname: "/reset-password", search: "?token=abc.def" })).toBe("abc.def");
    expect(resetTokenFromLocation({ pathname: "/reset-password/", search: "?token=abc" })).toBe("abc");
  });

  it("is null for any other page, or a link without a token", () => {
    expect(resetTokenFromLocation({ pathname: "/", search: "?token=abc" })).toBeNull();
    expect(resetTokenFromLocation({ pathname: "/reset-password", search: "" })).toBeNull();
    expect(resetTokenFromLocation({ pathname: "/reset-password", search: "?token=%20" })).toBeNull();
  });
});

describe("resetProblem", () => {
  it("holds the new password to the account rules and to matching", () => {
    expect(resetProblem("short", "short")).not.toBeNull();
    expect(resetProblem("longenough1", "longenough1")).not.toBeNull();
    expect(resetProblem("Strong#pass1", "Strong#pass2")).toBe(PASSWORDS_DIFFER);
    expect(resetProblem("Strong#pass1", "Strong#pass1")).toBeNull();
  });
});
