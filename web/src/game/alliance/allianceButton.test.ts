import { beforeEach, describe, expect, it } from "vitest";

import { OBSERVATORY_TYPE } from "@/game/yard/recycle";

import { allianceButtonShows, hasObservatory, inAlliance, resetAllianceButton, setInAlliance } from "./allianceButton";

const observatory = (level: number) => ({ type: OBSERVATORY_TYPE, level });
const townHall = { type: 14, level: 5 };

const main = (buildings: { type: number; level: number }[], mapRoom2 = true) =>
  allianceButtonShows({ kind: "main", mapRoom2, buildings });
const outpost = () => allianceButtonShows({ kind: "outpost", mapRoom2: true, buildings: [] });

beforeEach(() => resetAllianceButton());

describe("the Alliance button in the More menu", () => {
  it("is hidden before the Observatory is built", () => {
    expect(main([townHall])).toBe(false);
  });

  it("stays hidden while the Observatory is still being built", () => {
    expect(hasObservatory([observatory(0)])).toBe(false);
    expect(main([townHall, observatory(0)])).toBe(false);
  });

  it("shows once the Observatory is finished", () => {
    expect(main([townHall, observatory(0)])).toBe(false);
    expect(main([townHall, observatory(1)])).toBe(true);
  });

  it("hides again when the Observatory is recycled and the player is in no alliance", () => {
    expect(main([observatory(2)])).toBe(true);
    expect(main([townHall])).toBe(false);
  });

  it("shows for a player already in an alliance who has no Observatory", () => {
    setInAlliance(true);
    expect(inAlliance()).toBe(true);
    expect(main([townHall])).toBe(true);
    setInAlliance(false); // left, or kicked
    expect(main([townHall])).toBe(false);
  });

  it("never shows on Map Room 1, whatever stands in the yard", () => {
    setInAlliance(true);
    expect(main([observatory(3)], false)).toBe(false);
  });

  it("never shows in the Inferno", () => {
    setInAlliance(true);
    main([observatory(1)]);
    expect(allianceButtonShows({ kind: "inferno", mapRoom2: true, buildings: [] })).toBe(false);
  });

  it("shows on an outpost when the main yard has a finished Observatory", () => {
    expect(outpost()).toBe(false);
    main([observatory(1)]);
    expect(outpost()).toBe(true);
  });

  it("shows on an outpost for a member, and not for a player with neither", () => {
    main([townHall]);
    expect(outpost()).toBe(false);
    setInAlliance(true);
    expect(outpost()).toBe(true);
  });

  it("an outpost's own buildings never count as the Observatory", () => {
    main([townHall]);
    expect(allianceButtonShows({ kind: "outpost", mapRoom2: true, buildings: [observatory(1)] })).toBe(false);
  });
});
