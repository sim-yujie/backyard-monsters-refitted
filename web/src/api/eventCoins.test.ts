import { describe, expect, it } from "vitest";
import { readCoins } from "./eventCoins";

describe("readCoins", () => {
  it("reads the purse and this weekend's two awards", () => {
    expect(
      readCoins({
        error: 0,
        balance: 120,
        weekend: {
          key: "2026-11-14",
          played: true,
          boost: false,
          coins: { played: 25, boost: 75 },
        },
      }),
    ).toEqual({
      balance: 120,
      weekend: {
        key: "2026-11-14",
        played: true,
        boost: false,
        coins: { played: 25, boost: 75 },
      },
    });
  });

  it("no weekend running: null; a broken body: null; missing amounts: the defaults", () => {
    expect(readCoins({ balance: 0, weekend: null })).toEqual({ balance: 0, weekend: null });
    expect(readCoins({ error: 0 })).toBeNull();
    expect(readCoins(null)).toBeNull();
    expect(readCoins({ balance: 5, weekend: { key: "forced-0" } })?.weekend).toEqual({
      key: "forced-0",
      played: false,
      boost: false,
      coins: { played: 25, boost: 75 },
    });
  });
});
