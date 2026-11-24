import { describe, expect, it } from "vitest";

import { descentAttackLoad, type DescentAttackStart } from "@/api/inferno";
import type { BaseLoadResponse } from "@/api/types";
import { descentRoster, descentTarget } from "@/game/inferno/descentEntry";
import type { Yard } from "@/game/yard/yardModel";
import { AttackSession, descentYardOf, devDescentYard } from "./AttackSession";
import type { AttackTarget } from "./attackTarget";

/** The dev build's `?descentYard=N`, for seeing the Descent burn in a practice (Inferno WP 1.21). */
describe("devDescentYard", () => {
  it("reads a Descent yard from 1 to 13", () => {
    expect(devDescentYard("?descentYard=7")).toEqual({ descentYard: 7 });
    expect(devDescentYard("?x=1&descentYard=13")).toEqual({ descentYard: 13 });
    expect(devDescentYard("?descentYard=1")).toEqual({ descentYard: 1 });
  });

  it("reads nothing else", () => {
    for (const search of [
      "",
      "?descentYard=0",
      "?descentYard=14",
      "?descentYard=7.5",
      "?descentYard=x",
    ]) {
      expect(devDescentYard(search)).toEqual({});
    }
  });
});

/** The Descent yard the server's attack start named, handed to the fight (Inferno WP 1.21). */
describe("descentYardOf", () => {
  it("passes a Descent yard from 1 to 13 and nothing else", () => {
    expect(descentYardOf({ descentYard: 7 })).toEqual({ descentYard: 7 });
    expect(descentYardOf({ descentYard: 1 })).toEqual({ descentYard: 1 });
    expect(descentYardOf({})).toEqual({});
    for (const descentYard of [0, 14, 7.5, Number.NaN]) expect(descentYardOf({ descentYard })).toEqual({});
  });
});

describe("a Descent attack's session burns from yard 7", () => {
  /** An empty yard but for a far-off Silo: nothing shoots, so only the burn hurts. */
  const quietYard = (): BaseLoadResponse =>
    ({
      error: 0,
      id: 1,
      baseid: "207",
      basesaveid: 0,
      worldsize: [800, 800],
      currenttime: 1_700_000_000,
      buildingdata: { "1": { id: 1, t: 6, l: 1, X: -300, Y: -300 } },
      buildinghealthdata: {},
      resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
      attackid: 77,
    }) as unknown as BaseLoadResponse;

  const targetOf = (descentYard?: number): AttackTarget => ({
    baseid: "207",
    kind: "wild",
    name: "Moloch",
    roster: {
      monsters: { C2: 1 },
      levels: {},
      champions: [],
      flingerLevel: 4,
      catapultLevel: 0,
      sources: [],
      siege: null,
      resources: null,
    },
    ...(descentYard === undefined ? {} : { descentYard }),
  });

  /** One Squeaky flung far from the Silo, then 12 seconds: is it burning, and has it lost health? */
  const fought = (descentYard?: number) => {
    const target = targetOf(descentYard);
    const session = new AttackSession({ target, seed: 1 });
    session.load(quietYard());
    session.start();
    session.appendFling({ x: 300, y: 300, monsters: { C2: 1 } });
    for (let frame = 0; frame < 12 * 60; frame += 1) session.advance(1 / 60);
    const creep = session.battle()!.creeps().find((one) => one.monsterId === "C2")!;
    return { burning: creep.burning === true, hurt: creep.hp < creep.maxHp };
  };

  it("burns surface monsters on yard 7 and deeper", () => {
    expect(fought(7)).toEqual({ burning: true, hurt: true });
    expect(fought(13)).toEqual({ burning: true, hurt: true });
  });

  it("does not burn on yards 1 to 6 or outside the Descent", () => {
    for (const yard of [1, 6, undefined]) expect(fought(yard)).toEqual({ burning: false, hurt: false });
  });
});

/**
 * Krallen's Krallen Hunt loot aura in the Descent (descent-aura, 24 Nov 2026).
 * The server's replay gives it to her when her `la` runs past the attack's
 * start (its session's `startedat`); the Descent start answer now carries that
 * start as `currenttime`, which the load hands the page, so the page flings
 * her with it exactly then. Before, the answer had no clock: the page fought
 * without the aura and the save disagreed with the replay.
 */
describe("a Descent attack gives Krallen her loot aura as the server's replay does", () => {
  const STARTED = 1_795_600_000;

  const startOf = (currenttime?: number): DescentAttackStart => ({
    error: 0,
    kind: "descent",
    yardkind: "inferno",
    attackid: 55,
    descentyard: 3,
    level: 3,
    base: {
      baseid: "203",
      type: "iwm",
      worldsize: [800, 800],
      buildingdata: { "1": { id: 1, t: 6, l: 1, X: -300, Y: -300 } },
      buildinghealthdata: {},
      resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
    } as unknown as Partial<BaseLoadResponse>,
    defenderforces: { bunkers: [] },
    attackeracademy: {},
    flingercapacity: 120,
    ...(currenttime === undefined ? {} : { currenttime }),
  });

  /** The main yard's save, its Krallen's aura running out at `la`. */
  const ownSave = (la: number): BaseLoadResponse =>
    ({
      baseid: "1234",
      monsters: { housed: { C2: 5 } },
      champion: [{ t: 5, l: 1, hp: 20_000, pl: 0, fb: 0, ft: 0, fd: 0, status: 0, la }],
      academy: {},
    }) as unknown as BaseLoadResponse;
  const ownYard = { buildings: [{ type: 5, level: 3 }] } as unknown as Yard;

  /** Krallen flung on the page's own path into a Descent attack: what the log records for her. */
  const flungKrallen = (la: number, currenttime?: number) => {
    const start = startOf(currenttime);
    const target = descentTarget(start, "203", descentRoster(ownSave(la), ownYard));
    const session = new AttackSession({ target, seed: 1, ...descentYardOf({ descentYard: start.descentyard }) });
    session.start();
    const drop = session.appendFling({ x: 300, y: 300, monsters: {}, champion: { t: 5, l: 1, s: "offensive" } });
    return { aura: drop.champion?.aura === true, sign: session.hasLootAura(5) };
  };

  it("hands the start's clock to the load", () => {
    expect(descentAttackLoad(startOf(STARTED)).currenttime).toBe(STARTED);
    expect(descentAttackLoad(startOf()).currenttime).toBeUndefined();
  });

  it("flings Krallen with the aura when it runs past the attack's start", () => {
    expect(flungKrallen(STARTED + 1, STARTED)).toEqual({ aura: true, sign: true });
    expect(flungKrallen(STARTED + 86_400, STARTED)).toEqual({ aura: true, sign: true });
  });

  it("flings her without it when it ran out by the start, as the replay's `la > startedat`", () => {
    expect(flungKrallen(STARTED, STARTED)).toEqual({ aura: false, sign: false });
    expect(flungKrallen(STARTED - 60, STARTED)).toEqual({ aura: false, sign: false });
  });

  it("flings her without it from an older server's answer, which has no clock", () => {
    expect(flungKrallen(STARTED + 86_400)).toEqual({ aura: false, sign: false });
  });
});
