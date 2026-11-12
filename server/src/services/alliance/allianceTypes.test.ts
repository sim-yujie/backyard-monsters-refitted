import { describe, expect, test } from "bun:test";

import { AllianceType } from "../../enums/Alliance.js";
import {
  memberLimit,
  officerLimit,
  pointsAfterSwitch,
  quoteTypeSwitch,
  typeSwitchOptions,
  type TypeSwitchState,
} from "./allianceTypes.js";

const NOW = new Date("2026-11-20T12:00:00Z");
const DAY = 24 * 3600 * 1000;

const state = (over: Partial<TypeSwitchState> = {}): TypeSwitchState => ({
  type: AllianceType.MIDAS,
  points: 100,
  points_spent: 1200,
  type_changed_at: null,
  members: 10,
  officers: 1,
  ...over,
});

describe("alliance types", () => {
  test("member and Officer limits are 15 / 30 / 60 and 2 / 4 / 6", () => {
    expect([AllianceType.MIDAS, AllianceType.CONQUEST, AllianceType.FORTRESS].map(memberLimit)).toEqual([15, 30, 60]);
    expect([AllianceType.MIDAS, AllianceType.CONQUEST, AllianceType.FORTRESS].map(officerLimit)).toEqual([2, 4, 6]);
  });

  test("up keeps every point and converts by member limit: Midas 100 = Conquest 200 = Fortress 400", () => {
    expect(pointsAfterSwitch(state({ points: 100, points_spent: 0 }), AllianceType.CONQUEST)).toBe(200);
    expect(pointsAfterSwitch(state({ points: 100, points_spent: 0 }), AllianceType.FORTRESS)).toBe(400);
    expect(pointsAfterSwitch(state(), AllianceType.CONQUEST)).toBe(2600);
  });

  test("down keeps half the spent points and all unspent, then converts", () => {
    const fortress = state({ type: AllianceType.FORTRESS, points: 400, points_spent: 800 });

    // (400 + 800 / 2) x 15 / 60 = 200
    expect(pointsAfterSwitch(fortress, AllianceType.MIDAS)).toBe(200);
    // (400 + 400) x 30 / 60 = 400
    expect(pointsAfterSwitch(fortress, AllianceType.CONQUEST)).toBe(400);
  });

  test("an up switch is free at once, even right after another switch", () => {
    const quote = quoteTypeSwitch(state({ type_changed_at: new Date(NOW.getTime() - DAY) }), AllianceType.FORTRESS, NOW);

    expect(quote).toMatchObject({ up: true, refusal: null, available_at: null });
  });

  test("a down switch waits 14 days after the last switch", () => {
    const changed = new Date(NOW.getTime() - 3 * DAY);
    const fortress = state({ type: AllianceType.FORTRESS, type_changed_at: changed });

    const quote = quoteTypeSwitch(fortress, AllianceType.CONQUEST, NOW);

    expect(quote.refusal).toBe("waitForDownSwitch");
    expect(quote.available_at).toBe((changed.getTime() + 14 * DAY) / 1000);
    expect(quoteTypeSwitch(fortress, AllianceType.CONQUEST, new Date(changed.getTime() + 14 * DAY)).refusal).toBeNull();
  });

  test("founding does not start the down-switch wait", () => {
    const fortress = state({ type: AllianceType.FORTRESS, type_changed_at: null });

    expect(quoteTypeSwitch(fortress, AllianceType.MIDAS, NOW).refusal).toBeNull();
  });

  test("a type smaller than the member count, or with fewer Officer seats, is refused", () => {
    const big = state({ type: AllianceType.FORTRESS, members: 20, officers: 1 });
    expect(quoteTypeSwitch(big, AllianceType.MIDAS, NOW).refusal).toBe("tooManyMembers");
    expect(quoteTypeSwitch(big, AllianceType.CONQUEST, NOW).refusal).toBeNull();

    const officers = state({ type: AllianceType.FORTRESS, members: 10, officers: 3 });
    expect(quoteTypeSwitch(officers, AllianceType.MIDAS, NOW).refusal).toBe("tooManyOfficers");
  });

  test("the same type is refused; the options list the other two, smallest first", () => {
    expect(quoteTypeSwitch(state(), AllianceType.MIDAS, NOW).refusal).toBe("sameType");
    expect(typeSwitchOptions(state({ type: AllianceType.CONQUEST }), NOW).map((one) => one.type)).toEqual([
      AllianceType.MIDAS,
      AllianceType.FORTRESS,
    ]);
  });
});
