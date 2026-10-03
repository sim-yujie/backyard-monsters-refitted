import { describe, expect, test } from "bun:test";

import { AttackPermission } from "../../enums/MapRoom.js";
import type { NeighbourData } from "../../types/NeighbourData.js";
import {
  MIN_ATTACKABLE,
  carryAttackCounters,
  needsAttackableRetry,
  needsNewNeighbours,
} from "./neighbourCache.js";

const NOW = new Date("2026-10-03T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60 * 1000);
const daysAgo = (days: number) => minutesAgo(days * 24 * 60);

const neighbour = (userid: number, extra: Partial<NeighbourData> = {}): NeighbourData => ({
  userid,
  baseid: `${userid}00`,
  level: 5,
  username: `player${userid}`,
  attacksTodayCount: 0,
  attacksTodayDate: 0,
  attacksfrom: 0,
  attacksto: 0,
  retaliatecount: 0,
  attackpermitted: AttackPermission.ATTACKABLE,
  ...extra,
});

const list = (count: number, attackpermitted = AttackPermission.ATTACKABLE) =>
  Array.from({ length: count }, (_, i) => neighbour(i + 1, { attackpermitted }));

describe("needsNewNeighbours", () => {
  test("searches a list never searched", () => {
    expect(needsNewNeighbours({ neighbors: list(25) }, NOW)).toBe(true);
  });

  test("keeps a healthy list for two weeks", () => {
    expect(needsNewNeighbours({ neighbors: list(10), neighborsLastCalculated: daysAgo(13) }, NOW)).toBe(false);
    expect(needsNewNeighbours({ neighbors: list(10), neighborsLastCalculated: daysAgo(15) }, NOW)).toBe(true);
  });

  test("retries a thin list after 30 minutes", () => {
    expect(needsNewNeighbours({ neighbors: list(9), neighborsLastCalculated: minutesAgo(29) }, NOW)).toBe(false);
    expect(needsNewNeighbours({ neighbors: list(9), neighborsLastCalculated: minutesAgo(31) }, NOW)).toBe(true);
  });
});

describe("needsAttackableRetry (issue #236)", () => {
  const mostlyProtected = [
    ...list(MIN_ATTACKABLE - 1),
    ...list(20, AttackPermission.DAMAGE_PROTECTION),
  ];

  test("retries a list with fewer than 5 attackable once the 30 minutes have passed", () => {
    expect(needsAttackableRetry(mostlyProtected, minutesAgo(31), NOW)).toBe(true);
    expect(needsAttackableRetry(mostlyProtected, minutesAgo(29), NOW)).toBe(false);
  });

  test("leaves a list with 5 attackable alone, however old within the cache", () => {
    const enough = [...list(MIN_ATTACKABLE), ...list(20, AttackPermission.DAMAGE_PROTECTION)];
    expect(needsAttackableRetry(enough, daysAgo(10), NOW)).toBe(false);
  });

  test("counts only neighbours attackable now: truce, protection and attacks in progress do not count", () => {
    const blocked = [
      ...list(2),
      neighbour(90, { attackpermitted: AttackPermission.TRUCE_ACTIVE }),
      neighbour(91, { attackpermitted: AttackPermission.SPECIAL_PROTECTION }),
      neighbour(92, { attackpermitted: AttackPermission.UNDER_ATTACK }),
      neighbour(93, { attackpermitted: AttackPermission.DAMAGE_PROTECTION }),
    ];
    expect(needsAttackableRetry(blocked, minutesAgo(60), NOW)).toBe(true);
  });
});

describe("carryAttackCounters", () => {
  test("a re-search keeps the counters of neighbours who stay and starts new ones at zero", () => {
    const previous = [
      neighbour(2, { attacksfrom: 3, attacksto: 1, retaliatecount: 2, level: 4 }),
      neighbour(3, { attacksfrom: 1 }),
    ];
    const found = [neighbour(2, { level: 6 }), neighbour(4)];

    expect(carryAttackCounters(previous, found)).toEqual([
      neighbour(2, { attacksfrom: 3, attacksto: 1, retaliatecount: 2, level: 6 }),
      neighbour(4),
    ]);
  });
});
