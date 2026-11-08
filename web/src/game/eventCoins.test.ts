import { afterEach, describe, expect, it, vi } from "vitest";
import {
  coinBalance,
  forgetCoinBalance,
  noteCoins,
  onCoinBalance,
  onCoinsGained,
  resetCoins,
  type CoinsGained,
} from "./eventCoins";

afterEach(() => resetCoins());

describe("event coins", () => {
  it("the first balance of a session shows nothing; a later rise shows the difference", () => {
    const seen: CoinsGained[] = [];
    onCoinsGained((gained) => seen.push(gained));
    noteCoins(100);
    expect(seen).toEqual([]);
    expect(coinBalance()).toBe(100);
    noteCoins(130);
    expect(seen).toEqual([{ amount: 30, balance: 130, reasons: [] }]);
    // Spending is not a gain.
    noteCoins(10);
    expect(seen).toHaveLength(1);
  });

  it("what the server said it paid wins over the difference", () => {
    const seen: CoinsGained[] = [];
    onCoinsGained((gained) => seen.push(gained));
    noteCoins(25, [{ amount: 25, reason: "calendar" }]);
    noteCoins(100, [
      { amount: 75, reason: "ladder" },
      { amount: 0, reason: "nothing" },
    ]);
    expect(seen).toEqual([
      { amount: 25, balance: 25, reasons: ["calendar"] },
      { amount: 75, balance: 100, reasons: ["ladder"] },
    ]);
  });

  it("a gain before anyone listens waits for the first listener, added up", () => {
    noteCoins(0);
    noteCoins(25, [{ amount: 25, reason: "calendar" }]);
    noteCoins(40);
    const listener = vi.fn();
    onCoinsGained(listener);
    expect(listener).toHaveBeenCalledWith({
      amount: 40,
      balance: 40,
      reasons: ["calendar"],
    });
  });

  it("ignores nonsense and tells balance listeners only of changes", () => {
    const balances: number[] = [];
    onCoinBalance((balance) => balances.push(balance));
    noteCoins(50);
    noteCoins(50);
    noteCoins(Number.NaN);
    noteCoins(-5);
    noteCoins(60);
    expect(balances).toEqual([50, 60]);
  });

  it("sign-out forgets the balance, so the next account's first one shows nothing", () => {
    const listener = vi.fn();
    onCoinsGained(listener);
    noteCoins(10);
    forgetCoinBalance();
    expect(coinBalance()).toBeNull();
    noteCoins(500);
    expect(listener).not.toHaveBeenCalled();
  });
});
