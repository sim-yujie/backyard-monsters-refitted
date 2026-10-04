// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BotCheckChallenge } from "@/api/botCheck";
import { BOT_CHECK_TEXT, BotCheckCard, botCheckWaitText } from "./BotCheckCard";

/** The in-game check's card (#273). */

const check = (id: string, monsters = ["C3", "C1", "C7", "C12", "C5"]): BotCheckChallenge => ({
  id,
  prompt: "Tap the Pokey",
  options: monsters.map((monster, i) => ({ id: `${id}-${i}`, monster })),
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("botCheckWaitText", () => {
  it("counts down to the next check", () => {
    expect(botCheckWaitText(83_000)).toBe("Too many wrong answers. The next check comes in 1:23.");
    expect(botCheckWaitText(0)).toBe("The next check is coming.");
  });
});

describe("BotCheckCard", () => {
  it("asks for the monster among the portraits, in the server's order, and says the yard can be attacked", () => {
    const host = document.createElement("div");
    const card = new BotCheckCard(host, async () => {});
    card.show({ kind: "challenge", challenge: check("k1"), retry: false });

    expect(host.querySelector(".bot-check__heading")!.textContent).toBe("Quick check: tap the Pokey");
    expect(host.textContent).toContain("other players can attack your yard");
    expect(host.textContent).toContain("Everything else keeps working");
    const pictures = [...host.querySelectorAll<HTMLImageElement>(".bot-check__picture")];
    expect(pictures.map((picture) => picture.src.match(/(C\d+)-icon\.webp$/)?.[1])).toEqual([
      "C3",
      "C1",
      "C7",
      "C12",
      "C5",
    ]);
    // No names anywhere: a name would answer the check.
    const buttons = [...host.querySelectorAll("button")];
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Monster 1",
      "Monster 2",
      "Monster 3",
      "Monster 4",
      "Monster 5",
    ]);
    expect(pictures.every((picture) => picture.alt === "")).toBe(true);
    expect(host.querySelector(".bot-check__line")!.textContent).toBe("");
  });

  it("sends the option tapped once, and shows the next check as a retry", async () => {
    const host = document.createElement("div");
    const chosen: string[] = [];
    const card: BotCheckCard = new BotCheckCard(host, async (option) => {
      chosen.push(option);
      card.show({ kind: "challenge", challenge: check("k2", ["C2", "C4", "C6", "C8"]), retry: true });
    });
    card.show({ kind: "challenge", challenge: check("k1"), retry: false });
    const second = host.querySelectorAll("button")[1]!;
    second.click();
    second.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(chosen).toEqual(["k1-1"]);
    expect(host.querySelectorAll("button")).toHaveLength(4);
    expect(host.textContent).toContain(BOT_CHECK_TEXT.retry);
    expect([...host.querySelectorAll("button")].every((button) => !button.disabled)).toBe(true);
  });

  it("says so when the server cannot be reached, and lets the player tap again", async () => {
    const host = document.createElement("div");
    let fail = true;
    const onChoose = vi.fn(async () => {
      if (fail) throw new Error("offline");
    });
    const card = new BotCheckCard(host, onChoose);
    card.show({ kind: "challenge", challenge: check("k1"), retry: false });
    host.querySelector("button")!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(host.textContent).toContain(BOT_CHECK_TEXT.failed);
    expect(host.querySelector("button")!.disabled).toBe(false);
    fail = false;
    host.querySelector("button")!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(onChoose).toHaveBeenCalledTimes(2);
  });

  it("shows the wait with no portraits, counting down, and goes when hidden", () => {
    const host = document.createElement("div");
    const card = new BotCheckCard(host, async () => {});
    card.show({ kind: "wait", until: Date.now() + 90_000 });
    expect(host.querySelectorAll("button")).toHaveLength(0);
    expect(host.textContent).toContain("comes in 1:30");
    vi.advanceTimersByTime(30_000);
    expect(host.textContent).toContain("comes in 1:00");
    card.hide();
    expect(card.shown).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
