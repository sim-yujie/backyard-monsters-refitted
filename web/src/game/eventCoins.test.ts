import { afterEach, describe, expect, it, vi } from "vitest";
import { coinBalance, forgetCoinBalance, noteCoins, onCoinBalance, resetCoins } from "./eventCoins";

afterEach(() => resetCoins());

describe("event coins", () => {
  it("tells balance listeners each change with the balance before it; the first has none", () => {
    const seen: [number, number | null][] = [];
    onCoinBalance((balance, before) => seen.push([balance, before]));
    noteCoins(100);
    expect(coinBalance()).toBe(100);
    noteCoins(130);
    // Spending is a change too: the bar floats "-120".
    noteCoins(10);
    expect(seen).toEqual([
      [100, null],
      [130, 100],
      [10, 130],
    ]);
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

  it("sign-out forgets the balance, so the next account's first one has no balance before it", () => {
    const listener = vi.fn();
    onCoinBalance(listener);
    noteCoins(10);
    forgetCoinBalance();
    expect(coinBalance()).toBeNull();
    noteCoins(500);
    expect(listener).toHaveBeenLastCalledWith(500, null);
  });
});
