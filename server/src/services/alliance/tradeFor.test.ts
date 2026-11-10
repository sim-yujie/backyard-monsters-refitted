import { describe, expect, test } from "bun:test";

import { AllianceMessageType } from "../../enums/Alliance.js";
import { TradeAskSchema, TradeGiveSchema } from "../../schemas/AllianceSchemas.js";
import { composeShout } from "./shoutText.js";
import { isTradeChoice, parseTradeFor, tradeChoicesOf, tradeForName, tradeForText } from "./tradeFor.js";

/** What a trade request is for: the asker's own building or monster (owner, 10 Nov 2026). */
describe("trade request: what for", () => {
  const yard = {
    buildingdata: {
      "0": { t: 14, l: 6 }, // Town Hall 6
      "1": { t: 21, l: 3 }, // Sniper Tower 3
      "2": { t: 21, l: 5 },
      "3": { t: 21, l: 5 }, // a second Sniper 5: one choice
      "4": { t: 21, l: 2, cB: 100 }, // still being built: no choice
      "5": { t: 1, l: 10 }, // a Twig Snapper at its top level: no choice
    },
    lockerdata: { C2: { t: 2 }, C3: { t: 1, s: 0, e: 100 }, C4: { t: 2 } },
  };

  test("buildings: each type's next levels, once each; monsters: the unlocked ones and the Pokey", () => {
    const choices = tradeChoicesOf(yard);
    expect(choices.buildings).toEqual([
      { type: 14, level: 7 },
      { type: 21, level: 4 },
      { type: 21, level: 6 },
    ]);
    expect(choices.monsters).toContain("C1");
    expect(choices.monsters).toContain("C2");
    expect(choices.monsters).toContain("C4");
    // Still unlocking.
    expect(choices.monsters).not.toContain("C3");
  });

  test("stored as short text and read back; old words and junk read as nothing", () => {
    const hall = { kind: "building", type: 14, level: 7 } as const;
    expect(tradeForText(hall)).toBe("b:14:7");
    expect(parseTradeFor("b:14:7")).toEqual(hall);
    expect(parseTradeFor("m:C2")).toEqual({ kind: "monster", id: "C2" });
    for (const junk of ["upgrade", "monsters", "b:14", "m:", "b:x:1", "", null, 7]) expect(parseTradeFor(junk)).toBeNull();
    expect(tradeForText({ kind: "monster", id: "IC12" }).length).toBeLessThanOrEqual(16);
  });

  test("only the asker's own choices pass", () => {
    const choices = tradeChoicesOf(yard);
    expect(isTradeChoice({ kind: "building", type: 14, level: 7 }, choices)).toBe(true);
    expect(isTradeChoice({ kind: "building", type: 14, level: 8 }, choices)).toBe(false);
    expect(isTradeChoice({ kind: "monster", id: "C4" }, choices)).toBe(true);
    expect(isTradeChoice({ kind: "monster", id: "C3" }, choices)).toBe(false);
  });

  test("names for the chat line", () => {
    expect(tradeForName({ kind: "building", type: 14, level: 7 })).toBe("Town Hall L7");
    expect(tradeForName({ kind: "monster", id: "C1" })).toBe("Pokey");
    expect(tradeForName(null)).toBeNull();
    const line = composeShout(
      AllianceMessageType.TRADE_ASK,
      "PebbleKing",
      JSON.stringify({ request: 3, amounts: { r4: 2_000_000 }, for: "b:14:7" })
    );
    expect(line).toContain("PebbleKing asks for");
    expect(line).toContain("(Town Hall L7)");
  });
});

describe("trade routes: the give takes no amount", () => {
  test("give is the request alone; any amount is refused", () => {
    expect(TradeGiveSchema.parse({ request_id: 4 })).toEqual({ request_id: 4 });
    expect(() => TradeGiveSchema.parse({ request_id: 4, r1: 100 })).toThrow();
  });

  test("ask carries what for as short text", () => {
    expect(TradeAskSchema.parse({ r1: 100, for: "b:14:7" }).for).toBe("b:14:7");
    expect(() => TradeAskSchema.parse({ r1: 100, for: "x".repeat(17) })).toThrow();
  });
});
