import { describe, expect, it } from "vitest";
import { walkerAt } from "./MonsterWalkIn";
import {
  FLEE_AT,
  planRaid,
  raidAt,
  RAID_COUNT,
  RAID_KILLS,
  RAID_SECONDS,
  SHOT_SECONDS,
  SPAWN_DISTANCE,
  TOWER_RANGE,
} from "./stagedRaid";

/** The staged raid's timeline (issue #227, `docs/design/tutorial.md` §4). */

const tower = { x: 300, y: -300 };
const hall = { x: 0, y: 0 };
const plan = planRaid(tower, hall);
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe("the staged raid", () => {
  it("sends eight from about 600 beyond the tower, on the Town Hall's far side", () => {
    expect(plan.monsters).toHaveLength(RAID_COUNT);
    for (const monster of plan.monsters) {
      expect(distance(monster.spawn, tower)).toBeGreaterThan(SPAWN_DISTANCE - 150);
      expect(distance(monster.spawn, tower)).toBeLessThan(SPAWN_DISTANCE + 150);
      // Further from the hall than the tower is: they come from outside.
      expect(distance(monster.spawn, hall)).toBeGreaterThan(distance(tower, hall));
    }
  });

  it("shoots six, two seconds apart, the first as one comes into range", () => {
    expect(plan.shots).toHaveLength(RAID_KILLS);
    for (let i = 1; i < plan.shots.length; i++) {
      expect(plan.shots[i]!.at - plan.shots[i - 1]!.at).toBeCloseTo(SHOT_SECONDS);
    }
    const first = plan.shots[0]!;
    const target = raidAt(plan, first.at - 0.01).monsters[first.target]!;
    expect(distance(target, tower)).toBeLessThanOrEqual(TOWER_RANGE + 1);
    expect(plan.shots.at(-1)!.at).toBeLessThan(FLEE_AT);
    expect(new Set(plan.shots.map((shot) => shot.target)).size).toBe(RAID_KILLS);
  });

  it("the last two run away, and it is over by 19 seconds", () => {
    const fleeing = raidAt(plan, FLEE_AT + 1).monsters.filter((one) => one.fleeing);
    expect(fleeing).toHaveLength(RAID_COUNT - RAID_KILLS);
    const end = raidAt(plan, RAID_SECONDS);
    expect(end.over).toBe(true);
    expect(end.monsters.every((one) => one.gone)).toBe(true);
    expect(raidAt(plan, RAID_SECONDS - 1).over).toBe(false);
  });

  it("never walks into the tower", () => {
    for (let t = 0; t < RAID_SECONDS; t += 0.5) {
      for (const one of raidAt(plan, t).monsters) expect(distance(one, tower)).toBeGreaterThanOrEqual(79);
    }
  });

  it("comes from the east with no Town Hall", () => {
    const alone = planRaid(tower, null);
    expect(alone.monsters.every((one) => one.spawn.x > tower.x)).toBe(true);
  });
});

describe("the Pokeys' walk-in", () => {
  it("walks each from the edge to the door, one after the other, then they are gone", () => {
    const route = { from: { x: 800, y: 100 }, to: { x: 200, y: 100 } };
    expect(walkerAt(route, 0, 0)).toMatchObject({ x: 800, alpha: 1, done: false });
    expect(walkerAt(route, 3, 0).x).toBe(800);
    const late = walkerAt(route, 0, 30);
    expect(late).toMatchObject({ x: 200, y: 100, done: true });
  });
});
