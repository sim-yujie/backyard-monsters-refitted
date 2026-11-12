import { describe, expect, test } from "bun:test";

import { AllianceJoinMode } from "../../enums/Alliance.js";
import { adOf, adRefusal } from "./allianceAd.js";

describe("the marketplace ad's rules (design v5 §7a)", () => {
  test("Invite only refuses every ask, whatever the level", () => {
    expect(adRefusal({ join_mode: AllianceJoinMode.INVITE, min_level: 30 }, 60)).toBe("inviteOnly");
  });

  test("the level floor, 30, takes a player of any level, even an unknown one", () => {
    expect(adRefusal({ join_mode: AllianceJoinMode.OPEN, min_level: 30 }, 1)).toBeNull();
    expect(adRefusal({ join_mode: AllianceJoinMode.ASK, min_level: 30 }, null)).toBeNull();
  });

  test("a higher minimum refuses a lower player and takes one at or above it", () => {
    expect(adRefusal({ join_mode: AllianceJoinMode.OPEN, min_level: 40 }, 39)).toBe("lowLevel");
    expect(adRefusal({ join_mode: AllianceJoinMode.ASK, min_level: 40 }, null)).toBe("lowLevel");
    expect(adRefusal({ join_mode: AllianceJoinMode.ASK, min_level: 40 }, 40)).toBeNull();
  });

  test("a row from before the ad reads as Ask to join, any language, level 30", () => {
    expect(adOf({} as never)).toEqual({ join_mode: AllianceJoinMode.ASK, language: null, time_zone: null, min_level: 30 });
  });
});
