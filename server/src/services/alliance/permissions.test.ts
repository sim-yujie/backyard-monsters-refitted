import { describe, expect, test } from "bun:test";

import { AllianceRole } from "../../enums/Alliance.js";
import { ALLIANCE_PERMISSIONS, AllianceAction, allowedActions, can, canKick } from "./permissions.js";

describe("alliance permission table", () => {
  test("every action has a row, and the Leader may do all of them", () => {
    for (const action of Object.values(AllianceAction)) {
      expect(ALLIANCE_PERMISSIONS[action]).toBeDefined();
      expect(can(AllianceRole.LEADER, action)).toBe(true);
    }
  });

  test("Officers invite, answer requests, kick Members and edit the ad, and nothing the Leader alone does", () => {
    const officer = allowedActions(AllianceRole.OFFICER).sort();

    expect(officer).toEqual(
      [
        AllianceAction.INVITE,
        AllianceAction.ANSWER_REQUEST,
        AllianceAction.KICK_MEMBER,
        AllianceAction.EDIT_AD,
        AllianceAction.SUGGESTED_MEMBERS,
      ].sort()
    );
  });

  test("Members and outsiders may do none of them", () => {
    expect(allowedActions(AllianceRole.MEMBER)).toEqual([]);
    expect(allowedActions(null)).toEqual([]);
    expect(allowedActions(undefined)).toEqual([]);
  });

  test("Officers cannot kick Officers or the Leader; nobody kicks the Leader", () => {
    expect(canKick(AllianceRole.OFFICER, AllianceRole.MEMBER)).toBe(true);
    expect(canKick(AllianceRole.OFFICER, AllianceRole.OFFICER)).toBe(false);
    expect(canKick(AllianceRole.OFFICER, AllianceRole.LEADER)).toBe(false);
    expect(canKick(AllianceRole.LEADER, AllianceRole.OFFICER)).toBe(true);
    expect(canKick(AllianceRole.LEADER, AllianceRole.LEADER)).toBe(false);
    expect(canKick(AllianceRole.MEMBER, AllianceRole.MEMBER)).toBe(false);
  });
});
