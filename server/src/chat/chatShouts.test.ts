import { describe, expect, test } from "bun:test";

import { AllianceMessageType } from "../enums/Alliance.js";
import { shoutMessage } from "./chatShouts.js";

describe("shoutMessage (a shout delivered live)", () => {
  const base = { userId: 7, displayName: "Gil", picSquare: null, allianceImage: null, ts: 1 };

  test("a trade request line keeps its request, for chat's Trade button", () => {
    const live = shoutMessage("a:3", { ...base, body: "Gil gives 1K Twigs for 1K Goo.", messageType: AllianceMessageType.TRADE_ASK, tradeRequest: 41 });
    expect(live).toMatchObject({ channel: "a:3", body: "Gil gives 1K Twigs for 1K Goo.", tradeRequest: 41 });
  });

  test("an under-attack line keeps its cell, for the Map button", () => {
    const live = shoutMessage("a:3", { ...base, body: "Gil is under attack!", messageType: AllianceMessageType.UNDER_ATTACK, cell: { x: 4, y: 5 } });
    expect(live).toMatchObject({ cell: { x: 4, y: 5 } });
  });

  test("other lines carry neither", () => {
    const live = shoutMessage("a:3", { ...base, body: "Gil joined.", messageType: AllianceMessageType.JOINED });
    expect(live).not.toHaveProperty("tradeRequest");
    expect(live).not.toHaveProperty("cell");
  });
});
