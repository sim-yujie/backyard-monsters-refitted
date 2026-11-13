// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { noteCoins, resetCoins } from "@/game/eventCoins";
import type { YardMounts } from "../yardPlugins";
import { claimOnly, COINS_NOTICE, eventCoinsPlugin, gainLine, gainWords } from "./eventCoins";

afterEach(() => resetCoins());

const mounts = (save: Record<string, unknown>) => {
  const notices = { show: vi.fn(), clear: vi.fn() };
  return { notices, mounts: { store: { save }, notices } as unknown as YardMounts };
};

describe("event coins plugin", () => {
  it("names what paid in one or two words", () => {
    expect(gainWords(["calendar"])).toBe("Daily");
    expect(gainWords(["calendar", "ladder"])).toBe("Daily + Event");
    expect(gainWords(["weekend-checkin"])).toBe("Weekend");
    expect(gainWords(["announcement"])).toBe("Gift");
    expect(gainWords(["calendar", "weekend-checkin"])).toBe("Daily + Weekend");
    expect(gainWords(["unknown"])).toBe("");
    expect(gainWords([])).toBe("");
  });

  it("the line: the coin, a green +N, and the words", () => {
    const line = gainLine({ amount: 25, balance: 25, reasons: ["ladder"] });
    expect(line.getAttribute("aria-label")).toBe("25 Glimmers gained: Event");
    expect(line.querySelector("[data-icon='eventcoin']")).not.toBeNull();
    expect(line.textContent).toContain("+25");
    expect(line.querySelector(".coins-gained__why")?.textContent).toBe("Event");
  });

  it("the load's purse is noted quietly; a later unnamed rise shows a +N notice", () => {
    const { notices, mounts: m } = mounts({ eventcoins: 25 });
    const stop = eventCoinsPlugin(m);
    expect(notices.show).not.toHaveBeenCalled();
    // A rise no answer named (seen at a later load) shows one.
    noteCoins(100);
    expect(notices.show).toHaveBeenCalledTimes(1);
    expect(notices.show.mock.calls[0]![0]).toBe(COINS_NOTICE);
    expect(notices.show.mock.calls[0]![2]).toMatchObject({ level: "info" });
    if (stop) stop();
    expect(notices.clear).toHaveBeenCalledWith(COINS_NOTICE);
    noteCoins(200);
    expect(notices.show).toHaveBeenCalledTimes(1);
  });

  it("a weekend check-in's 50 Glimmers show a +50 notice (owner, 13 Nov 2026)", () => {
    const { notices, mounts: m } = mounts({ eventcoins: 25 });
    eventCoinsPlugin(m);
    expect(notices.show).not.toHaveBeenCalled();
    noteCoins(75, [{ amount: 50, reason: "weekend-checkin" }]);
    expect(notices.show).toHaveBeenCalledTimes(1);
    expect(notices.show.mock.calls[0]![1].getAttribute("aria-label")).toBe("50 Glimmers gained: Weekend");
  });

  it("a load without a purse (the Inferno) shows nothing; claims show on their own notice", () => {
    const { notices, mounts: m } = mounts({});
    eventCoinsPlugin(m);
    noteCoins(10);
    noteCoins(25, [{ amount: 15, reason: "calendar" }]);
    expect(notices.show).not.toHaveBeenCalled();
    expect(claimOnly(["calendar"])).toBe(true);
    expect(claimOnly(["calendar", "ladder"])).toBe(true);
    expect(claimOnly(["quest"])).toBe(true);
    expect(claimOnly(["quest", "weekend-played"])).toBe(false);
    expect(claimOnly(["calendar", "other"])).toBe(false);
    expect(claimOnly([])).toBe(false);
  });
});
