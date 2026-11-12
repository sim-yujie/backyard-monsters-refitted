import { describe, expect, it } from "vitest";
import type { AllianceListing, AllianceMember, MyAlliance, TypeOption } from "@/api/alliance";
import {
  browserTimeZone,
  aboutCount,
  ALLIANCE_DESC_MAX,
  descriptionProblem,
  gateStep,
  gmtLabel,
  joinModeOf,
  membersLine,
  memberActions,
  nameProblem,
  orderMembers,
  pageCount,
  quickJoinPick,
  refusalText,
  renameWait,
  shieldUrl,
  shownMinLevel,
  stepMinLevel,
  stepTimeZone,
  switchSummary,
  TYPE_INFO,
} from "./allianceRules";

/** The alliance window's rules, worked out without the page (beta 7 phase 1). */

const listing = (
  id: number,
  type: AllianceListing["type"],
  members: number,
  limit: number,
  extra: Partial<AllianceListing> = { join_mode: "open" },
): AllianceListing => ({
  alliance_id: id,
  name: `A${id}`,
  image: 1,
  members,
  member_limit: limit,
  active_members: members,
  leader_name: "Lead",
  type,
  ...extra,
});

const member = (id: number, role: AllianceMember["role"], extra: Partial<AllianceMember> = {}): AllianceMember => ({
  user_id: id,
  display_name: `P${id}`,
  pic_square: null,
  level: 10,
  points: 0,
  online: false,
  role,
  ...extra,
});

const LEADER_PERMISSIONS = ["setRank", "handOver", "kickMember", "kickOfficer", "invite", "editAd", "rename", "switchType"];
const OFFICER_PERMISSIONS = ["kickMember", "invite", "editAd"];

describe("type info", () => {
  it("leads each card with the owner's member numbers 15 / 30 / 60 and 2 / 4 / 6 Officers", () => {
    expect(membersLine("midas")).toBe("Up to 15 members");
    expect(membersLine("conquest")).toBe("Up to 30 members");
    expect(membersLine("fortress")).toBe("Up to 60 members");
    expect([TYPE_INFO.midas.officers, TYPE_INFO.conquest.officers, TYPE_INFO.fortress.officers]).toEqual([2, 4, 6]);
  });
});

describe("shieldUrl", () => {
  it("points at Flash's shields and falls back to shield 1 outside 1..41", () => {
    expect(shieldUrl(7)).toBe("/assets/alliances/7_medium.png");
    expect(shieldUrl(7, "small")).toBe("/assets/alliances/7_small.png");
    expect(shieldUrl(0)).toBe("/assets/alliances/1_medium.png");
    expect(shieldUrl(99)).toBe("/assets/alliances/1_medium.png");
  });
});

describe("name and description checks", () => {
  it("wants 3 to 30 letters in a name", () => {
    expect(nameProblem("ab")).not.toBeNull();
    expect(nameProblem("  ab  ")).not.toBeNull();
    expect(nameProblem("Goo Lords")).toBeNull();
    expect(nameProblem("x".repeat(31))).not.toBeNull();
    expect(nameProblem("No #1")).not.toBeNull();
  });

  it("wants a line about the alliance, not a long one", () => {
    expect(descriptionProblem("  ")).not.toBeNull();
    expect(descriptionProblem("We farm goo.")).toBeNull();
    expect(descriptionProblem("x".repeat(120))).toBeNull();
    expect(descriptionProblem(`  ${"x".repeat(120)}  `)).toBeNull();
    expect(descriptionProblem("x".repeat(121))).toBe("At most 120 letters.");
  });
});

describe("aboutCount", () => {
  it("counts up to 120 and marks the last 20, the full line and an older, longer About", () => {
    expect(ALLIANCE_DESC_MAX).toBe(120);
    expect(aboutCount("")).toEqual({ words: "0/120", state: "" });
    expect(aboutCount("x".repeat(37))).toEqual({ words: "37/120", state: "" });
    expect(aboutCount("x".repeat(100))).toEqual({ words: "100/120", state: "near" });
    expect(aboutCount("x".repeat(120))).toEqual({ words: "120/120", state: "full" });
    expect(aboutCount("x".repeat(180))).toEqual({ words: "180/120", state: "over" });
  });
});

describe("quickJoinPick", () => {
  const listings = [listing(1, "midas", 15, 15), listing(2, "conquest", 3, 30), listing(3, "midas", 4, 15)];

  it("asks the first alliance of the type with room, in the server's order", () => {
    expect(quickJoinPick(listings, "midas")?.alliance_id).toBe(3);
    expect(quickJoinPick(listings, "conquest")?.alliance_id).toBe(2);
  });

  it("takes any type with room for Any", () => {
    expect(quickJoinPick(listings, "any")?.alliance_id).toBe(2);
  });

  it("finds none when no alliance of that type has room", () => {
    expect(quickJoinPick(listings, "fortress")).toBeNull();
    expect(quickJoinPick([listing(1, "midas", 15, 15)], "any")).toBeNull();
  });

  it("only joins Open alliances: Ask to join, Invite only and an older server's row are passed over", () => {
    const mixed = [
      listing(1, "midas", 3, 15, { join_mode: "ask" }),
      listing(2, "midas", 3, 15, { join_mode: "invite" }),
      listing(3, "midas", 3, 15, {}),
      listing(4, "midas", 3, 15, { join_mode: "open" }),
    ];
    expect(quickJoinPick(mixed, "midas")?.alliance_id).toBe(4);
    expect(quickJoinPick(mixed.slice(0, 3), "any")).toBeNull();
  });

  it("prefers one in the player's language, else the first that fits", () => {
    const two = [listing(1, "midas", 3, 15, { join_mode: "open", language: "DE" }), listing(2, "midas", 3, 15, { join_mode: "open", language: "PH" })];
    expect(quickJoinPick(two, "any", "PH")?.alliance_id).toBe(2);
    expect(quickJoinPick(two, "any", "FR")?.alliance_id).toBe(1);
    expect(quickJoinPick(two, "any")?.alliance_id).toBe(1);
  });
});

describe("the marketplace ad", () => {
  it("reads an older server's row as Ask to join", () => {
    expect(joinModeOf({})).toBe("ask");
    expect(joinModeOf({ join_mode: "invite" })).toBe("invite");
  });

  it("names GMT bands with their sign", () => {
    expect(gmtLabel(8)).toBe("GMT+8");
    expect(gmtLabel(-5)).toBe("GMT-5");
    expect(gmtLabel(0)).toBe("GMT");
  });

  it("starts from the browser's hour band, kept between -12 and +14", () => {
    expect(browserTimeZone(-480)).toBe(8);
    expect(browserTimeZone(300)).toBe(-5);
    expect(browserTimeZone(-330)).toBe(6);
    expect(browserTimeZone(0)).toBe(0);
    expect(browserTimeZone(-900)).toBe(14);
  });

  it("steps time zones one band and levels by 5, stopping at the ends", () => {
    expect(stepTimeZone(14, 1)).toBe(14);
    expect(stepTimeZone(-12, -1)).toBe(-12);
    expect(stepTimeZone(0, -1)).toBe(-1);
    expect(stepMinLevel(30, 1)).toBe(35);
    expect(stepMinLevel(33, 1)).toBe(35);
    expect(stepMinLevel(33, -1)).toBe(30);
    expect(stepMinLevel(60, 1)).toBe(60);
    expect(stepMinLevel(30, -1)).toBe(30);
  });

  it("shows a minimum level only above 30, which takes anyone", () => {
    expect(shownMinLevel({ min_level: 30 })).toBeNull();
    expect(shownMinLevel({})).toBeNull();
    expect(shownMinLevel({ min_level: 45 })).toBe(45);
  });
});

describe("refusalText and gateStep", () => {
  it("adds the time left on a wait", () => {
    expect(refusalText({ message: "Wait first.", availableAt: 1000 + 3600 }, 1000)).toMatch(/^Wait first\. \(.+ left\)$/);
    expect(refusalText({ message: "Wait first.", availableAt: 500 }, 1000)).toBe("Wait first.");
    expect(refusalText({ message: "No.", availableAt: null }, 1000)).toBe("No.");
  });

  it("sends a missing Observatory to the build menu and Map Room 1 to the map", () => {
    expect(gateStep("noObservatory")).toBe("buildObservatory");
    expect(gateStep("notMapRoom2")).toBe("openMap");
    expect(gateStep("noWorld")).toBe("openMap");
    expect(gateStep("allianceFull")).toBeNull();
  });
});

describe("orderMembers", () => {
  it("puts the Leader, then Officers, then Members; online first in a rank", () => {
    const ordered = orderMembers([
      member(1, "member"),
      member(2, "officer"),
      member(3, "member", { online: true }),
      member(4, "leader"),
    ]);
    expect(ordered.map((row) => row.user_id)).toEqual([4, 2, 3, 1]);
  });
});

describe("memberActions", () => {
  const leaderView = { permissions: LEADER_PERMISSIONS, officer_limit: 2 } as Pick<MyAlliance, "permissions" | "officer_limit">;
  const officerView = { permissions: OFFICER_PERMISSIONS, officer_limit: 2 } as Pick<MyAlliance, "permissions" | "officer_limit">;

  it("gives the Leader promote, hand over and kick on a Member", () => {
    expect(memberActions(leaderView, member(5, "member"), 1, 0)).toEqual(["promote", "handOver", "kick"]);
  });

  it("drops promote when the Officer seats are full", () => {
    expect(memberActions(leaderView, member(5, "member"), 1, 2)).toEqual(["handOver", "kick"]);
  });

  it("gives the Leader demote on an Officer", () => {
    expect(memberActions(leaderView, member(5, "officer"), 1, 1)).toEqual(["demote", "handOver", "kick"]);
  });

  it("lets an Officer kick Members only", () => {
    expect(memberActions(officerView, member(5, "member"), 2, 1)).toEqual(["kick"]);
    expect(memberActions(officerView, member(6, "officer"), 2, 2)).toEqual([]);
  });

  it("gives nobody buttons on themselves or on the Leader", () => {
    expect(memberActions(leaderView, member(1, "leader"), 1, 0)).toEqual([]);
    expect(memberActions(officerView, member(1, "leader"), 2, 1)).toEqual([]);
  });
});

describe("renameWait", () => {
  it("says how long until the next rename, unless an admin asked for one", () => {
    expect(renameWait({ rename_available_at: 2000, must_rename: false }, 1000)).toMatch(/^Rename again in /);
    expect(renameWait({ rename_available_at: 2000, must_rename: true }, 1000)).toBeNull();
    expect(renameWait({ rename_available_at: null, must_rename: false }, 1000)).toBeNull();
  });
});

describe("switchSummary", () => {
  const option = (extra: Partial<TypeOption>): TypeOption => ({
    type: "conquest",
    up: true,
    refusal: null,
    points_after: 0,
    available_at: null,
    ...extra,
  });

  it("calls a bigger type free and at once", () => {
    expect(switchSummary(option({}), 0)).toBe("Free, at once");
  });

  it("says what points a smaller type keeps", () => {
    expect(switchSummary(option({ up: false, points_after: 50 }), 0)).toBe("Keeps 50 points");
  });

  it("says why not, with the wait when there is one", () => {
    expect(switchSummary(option({ refusal: "tooManyMembers" }), 0)).toBe("Too many members");
    expect(switchSummary(option({ refusal: "waitForDownSwitch", available_at: 100 }), 0)).toMatch(/^Changed type recently: /);
    expect(switchSummary(option({ refusal: "somethingNew" }), 0)).toBe("Not now");
  });
});

describe("pageCount", () => {
  it("has at least one page", () => {
    expect(pageCount(0, 10)).toBe(1);
    expect(pageCount(10, 10)).toBe(1);
    expect(pageCount(11, 10)).toBe(2);
  });
});
