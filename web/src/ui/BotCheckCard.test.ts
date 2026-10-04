// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BotCheckChallenge } from "@/api/botCheck";
import { ApiError } from "@/api/http";
import { BOT_CHECK_TEXT, BotCheckCard, botCheckWaitText } from "./BotCheckCard";

/** The in-game check's card (#273). */

const check = (id: string, name = "Pokey"): BotCheckChallenge => ({
  id,
  prompt: "How many of these are in the picture?",
  name,
  reference: `data:image/webp;base64,${id}A`,
  picture: `data:image/png;base64,${id}B`,
});

const numbers = (host: HTMLElement): HTMLButtonElement[] => [
  ...host.querySelectorAll<HTMLButtonElement>(".presence-check__number"),
];

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
  it("asks how many of the named monster are in the picture, and says the yard can be attacked", () => {
    const host = document.createElement("div");
    const card = new BotCheckCard(host, async () => {});
    card.show({ kind: "challenge", challenge: check("k1"), retry: false });

    expect(host.querySelector(".presence-check__title")!.textContent).toBe("Quick check");
    expect(host.querySelector(".presence-check__prompt")!.textContent).toBe("How many of these are in the picture?");
    expect(host.querySelector(".presence-check__name")!.textContent).toBe("Pokey");
    expect(host.querySelector<HTMLImageElement>(".presence-check__reference")!.src).toBe("data:image/webp;base64,k1A");
    expect(host.querySelector<HTMLImageElement>(".presence-check__picture")!.src).toBe("data:image/png;base64,k1B");
    expect(host.textContent).toContain("other players can attack your yard");
    expect(host.textContent).toContain("Everything else keeps working");
    expect(numbers(host).map((button) => button.textContent)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    expect(host.querySelector(".presence-check")!.classList.contains("presence-check--wait")).toBe(false);
    expect(host.querySelector(".presence-check__line")!.textContent).toBe("");
  });

  it("sends the number tapped, once, and shows the next picture as a retry", async () => {
    const host = document.createElement("div");
    const chosen: string[] = [];
    const card: BotCheckCard = new BotCheckCard(host, async (option) => {
      chosen.push(option);
      await Promise.resolve();
      card.show({ kind: "challenge", challenge: check("k2", "Octo-Ooze"), retry: true });
    });
    card.show({ kind: "challenge", challenge: check("k1"), retry: false });
    const four = numbers(host)[3]!;
    four.click();
    four.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(chosen).toEqual(["4"]);
    expect(host.querySelector(".presence-check__name")!.textContent).toBe("Octo-Ooze");
    expect(host.querySelector<HTMLImageElement>(".presence-check__picture")!.src).toBe("data:image/png;base64,k2B");
    expect(host.textContent).toContain(BOT_CHECK_TEXT.retry);
    expect(numbers(host).every((button) => !button.disabled)).toBe(true);
  });

  it("sends each button's own number", async () => {
    const host = document.createElement("div");
    const chosen: string[] = [];
    const card = new BotCheckCard(host, async (option) => {
      chosen.push(option);
    });
    card.show({ kind: "challenge", challenge: check("k1"), retry: false });
    for (const button of numbers(host)) {
      button.click();
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(chosen).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  });

  it("says so when the server cannot be reached, and lets the player tap again", async () => {
    const host = document.createElement("div");
    let fail = true;
    const onChoose = vi.fn(async () => {
      if (fail) throw new Error("offline");
    });
    const card = new BotCheckCard(host, onChoose);
    card.show({ kind: "challenge", challenge: check("k1"), retry: false });
    numbers(host)[0]!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(host.textContent).toContain(BOT_CHECK_TEXT.failed);
    expect(numbers(host)[0]!.disabled).toBe(false);
    fail = false;
    numbers(host)[0]!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(onChoose).toHaveBeenCalledTimes(2);
  });

  it("asks the player to slow down when the server limits answers, and keeps the picture", async () => {
    const host = document.createElement("div");
    const onChoose = vi.fn(async () => {
      throw new ApiError("Too many answers. Please wait a minute.", { status: 429 });
    });
    const card = new BotCheckCard(host, onChoose);
    card.show({ kind: "challenge", challenge: check("k1"), retry: false });
    numbers(host)[4]!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(host.querySelector(".presence-check__line")!.textContent).toBe(BOT_CHECK_TEXT.tooFast);
    expect(host.querySelector<HTMLImageElement>(".presence-check__picture")!.src).toBe("data:image/png;base64,k1B");
    expect(numbers(host).every((button) => !button.disabled)).toBe(true);
  });

  it("shows the wait with no picture, counting down, taps doing nothing, and goes when hidden", () => {
    const host = document.createElement("div");
    const onChoose = vi.fn(async () => {});
    const card = new BotCheckCard(host, onChoose);
    card.show({ kind: "challenge", challenge: check("k1"), retry: false });
    card.show({ kind: "wait", until: Date.now() + 90_000 });
    expect(host.querySelector(".presence-check")!.classList.contains("presence-check--wait")).toBe(true);
    expect(host.querySelector<HTMLImageElement>(".presence-check__picture")!.hasAttribute("src")).toBe(false);
    expect(host.querySelector<HTMLImageElement>(".presence-check__reference")!.hasAttribute("src")).toBe(false);
    expect(host.textContent).toContain("comes in 1:30");
    numbers(host)[2]!.click();
    expect(onChoose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(host.textContent).toContain("comes in 1:00");
    card.hide();
    expect(card.shown).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
