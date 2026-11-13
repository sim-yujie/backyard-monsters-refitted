// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { coinBalance, noteCoins, resetCoins } from "@/game/eventCoins";
import type { YardMounts } from "../yardPlugins";
import { eventCoinsPlugin } from "./eventCoins";

afterEach(() => resetCoins());

const mounts = (save: Record<string, unknown>) => {
  const notices = { show: vi.fn(), clear: vi.fn() };
  return { notices, mounts: { store: { save }, notices } as unknown as YardMounts };
};

describe("event coins plugin", () => {
  it("hands the load's purse to the coin module, quietly", () => {
    const { notices, mounts: m } = mounts({ eventcoins: 25 });
    eventCoinsPlugin(m);
    expect(coinBalance()).toBe(25);
    expect(notices.show).not.toHaveBeenCalled();
  });

  it("a weekend check-in's +50 raises no toast: the purse updates and the bar floats it (owner, 13 Nov 2026)", () => {
    const { notices, mounts: m } = mounts({ eventcoins: 25 });
    eventCoinsPlugin(m);
    noteCoins(75);
    expect(coinBalance()).toBe(75);
    expect(notices.show).not.toHaveBeenCalled();
  });

  it("a load without a purse (the Inferno) leaves the purse alone", () => {
    const { notices, mounts: m } = mounts({});
    eventCoinsPlugin(m);
    expect(coinBalance()).toBeNull();
    expect(notices.show).not.toHaveBeenCalled();
  });
});
