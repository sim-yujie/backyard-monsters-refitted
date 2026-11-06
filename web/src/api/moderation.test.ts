import { describe, expect, it } from "vitest";
import { ApiError } from "./http";
import { banRefusal, banWords, localWhen } from "./moderation";

describe("a ban's words", () => {
  it("says until when in the player's own time, and why", () => {
    const until = "2026-11-10T14:05:00.000Z";
    expect(banWords(until, "Swearing in chat")).toBe(
      `Your account is banned until ${localWhen(until)}. Reason: Swearing in chat`,
    );
    expect(banWords(null, " ")).toBe("Your account is banned for good.");
  });

  it("reads the sign-in refusal for a ban, and nothing else", () => {
    const banned = new ApiError("Your account is banned until 2026-11-10 14:05 UTC.", {
      status: 403,
      details: { data: { reason: "banned", until: "2026-11-10T14:05:00.000Z", banReason: "Swearing" } },
    });
    expect(banRefusal(banned)).toBe(banWords("2026-11-10T14:05:00.000Z", "Swearing"));
    expect(banRefusal(new ApiError("Wrong password", { status: 401 }))).toBeNull();
    expect(banRefusal(new Error("x"))).toBeNull();
  });
});
