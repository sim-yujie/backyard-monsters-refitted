import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MUSHROOM_RESPAWN_SECONDS_BY_SEASON,
  currentSeason,
  onSeasonChange,
  seasonFor,
  setSeason,
} from "./season";

/** The yard's seasonal dress: Halloween while the server says it is on, else normal. */
describe("season", () => {
  afterEach(() => setSeason("normal"));

  it("reads the season off the active event kinds", () => {
    expect(seasonFor([])).toBe("normal");
    expect(seasonFor(["calendar"])).toBe("normal");
    expect(seasonFor(["halloween"])).toBe("halloween");
    expect(seasonFor(["other", "halloween"])).toBe("halloween");
  });

  it("starts normal and tells listeners only of a change", () => {
    expect(currentSeason()).toBe("normal");
    const heard = vi.fn();
    const stop = onSeasonChange(heard);

    setSeason("normal");
    setSeason("halloween");
    setSeason("halloween");
    stop();
    setSeason("normal");

    expect(heard.mock.calls).toEqual([["halloween"]]);
    expect(currentSeason()).toBe("normal");
  });

  it("pumpkins grow once an hour at Halloween, mushrooms every 17,280 s otherwise", () => {
    expect(MUSHROOM_RESPAWN_SECONDS_BY_SEASON).toEqual({ normal: 17_280, halloween: 3_600 });
  });
});
