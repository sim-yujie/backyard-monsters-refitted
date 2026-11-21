// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { LATEST_RELEASE } from "@/data/changelog";
import { GAME_VERSION } from "@/data/gameVersion";
import { reportContext } from "./reportContext";

/** What a player's bug report carries besides their words. */
describe("the bug report's context", () => {
  it("names the full game version, patch number included, not the changelog's release", () => {
    const context = reportContext(window);
    expect(context.gameVersion).toBe(GAME_VERSION);
    expect(context.gameVersion).not.toBe("");
    // The two differ on any patch (2.0.0-beta.8.1 against 2.0.0-beta.8): the report must say the patch.
    if (LATEST_RELEASE && LATEST_RELEASE.version !== GAME_VERSION) expect(context.gameVersion).not.toBe(LATEST_RELEASE.version);
  });
});
