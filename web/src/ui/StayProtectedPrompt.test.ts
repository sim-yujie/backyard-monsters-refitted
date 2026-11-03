// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StayProtectedPrompt, stayProtectedText } from "./StayProtectedPrompt";

/** The small "Stay protected?" prompt (#275). */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("stayProtectedText", () => {
  // 3 Nov: it spoke only of attacks, so a player who did not mind one let it
  // run out and was disconnected without being told that would happen.
  it("counts down to the disconnect, then asks for the tap now", () => {
    expect(stayProtectedText(60_000)).toEqual({ line: "Tap within 1:00 to stay connected.", over: false });
    expect(stayProtectedText(0)).toEqual({ line: "Tap now to stay connected.", over: true });
  });
});

describe("StayProtectedPrompt", () => {
  it("counts down, taps once, and says so when the server cannot be reached", async () => {
    const host = document.createElement("div");
    let fail = false;
    const onStay = vi.fn(async () => {
      if (fail) throw new Error("offline");
    });
    const prompt = new StayProtectedPrompt(host, onStay);
    prompt.show(Date.now() + 60_000);
    expect(host.textContent).toContain("Stay protected?");
    expect(host.textContent).toContain("within 1:00");
    vi.advanceTimersByTime(61_000);
    expect(host.textContent).toContain("Tap now to stay connected");
    expect(host.querySelector(".stay-protected--over")).not.toBeNull();

    fail = true;
    const button = host.querySelector("button")!;
    button.click();
    button.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(onStay).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Could not reach the server");
    vi.advanceTimersByTime(1_000);
    expect(host.textContent).toContain("Could not reach the server");

    fail = false;
    button.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(onStay).toHaveBeenCalledTimes(2);
    prompt.hide();
    expect(prompt.shown).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
