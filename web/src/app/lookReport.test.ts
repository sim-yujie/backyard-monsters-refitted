// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/auth", () => ({ getSession: () => ({ userId: 42 }) }));

import { currentLook, LOOK_RESEND_MS, reportLook, resetLookReport, type LookChoices } from "./lookReport";

/**
 * Which look the player uses, sent to the server for the owner's dashboard
 * (owner, 4 Nov 2026): once per load, again on a change, never shown.
 */

const MODERN: LookChoices = { style: "modern", music: "style", quality: "high", font: "game" };
const CLASSIC: LookChoices = { ...MODERN, style: "classic" };
const NOW = 1_000_000_000;

beforeEach(() => {
  resetLookReport();
  localStorage.clear();
});

describe("currentLook", () => {
  it("reads the defaults when nothing was picked", () => {
    expect(currentLook()).toEqual(MODERN);
  });

  it("reads the choices saved in this browser", () => {
    localStorage.setItem("bymr.look", "classic");
    localStorage.setItem("bymr.music", "flash");
    localStorage.setItem("bymr.quality", "low");
    localStorage.setItem("bymr.font", "readable");
    expect(currentLook()).toEqual({ style: "classic", music: "flash", quality: "low", font: "readable" });
  });
});

describe("reportLook", () => {
  it("sends the look once, and not again while it is unchanged within the hour", () => {
    const send = vi.fn().mockResolvedValue({});
    reportLook(send, MODERN, 1, NOW);
    reportLook(send, MODERN, 1, NOW + 60_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(MODERN);
  });

  it("sends a changed look at once", () => {
    const send = vi.fn().mockResolvedValue({});
    reportLook(send, MODERN, 1, NOW);
    reportLook(send, CLASSIC, 1, NOW + 1000);
    expect(send).toHaveBeenNthCalledWith(2, CLASSIC);
  });

  it("sends an unchanged look again after an hour, so a tab left open still counts", () => {
    const send = vi.fn().mockResolvedValue({});
    reportLook(send, MODERN, 1, NOW);
    reportLook(send, MODERN, 1, NOW + LOOK_RESEND_MS);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("sends again for another account signed in on the same tab", () => {
    const send = vi.fn().mockResolvedValue({});
    reportLook(send, MODERN, 1, NOW);
    reportLook(send, MODERN, 2, NOW);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("forgets a failed send, quietly, so the next load tries again", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({});
    reportLook(send, MODERN, 1, NOW);
    await Promise.resolve();
    await Promise.resolve();
    reportLook(send, MODERN, 1, NOW + 1000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("uses the signed-in account and this browser's choices by default", () => {
    const send = vi.fn().mockResolvedValue({});
    localStorage.setItem("bymr.look", "classic");
    reportLook(send);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ style: "classic" }));
  });
});
