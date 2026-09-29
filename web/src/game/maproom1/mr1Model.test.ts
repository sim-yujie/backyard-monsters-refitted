import { describe, expect, it } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import { defaultAvatar } from "@/game/avatars";
import { mapRoom1Fixture } from "./mr1Fixture";
import {
  attackGate,
  battlesText,
  flingerState,
  formatAgo,
  formatRespawn,
  formatSpan,
  initials,
  mr1AttackTarget,
  pageOf,
  pinTone,
  presenceText,
  readMapRoom1,
  readOwn,
  ReasonKey,
  rowLine,
  sortNeighbours,
  type Mr1Neighbour,
  type Mr1Own,
} from "./mr1Model";

const NOW = 1_800_000_000;
const world = readMapRoom1(mapRoom1Fixture(NOW), NOW);
const named = (name: string): Mr1Neighbour =>
  world.neighbours.find((one) => one.name === name)!;

const yardLoad = (extra: Partial<BaseLoadResponse> = {}): BaseLoadResponse => ({
  error: 0,
  id: 1,
  baseid: "5001",
  basesaveid: 1,
  worldsize: [800, 800],
  currenttime: NOW,
  savetime: NOW,
  level: 6,
  name: "Me",
  buildingdata: {
    "1": { id: 1, t: 14, l: 1, X: 0, Y: 0 },
    "2": { id: 2, t: 5, l: 1, X: 60, Y: 60 },
  },
  monsters: { housed: { C1: 16, C3: 6, C5: 0 } },
  ...extra,
});

const ready: Mr1Own = readOwn(yardLoad());

describe("readMapRoom1", () => {
  it("reads the four tribes with their names and the wrecked one's comeback", () => {
    expect(world.tribes.map((tribe) => tribe.name)).toEqual([
      "Legionnaire Tribe",
      "Kozu Tribe",
      "Abunakki Tribe",
      "Dreadnaut Tribe",
    ]);
    const abunakki = world.tribes[2]!;
    expect(abunakki.wrecked).toBe(true);
    expect(abunakki.respawnAt).toBe(NOW + 432);
    expect(world.protectedUntil).toBe(NOW + 187_200);
  });

  it("places a tribe from its base id when the name is missing, and drops duplicates and strangers", () => {
    const read = readMapRoom1(
      {
        error: 0,
        tribes: [
          { baseid: 43, level: 3 },
          { baseid: "12", tribe: "Kozu", level: 4 },
          { baseid: 999, level: 1 },
          { baseid: 105, level: 2, destroyed: true },
        ],
      },
      NOW,
    );
    expect(read.tribes.map((tribe) => [tribe.tribe, tribe.level, tribe.wrecked])).toEqual([
      ["kozu", 3, false],
      ["dreadnaut", 2, true],
    ]);
    expect(read.now).toBe(NOW);
    expect(read.neighbours).toEqual([]);
  });

  it("reads a truce from the permission or the accepted state", () => {
    expect(named("Fernwick").truceUntil).toBe(NOW + 9 * 86_400);
    expect(named("Grimble").truceUntil).toBeNull();
  });

  it("reads a neighbour's picked critter, and gives the rest their default (#175)", () => {
    expect(named("Mossbeard").avatar).toBe("owl");
    expect(named("Grimble").avatar).toBe(defaultAvatar(903));
  });
});

describe("readOwn", () => {
  it("reads the housed monsters, most first, and a ready Flinger", () => {
    expect(ready.army).toEqual([
      { id: "C1", count: 16 },
      { id: "C3", count: 6 },
    ]);
    expect(ready.flinger).toEqual({ state: "ready", level: 1 });
    expect(ready.level).toBe(6);
    expect(ready.baseid).toBe("5001");
  });

  it("knows a missing, upgrading, damaged and first-build Flinger", () => {
    expect(flingerState(yardLoad({ buildingdata: {} }))).toEqual({ state: "none" });
    expect(
      flingerState(
        yardLoad({ buildingdata: { "2": { id: 2, t: 5, l: 1, X: 0, Y: 0, cB: 30 } } }),
      ),
    ).toEqual({
      state: "none",
    });
    expect(
      flingerState(
        yardLoad({ buildingdata: { "2": { id: 2, t: 5, l: 1, X: 0, Y: 0, cU: 300 } } }),
      ),
    ).toEqual({
      state: "busy",
      why: "upgrading",
    });
    expect(
      flingerState(
        yardLoad({
          buildingdata: { "2": { id: 2, t: 5, l: 1, X: 0, Y: 0 } },
          buildinghealthdata: { "2": 1 },
        }),
      ),
    ).toEqual({ state: "busy", why: "damaged" });
  });
});

describe("attackGate", () => {
  const tribe = world.tribes[1]!;
  const wrecked = world.tribes[2]!;

  it("lets a ready yard attack a standing tribe with no warning, even while protected", () => {
    expect(attackGate(tribe, ready, world, NOW)).toEqual({
      reason: null,
      warning: null,
      viewOff: null,
    });
  });

  it("warns that attacking a player ends your protection", () => {
    const gate = attackGate(named("Mossbeard"), ready, world, NOW);
    expect(gate.reason).toBeNull();
    expect(gate.warning).toEqual({
      strong: "You are protected for 2 d 4 h.",
      rest: "Attacking Mossbeard ends your protection, and others can attack you again.",
    });
    expect(
      attackGate(named("Mossbeard"), ready, { protectedUntil: 0 }, NOW).warning,
    ).toBeNull();
  });

  it("names the target's reason first, then your Flinger, then your monsters", () => {
    const none = readOwn(yardLoad({ buildingdata: {} }));
    expect(attackGate(wrecked, none, world, NOW).reason?.key).toBe(ReasonKey.WRECKED);
    expect(attackGate(named("Nettlejaw"), none, world, NOW).reason?.key).toBe(
      ReasonKey.NEW_PLAYER,
    );
    expect(attackGate(tribe, none, world, NOW).reason).toMatchObject({
      key: ReasonKey.NO_FLINGER,
      action: "buildFlinger",
    });
    const busy = readOwn(
      yardLoad({
        buildingdata: { "2": { id: 2, t: 5, l: 1, X: 0, Y: 0, cU: 60 } },
        monsters: { housed: {} },
      }),
    );
    expect(attackGate(tribe, busy, world, NOW).reason?.key).toBe(ReasonKey.FLINGER_BUSY);
    const empty = readOwn(yardLoad({ monsters: { housed: {} } }));
    expect(attackGate(tribe, empty, world, NOW).reason).toMatchObject({
      key: ReasonKey.NO_MONSTERS,
      action: "hatch",
    });
    expect(attackGate(wrecked, empty, world, NOW).reason?.key).toBe(ReasonKey.WRECKED);
    const champion = readOwn(
      yardLoad({
        monsters: { housed: {} },
        champion: [{ t: 1, l: 1, hp: 100, status: 0 } as never],
      }),
    );
    expect(attackGate(tribe, champion, world, NOW).reason).toBeNull();
  });

  it("says why each neighbour cannot be attacked", () => {
    const reason = (name: string) => attackGate(named(name), ready, world, NOW).reason;
    expect(reason("Bramblefoot")?.key).toBe(ReasonKey.PLAYING);
    expect(reason("Nettlejaw")).toMatchObject({
      key: ReasonKey.NEW_PLAYER,
      detail: "Protected for 5 d more, or until they attack someone.",
    });
    expect(reason("Toadstool")?.detail).toBe(
      "Recently wrecked. Protected for 31 h so they can rebuild.",
    );
    expect(reason("Wartwhistle")?.detail).toBe(
      "Grimble is attacking them now. Try again in a few minutes. View is off too.",
    );
    expect(attackGate(named("Wartwhistle"), ready, world, NOW).viewOff).not.toBeNull();
    expect(reason("Fernwick")).toMatchObject({
      key: ReasonKey.TRUCE,
      detail: "Neither of you can attack the other for 9 d more.",
    });
    expect(attackGate(wrecked, ready, world, NOW).reason?.detail).toBe(
      "Its camp comes back in 7:12.",
    );
  });

  it("counts a wrecked camp down with the clock", () => {
    expect(attackGate(wrecked, ready, world, NOW + 400).reason?.detail).toBe(
      "Its camp comes back in 0:32.",
    );
  });
});

describe("words", () => {
  it("formats spans, comebacks and ages", () => {
    expect(formatSpan(2 * 86_400 + 4 * 3_600 + 59)).toBe("2 d 4 h");
    expect(formatSpan(5 * 86_400)).toBe("5 d");
    expect(formatSpan(31 * 3_600)).toBe("31 h");
    expect(formatSpan(90)).toBe("2 min");
    expect(formatRespawn(432)).toBe("7:12");
    expect(formatRespawn(0)).toBe("0:00");
    expect(formatAgo(30)).toBe("just now");
    expect(formatAgo(3 * 3_600)).toBe("3 h ago");
    expect(formatAgo(5 * 86_400)).toBe("5 d ago");
  });

  it("describes presence and battles", () => {
    expect(presenceText(named("Bramblefoot"), NOW)).toBe("Playing now");
    expect(presenceText(named("Mossbeard"), NOW)).toBe("Offline · last seen 3 h ago");
    expect(battlesText(named("Mossbeard"))).toBe("Attacked you 2 times · you attacked 1");
    expect(battlesText(named("Grimble"))).toBe("No battles yet");
    expect(battlesText(named("Wartwhistle"))).toBe("You attacked them 3 times");
  });

  it("colours pins by what can be done", () => {
    expect(pinTone(named("Mossbeard"))).toBe("attacked");
    expect(pinTone(named("Nettlejaw"))).toBe("protected");
    expect(pinTone(named("Grimble"))).toBe("neighbour");
    expect(pinTone(world.tribes[0]!)).toBe("tribe");
    expect(pinTone(world.tribes[2]!)).toBe("wrecked");
  });

  it("makes two-letter initials", () => {
    expect(initials("Mossbeard")).toBe("MO");
    expect(initials("Pip Squeak")).toBe("PS");
    expect(initials("BrambleFoot")).toBe("BF");
    expect(initials("x")).toBe("X");
  });

  it("writes the list's second line", () => {
    expect(rowLine(named("Mossbeard"), NOW)).toEqual({
      text: "Attacked you 2× · offline 3 h",
      tone: "warn",
    });
    expect(rowLine(named("Bramblefoot"), NOW).text).toBe("Playing now · can't attack");
    expect(rowLine(named("Grimble"), NOW).text).toBe("Offline 24 h · no battles yet");
    expect(rowLine(named("Nettlejaw"), NOW).text).toBe("New player · protected 5 d");
  });
});

describe("the list", () => {
  it("sorts by each key with the name breaking ties", () => {
    const names = (sort: Parameters<typeof sortNeighbours>[1]) =>
      sortNeighbours(world.neighbours, sort, NOW).map((one) => one.name);
    expect(names("level").slice(0, 3)).toEqual(["Mossbeard", "Bramblefoot", "Grimble"]);
    expect(names("name")[0]).toBe("Bramblefoot");
    expect(names("seen")[0]).toBe("Bramblefoot");
    expect(names("battles").slice(0, 2)).toEqual(["Mossbeard", "Wartwhistle"]);
    expect(names("status").slice(0, 2)).toEqual(["Mossbeard", "Sludgepot"]);
  });

  it("pages seven at a time and clamps the page", () => {
    const sorted = sortNeighbours(world.neighbours, "name", NOW);
    expect(pageOf(sorted, 0).items).toHaveLength(7);
    expect(pageOf(sorted, 1)).toMatchObject({ page: 1, pages: 2 });
    expect(pageOf(sorted, 1).items).toHaveLength(2);
    expect(pageOf(sorted, 9).page).toBe(1);
    expect(pageOf([], 3)).toEqual({ items: [], page: 0, pages: 1 });
  });
});

describe("mr1AttackTarget (#132)", () => {
  it("hands a tribe over as a wild camp on Map Room 1 with the main yard's roster", () => {
    const attack = mr1AttackTarget(world.tribes[1]!, yardLoad(), world, NOW);
    expect(attack).toMatchObject({
      baseid: "11",
      kind: "wild",
      name: "Kozu Tribe",
      mapversion: 1,
    });
    expect(attack?.cell).toBeUndefined();
    expect(attack?.roster.monsters).toEqual({ C1: 16, C3: 6 });
    expect(attack?.roster.sources).toEqual([
      { baseid: "5001", m: { housed: { C1: 16, C3: 6, C5: 0 } } },
    ]);
    expect(attack?.roster.flingerLevel).toBe(1);
  });

  it("hands a neighbour over as a main yard", () => {
    expect(mr1AttackTarget(named("Mossbeard"), yardLoad(), world, NOW)).toMatchObject({
      baseid: "90101",
      kind: "main",
      mapversion: 1,
    });
  });

  it("gives nothing when the gate is shut or the own yard is not known", () => {
    expect(mr1AttackTarget(world.tribes[2]!, yardLoad(), world, NOW)).toBeNull();
    expect(mr1AttackTarget(named("Nettlejaw"), yardLoad(), world, NOW)).toBeNull();
    expect(
      mr1AttackTarget(world.tribes[1]!, yardLoad({ buildingdata: {} }), world, NOW),
    ).toBeNull();
    expect(mr1AttackTarget(world.tribes[1]!, null, world, NOW)).toBeNull();
  });
});
