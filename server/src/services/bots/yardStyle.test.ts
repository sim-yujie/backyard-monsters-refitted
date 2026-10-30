import { describe, expect, test } from "bun:test";
import { FULL_WALLS_SHARE, yardStyleOf } from "./yardStyle.js";

/** How a bot's seed picks its yard's style (owner decisions, 2026-10-23). */
describe("yardStyleOf", () => {
  const SEEDS = 20_000;
  const styles = Array.from({ length: SEEDS }, (_, seed) => yardStyleOf(seed));

  test("about half the bots wall in the whole yard, the other half only its core", () => {
    expect(FULL_WALLS_SHARE).toBe(0.5);
    const full = styles.filter((style) => style.walls === "full").length / SEEDS;
    expect(full).toBeGreaterThan(0.47);
    expect(full).toBeLessThan(0.53);
    expect(styles.every((style) => style.walls === "full" || style.walls === "core")).toBe(true);
  });

  test("no beginner yards: the style is only how the bot walls (owner, 2026-10-23)", () => {
    for (const style of styles.slice(0, 100)) expect(Object.keys(style)).toEqual(["walls"]);
  });

  test("the same seed gives the same style", () => {
    for (const seed of [0, 1, 16838, 72271]) expect(yardStyleOf(seed)).toEqual(yardStyleOf(seed));
  });
});
