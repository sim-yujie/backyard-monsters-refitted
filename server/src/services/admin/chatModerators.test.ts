import { describe, expect, test } from "bun:test";

import { parseModeratorAdd } from "./chatModerators.js";

/**
 * The dashboard's Moderators add box, without a database
 * (`chatModerators.db.test.ts` has the rest).
 */
describe("reading the Moderators add box", () => {
  test("takes a name or an account number, trimmed", () => {
    expect(parseModeratorAdd({ player: "  yardtester " })).toEqual({ ok: true, value: { player: "yardtester" } });
    expect(parseModeratorAdd({ player: "#2503" })).toEqual({ ok: true, value: { player: "#2503" } });
  });

  test("asks for something when the box is empty or missing", () => {
    for (const body of [{ player: "   " }, {}, null, "yardtester", { player: 2503 }]) {
      expect(parseModeratorAdd(body)).toEqual({ ok: false, message: "Type a player's name or account number." });
    }
  });

  test("refuses text far longer than any name", () => {
    expect(parseModeratorAdd({ player: "x".repeat(41) }).ok).toBe(false);
  });
});
