import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * No new unnamed distance in `engine.ts` (beta 9, the reach audit).
 *
 * Three reach rules had drifted from Flash because a bare `distanceSquared`
 * measured in the wrong space or from the wrong point of a building. A new
 * reach rule goes through a helper in `reach.ts` whose name says its space
 * and anchor (`screenPxToCornerSquared`, `yardToAnchorSquared`,
 * `yardToCentreSquared`, `screenPxCreepsSquared`, ...), or through one of
 * `yard.ts`'s named ones (`screenDistanceSquared`, `reachSquared`).
 *
 * The lines below are the raw `distanceSquared(`, `Math.hypot(` and
 * `Math.sqrt(` calls left when the guard came in, each with what it measures;
 * most are lengths of a step or a flight, not reach rules. This test fails
 * on any other, or on more of one than listed. Move a rule onto a named
 * helper rather than adding to the list; remove a line here when it goes.
 */
const ALLOWED: readonly (readonly [line: string, count: number, what: string])[] = [
  ["const distance = Math.sqrt(dx * dx + dy * dy);", 2, "a flight's length (orb, Spurtz shot)"],
  [
    "Math.trunc(distanceSquared(x, y, corpse.x, corpse.y)) < limit,",
    1,
    "Rezghul's corpse search, yard",
  ],
  ["const scale = (rng.float() * radius) / Math.sqrt(squared);", 1, "a random scatter point"],
  [
    "if (Math.hypot(creep.ix - event.x, creep.iy - event.y) <= reach) targets.push(creep);",
    1,
    "a raid event's reach, yard",
  ],
  ["const away = Math.hypot(at.x - drop.x, at.y - drop.y);", 2, "Decoy's pull and blast, yard"],
  [
    "const dealt = linearAreaDamage(damage, range, 0, Math.hypot(at.x - drop.x, at.y - drop.y));",
    1,
    "Decoy's blast falloff, yard",
  ],
  ["return Math.sqrt(x * x + y * y) <= sightOf(tower);", 1, "a tower's reach to the Vacuum hose (its sight, beta 10)"],
  [
    "if (distanceSquared(scan.x, scan.y, at.x, at.y) >= tower.range * tower.range) continue;",
    1,
    "the champion brain's tower fire estimate, middle to middle, yard",
  ],
  ["Math.sqrt(", 2, "the brain's field and Teratorn's bounce (multi-line)"],
  ["distanceSquared(", 1, "the brain's field (multi-line)"],
  [
    "const squared = distanceSquared(x, y, other.cx + other.middle, other.cy + other.middle);",
    1,
    "the brain's quake crowd count, middle to middle, yard",
  ],
  ["const away = Math.sqrt(across * across + down * down);", 1, "a route's screen length"],
  [
    "const squared = Math.trunc(distanceSquared(wall.cx, wall.cy, building.cx, building.cy));",
    1,
    "Valgos's wall crush, anchor to anchor, yard (revamp's own rule)",
  ],
  [
    "distanceSquared(originX, originY, building.sx, building.sy + building.middle),",
    1,
    "Teratorn's fireball bounce, screen px to the drawn middle",
  ],
  ["const length = Math.sqrt(across * across + down * down);", 1, "a step's screen length"],
  [
    "distanceSquared(home.centreX, home.centreY, other.x, other.y) < home.leash * home.leash;",
    1,
    "a bunker defender's leash, yard",
  ],
  [
    ".inRange(2 * Math.sqrt(reach), creep.x, creep.y, creep.hitFlags)",
    1,
    "a search radius from a squared reach",
  ],
  [
    "Math.sqrt(screenDistanceSquared(creep.ix, creep.iy, last.x, last.y)) / BLINK_HOPS;",
    1,
    "Bolt's blink hop length",
  ],
  [
    "if (Math.sqrt(x * x + y * y) >= tower.range) return;",
    1,
    "the Quake Tower's reach to the hall",
  ],
  ["const hall = Math.sqrt(x * x + hallY * hallY);", 1, "the Quake Tower's reach to the hall"],
  ["const length = Math.sqrt(toX * toX + toY * toY);", 1, "a shell's flight length"],
  ["const length = Math.sqrt(headX * headX + headY * headY);", 1, "a Spurtz shot's heading"],
  [
    "const left = Math.sqrt((shell.toX - shell.x) ** 2 + (shell.toY - shell.y) ** 2);",
    1,
    "a shell's flight left",
  ],
  ["const length = Math.sqrt(dx * dx + dy * dy);", 1, "a Tesla zap's length"],
];

const RAW = /(?<![A-Za-z0-9_$])distanceSquared\(|Math\.hypot\(|Math\.sqrt\(/g;

/** Each code line of engine.ts with a raw distance call, trimmed, and how many it has. */
const rawCalls = (): Map<string, number> => {
  const path = fileURLToPath(new URL("./engine.ts", import.meta.url));
  const found = new Map<string, number>();
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (line.startsWith("*") || line.startsWith("//") || line.startsWith("/*")) continue;
    const code = line.split("//")[0] ?? "";
    const count = code.match(RAW)?.length ?? 0;
    if (count > 0) found.set(line, (found.get(line) ?? 0) + count);
  }
  return found;
};

describe("engine.ts measures every new reach through a named distance (reach audit)", () => {
  it("has no raw distanceSquared, Math.hypot or Math.sqrt beyond the listed ones", () => {
    const allowed = new Map(ALLOWED.map(([line, count]) => [line, count]));
    const extra = [...rawCalls()]
      .filter(([line, count]) => count > (allowed.get(line) ?? 0))
      .map(([line]) => line);
    expect(
      extra,
      "use a named helper from reach.ts (its name says the space and the anchor)",
    ).toEqual([]);
  });

  it("lists no line that is gone, so the list only shrinks", () => {
    const found = rawCalls();
    const stale = ALLOWED.filter(([line, count]) => (found.get(line) ?? 0) < count).map(
      ([line]) => line,
    );
    expect(stale).toEqual([]);
  });
});
