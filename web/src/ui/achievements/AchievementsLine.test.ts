// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlayerAchievements } from "@/api/achievements";
import { ApiError } from "@/api/http";
import {
  achievementsLine,
  clearAchievementsLineCache,
  LINE_CACHE_SIZE,
  LINE_FRESH_MS,
  type AchievementsLineOptions,
} from "./AchievementsLine";

/**
 * Another player's achievements on the map's panels (issue #204 WP7, §10.3):
 * "Achievements 7 / 16" with the newest badges, opening the read-only list.
 */

const bob: PlayerAchievements = {
  userid: 42,
  name: "Bob",
  earned: 4,
  total: 16,
  achievements: [
    { id: 1, name: "Town Planner", description: "", status: "earned", at: 100 },
    { id: 2, name: "Second", description: "", status: "earned", at: 400 },
    { id: 3, name: "Third", description: "", status: "locked" },
    { id: 7, name: "Camper", description: "", status: "earned", at: 300 },
    { id: 12, name: "Builder", description: "", status: "earned", at: 200 },
  ],
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const setUp = (answer: () => Promise<PlayerAchievements>, now = () => 1_000) => {
  const fetch = vi.fn(answer);
  const onOpen = vi.fn();
  const options: AchievementsLineOptions = { onOpen, fetch, now };
  return { fetch, onOpen, options };
};

afterEach(() => clearAchievementsLineCache());

describe("achievementsLine", () => {
  it("says how many are earned and shows the three newest badges", async () => {
    const { options } = setUp(async () => bob);
    const line = achievementsLine(42, "Bob", options);
    expect(line.querySelector(".ach-line__count")?.textContent).toBe("…");
    await settle();
    expect(line.textContent).toBe("Achievements4 / 16");
    expect(line.getAttribute("aria-label")).toBe("Bob's achievements: 4 / 16 earned");
    const badges = [...line.querySelectorAll<HTMLElement>(".ach-badge")];
    expect(badges.map((badge) => badge.dataset["achievement"])).toEqual(["2", "7", "12"]);
    expect(badges.every((badge) => !badge.classList.contains("ach-badge--locked"))).toBe(true);
  });

  it("opens the read-only list for that player", async () => {
    const { options, onOpen } = setUp(async () => bob);
    const line = achievementsLine(42, "Bob", options);
    line.click();
    expect(onOpen).toHaveBeenCalledWith(42, "Bob", undefined);
  });

  it("hands the list its fresh answer, so opening it does not ask again", async () => {
    let now = 1_000;
    const { options, onOpen } = setUp(async () => bob, () => now);
    const line = achievementsLine(42, "Bob", options);
    await settle();
    line.click();
    expect(onOpen).toHaveBeenLastCalledWith(42, "Bob", bob);
    now += LINE_FRESH_MS;
    line.click();
    expect(onOpen).toHaveBeenLastCalledWith(42, "Bob", undefined);
  });

  it("shows no badges for a player with none earned", async () => {
    const { options } = setUp(async () => ({ ...bob, earned: 0, achievements: [] }));
    const line = achievementsLine(42, "Bob", options);
    await settle();
    expect(line.querySelector(".ach-line__count")?.textContent).toBe("0 / 16");
    expect(line.querySelectorAll(".ach-badge")).toHaveLength(0);
    expect(line.hidden).toBe(false);
  });

  it("hides itself when the player is not found or the ask fails", async () => {
    const missing = setUp(async () => {
      throw new ApiError("not found", { status: 404 });
    });
    const line = achievementsLine(42, "Bob", missing.options);
    await settle();
    expect(line.hidden).toBe(true);
    // The refusal is kept too, so a rebuilt panel does not ask again at once.
    expect(achievementsLine(42, "Bob", missing.options).hidden).toBe(true);
    expect(missing.fetch).toHaveBeenCalledTimes(1);
  });

  it("asks once a minute per player: a rebuilt panel fills at once from the kept answer", async () => {
    let now = 1_000;
    const { options, fetch } = setUp(async () => bob, () => now);
    achievementsLine(42, "Bob", options);
    // A second line while the first ask is still out shares it.
    const waiting = achievementsLine(42, "Bob", options);
    expect(fetch).toHaveBeenCalledTimes(1);
    await settle();
    expect(waiting.querySelector(".ach-line__count")?.textContent).toBe("4 / 16");
    const rebuilt = achievementsLine(42, "Bob", options);
    expect(rebuilt.querySelector(".ach-line__count")?.textContent).toBe("4 / 16");
    expect(fetch).toHaveBeenCalledTimes(1);
    achievementsLine(43, "Ann", options);
    expect(fetch).toHaveBeenCalledTimes(2);
    now += LINE_FRESH_MS;
    achievementsLine(42, "Bob", options);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("keeps at most fifty players, the oldest asked dropped first", async () => {
    const { options, fetch } = setUp(async () => bob);
    for (let userid = 1; userid <= LINE_CACHE_SIZE + 1; userid += 1) achievementsLine(userid, "P", options);
    expect(LINE_CACHE_SIZE).toBe(50);
    expect(fetch).toHaveBeenCalledTimes(51);
    // The newest fifty are kept; the first was dropped and is asked again.
    achievementsLine(LINE_CACHE_SIZE + 1, "P", options);
    achievementsLine(2, "P", options);
    expect(fetch).toHaveBeenCalledTimes(51);
    achievementsLine(1, "P", options);
    expect(fetch).toHaveBeenCalledTimes(52);
  });

  it("drops stale answers when a new one is asked for", async () => {
    let now = 1_000;
    const { options, fetch } = setUp(async () => bob, () => now);
    achievementsLine(42, "Bob", options);
    now += LINE_FRESH_MS;
    // Ann's ask sweeps out Bob's stale answer, so Bob's next ask is fresh.
    achievementsLine(43, "Ann", options);
    now -= 1;
    achievementsLine(42, "Bob", options);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
