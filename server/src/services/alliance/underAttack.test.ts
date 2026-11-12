import { describe, expect, test } from "bun:test";
import { AllianceMessageType } from "../../enums/Alliance.js";
import { BaseType } from "../../enums/Base.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";
import type { User } from "../../database/models/user.model.js";

/**
 * Under-attack alerts (beta 7 alliances design v5 §12): an attack on a
 * member's yard or outpost puts "Ana_B's outpost (12, 40) is under attack by
 * Bob!" in their Alliance chat room, with the cell for Show on map.
 */

const { underAttackShout } = await import("./underAttack.js");
const { composeShout, readUnderAttack, shoutCell } = await import("./shoutText.js");

const ANA = { userid: 11, username: "Ana_B", alliance_id: 4 } as User;
const BOB = { userid: 22, username: "Bob" };

const input = (over: Partial<Parameters<typeof underAttackShout>[0]> = {}) => ({
  defender: ANA,
  attacker: BOB,
  baseType: BaseType.OUTPOST,
  mapversion: MapRoomVersion.V2,
  cell: { x: 12, y: 40 },
  ...over,
});

describe("underAttackShout", () => {
  test("an attack on a member's outpost: a line in their alliance, in their name", () => {
    const shout = underAttackShout(input());
    expect(shout).not.toBeNull();
    expect(shout!.allianceId).toBe(4);
    expect(shout!.author).toBe(ANA);
    expect(shout!.type).toBe(AllianceMessageType.UNDER_ATTACK);
    expect(readUnderAttack(shout!.body)).toEqual({ x: 12, y: 40, outpost: true, by: "Bob" });
  });

  test("a main yard says yard; Map Room 2's default (no version sent) counts", () => {
    const shout = underAttackShout(input({ baseType: BaseType.MAIN, mapversion: undefined }));
    expect(readUnderAttack(shout!.body)).toEqual({ x: 12, y: 40, outpost: false, by: "Bob" });
  });

  test.each([
    ["the owner is in no alliance", { defender: { ...ANA, alliance_id: null } as User }],
    ["a wild monster camp", { baseType: BaseType.TRIBE }],
    ["Map Room 1", { mapversion: MapRoomVersion.V1 }],
    ["the cell is not known", { cell: null }],
    ["the player's own yard", { attacker: { userid: 11, username: "Ana_B" } }],
  ])("no line when %s", (_name, over) => {
    expect(underAttackShout(input(over))).toBeNull();
  });
});

describe("the under-attack line's words and cell", () => {
  const body = JSON.stringify({ x: 12, y: 40, outpost: true, by: "Bob" });

  test("reads as the design's sentence", () => {
    expect(composeShout(AllianceMessageType.UNDER_ATTACK, "Ana_B", body)).toBe(
      "Ana_B's outpost (12, 40) is under attack by Bob!",
    );
    const yard = JSON.stringify({ x: 3, y: 7, outpost: false, by: "Cy" });
    expect(composeShout(AllianceMessageType.UNDER_ATTACK, "Ana_B", yard)).toBe("Ana_B's yard (3, 7) is under attack by Cy!");
  });

  test("carries its cell for Show on map; other lines carry none", () => {
    expect(shoutCell(AllianceMessageType.UNDER_ATTACK, body)).toEqual({ x: 12, y: 40 });
    expect(shoutCell(AllianceMessageType.JOINED, body)).toBeUndefined();
  });

  test("a damaged body reads as nothing rather than throwing", () => {
    expect(composeShout(AllianceMessageType.UNDER_ATTACK, "Ana_B", "not json")).toBe("");
    expect(shoutCell(AllianceMessageType.UNDER_ATTACK, "{}")).toBeUndefined();
  });
});
