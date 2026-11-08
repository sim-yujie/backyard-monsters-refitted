import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LATEST_RELEASE } from "./changelog";
import { GAME_VERSION } from "./gameVersion";

/** "2.0.0-beta.6.8" as [2, 0, 0, 6, 8]; "beta.6" as [.., 6]. */
const parts = (version: string): number[] => version.replace("-beta", "").split(".").map(Number);

const compare = (a: string, b: string): number => {
  const [left, right] = [parts(a), parts(b)];
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const diff = (left[index] ?? -1) - (right[index] ?? -1);
    if (diff !== 0) return diff;
  }
  return 0;
};

const RELEASES = fileURLToPath(new URL("../../../docs/releases/", import.meta.url));

describe("GAME_VERSION", () => {
  it("is not older than the newest release notes in docs/releases (raise it with each patch)", () => {
    const versions = readdirSync(RELEASES)
      .map((name) => /^v(\d+\.\d+\.\d+-beta\.\d+(?:\.\d+)*)\.md$/.exec(name)?.[1])
      .filter((version): version is string => version !== undefined);
    expect(versions.length).toBeGreaterThan(0);
    const newest = versions.sort(compare).at(-1)!;
    expect(compare(GAME_VERSION, newest)).toBeGreaterThanOrEqual(0);
  });

  it("belongs to the release whose What's new cards show", () => {
    const release = LATEST_RELEASE?.version ?? "";
    expect(GAME_VERSION === release || GAME_VERSION.startsWith(`${release}.`)).toBe(true);
  });
});
