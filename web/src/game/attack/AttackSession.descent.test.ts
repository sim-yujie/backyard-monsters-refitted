import { describe, expect, it } from "vitest";

import type { BaseLoadResponse } from "@/api/types";
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
