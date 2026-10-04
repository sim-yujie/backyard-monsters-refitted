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
  it("counts down to the end of the protection, then says it is over", () => {
    expect(stayProtectedText(60_000)).toEqual({ line: "Other players can attack your yard in 1:00.", over: false });
    expect(stayProtectedText(0)).toEqual({ line: "Other players can attack your yard now.", over: true });
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
    expect(host.textContent).toContain("in 1:00");
    vi.advanceTimersByTime(61_000);
    expect(host.textContent).toContain("attack your yard now");
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
