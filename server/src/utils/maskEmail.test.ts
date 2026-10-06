import { describe, expect, test } from "bun:test";
import { maskEmail } from "./maskEmail.js";

describe("maskEmail (issue #321)", () => {
  test("keeps the first two letters of the name and the domain", () => {
    expect(maskEmail("player@example.com")).toBe("pl***@example.com");
  });

  test("never shows the whole of a short name", () => {
    expect(maskEmail("ab@example.com")).toBe("a***@example.com");
    expect(maskEmail("a@example.com")).toBe("***@example.com");
  });

  test("something that is not an email is hidden entirely", () => {
    expect(maskEmail("nonsense")).toBe("***");
  });
});
