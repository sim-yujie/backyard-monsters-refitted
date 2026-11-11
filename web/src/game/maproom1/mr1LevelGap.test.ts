import { describe, expect, it } from "vitest";
import { AttackPermission, type MapRoom1NeighbourWire } from "@/api/maproom1";
import {
  attackGate,
  battleCounts,
  MR1_LEVEL_GAP,
  readMapRoom1,
  ReasonKey,
  rowLine,
  type Mr1Own,
} from "./mr1Model";

/**
 * Map Room 1's neighbour + level gap rule (owner, 11 Nov 2026): the server
 * sends each neighbour's code (`attackpermitted`) and vengeance; the card
 * greys Attack with why for a yard too far below, and counts vengeance.
 */

const NOW = 1_800_000_000;

const wire = (userid: number, level: number, extra: Partial<MapRoom1NeighbourWire> = {}): MapRoom1NeighbourWire => ({
  userid,
  baseid: `${userid}00`,
  level,
  username: `P${userid}`,
  saved: NOW - 3 * 3600,
  online: 0,
  ...extra,
});

const world = readMapRoom1(
  {
    error: 0,
    now: NOW,
    level: 20,
    protectedUntil: 0,
    tribes: [],
    neighbours: [
      wire(1, 15, { attackpermitted: AttackPermission.ATTACKABLE }),
      wire(2, 12, { attackpermitted: AttackPermission.LEVEL_RESTRICTION }),
      wire(3, 12, { attackpermitted: AttackPermission.VENGEANCE_MODE, vengeance: 2, attacksfrom: 2 }),
      wire(4, 28, { attackpermitted: AttackPermission.HIGHER_LEVEL }),
    ],
  },
  NOW,
);

const player = (userid: number) => world.neighbours.find((one) => one.userid === userid)!;

const own: Mr1Own = {
  baseid: "5001",
  seed: 0,
  name: "Me",
  level: 20,
  protectedUntil: 0,
  flinger: { state: "ready", level: 1 },
  army: [{ id: "C1", count: 16 }],
  champion: false,
};

describe("the level gap on the Attack gate", () => {
  it("the gap shown is the server's 7", () => {
    expect(MR1_LEVEL_GAP).toBe(7);
  });

  it("a yard more than 7 below: Attack off, \"Too low\"", () => {
    expect(attackGate(player(2), own, world, NOW).reason).toEqual({
      key: ReasonKey.LEVEL_GAP,
      title: "Too low",
      detail: "More than 7 levels below you.",
    });
    expect(rowLine(player(2), NOW)).toBe("Too low · 7+ levels below");
  });

  it("in the gap, far above, or with vengeance: Attack on", () => {
    for (const userid of [1, 3, 4]) {
      expect(attackGate(player(userid), own, world, NOW).reason).toBeNull();
    }
  });
});

describe("vengeance", () => {
  it("is read off the wire", () => {
    expect(player(3).vengeance).toBe(2);
    expect(player(1).vengeance).toBe(0);
  });

  it("counts as a badge only where it opens Attack", () => {
    expect(battleCounts(player(3))).toContainEqual({
      kind: "vengeance",
      count: 2,
      label: "Vengeance: you can hit back 2 times",
    });
    const inGap = { ...player(1), vengeance: 1 };
    expect(battleCounts(inGap).some((one) => one.kind === "vengeance")).toBe(false);
  });
});
