import { describe, expect, it } from "vitest";
import { ApiError } from "./http";
import { backAtWords, countdownWords, maintenanceRefusal, readMaintenanceNotice } from "./maintenance";

describe("maintenance words", () => {
  it("counts down as m:ss, never below 0:00", () => {
    expect(countdownWords(299_001)).toBe("5:00");
    expect(countdownWords(299_000)).toBe("4:59");
    expect(countdownWords(59_500)).toBe("1:00");
    expect(countdownWords(9_000)).toBe("0:09");
    expect(countdownWords(-5)).toBe("0:00");
  });

  it("gives the back-at time in the player's own clock, with the day when it is not today", () => {
    const today = new Date(2026, 10, 22, 12, 0);
    const later = new Date(2026, 10, 22, 15, 30);
    const tomorrow = new Date(2026, 10, 23, 9, 0);
    expect(backAtWords(later.toISOString(), today)).toBe(
      later.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(/\s/g, "\u00a0"),
    );
    expect(backAtWords(tomorrow.toISOString(), today)).toContain(
      tomorrow.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(/\s/g, "\u00a0"),
    );
    expect(backAtWords(tomorrow.toISOString(), today)).not.toBe(
      tomorrow.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(/\s/g, "\u00a0"),
    );
    expect(backAtWords(null)).toBeNull();
    expect(backAtWords("soon")).toBeNull();
  });

  it("reads a refusal for maintenance, and nothing else", () => {
    const refused = new ApiError("x", {
      status: 200,
      details: { data: { reason: "maintenance", maintenanceMessage: "Moving", backAt: "2026-11-22T15:30:00.000Z" } } as never,
    });
    expect(maintenanceRefusal(refused)).toEqual({ message: "Moving", backAt: "2026-11-22T15:30:00.000Z" });
    expect(maintenanceRefusal(new ApiError("x", { status: 403, details: { data: { reason: "banned" } } as never }))).toBeNull();
    expect(maintenanceRefusal(new Error("x"))).toBeNull();
  });

  it("reads a notice defensively", () => {
    expect(readMaintenanceNotice({ on: true, message: "m", backAt: "", remainingMs: -3, exempt: "yes" })).toEqual({
      on: true,
      message: "m",
      backAt: null,
      remainingMs: 0,
      exempt: false,
    });
    expect(readMaintenanceNotice({ type: "maintenance" })).toBeNull();
    expect(readMaintenanceNotice(null)).toBeNull();
  });
});
