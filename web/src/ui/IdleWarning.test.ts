// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdleWarning, countdownText } from "./IdleWarning";

/** The "Still there?" countdown (#271). */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("countdownText", () => {
  it("rounds up to the second", () => {
    expect(countdownText(60_000)).toBe("1:00");
    expect(countdownText(59_001)).toBe("1:00");
    expect(countdownText(59_000)).toBe("0:59");
    expect(countdownText(9_000)).toBe("0:09");
    expect(countdownText(-5)).toBe("0:00");
  });
});

describe("IdleWarning", () => {
  it("counts down while shown and goes when hidden", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const warning = new IdleWarning(host);
    warning.show(Date.now() + 60_000);
    expect(warning.shown).toBe(true);
    expect(host.textContent).toContain("Still there?");
    expect(host.querySelector(".idle-warning__time")?.textContent).toBe("1:00");
    vi.advanceTimersByTime(15_000);
    expect(host.querySelector(".idle-warning__time")?.textContent).toBe("0:45");
    warning.hide();
    expect(warning.shown).toBe(false);
    expect(host.querySelector(".idle-warning")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("its button also answers \"Stay protected?\" when that is due too (#275)", () => {
    const host = document.createElement("div");
    const stillHere = vi.fn();
    const warning = new IdleWarning(host, Date.now, stillHere);
    warning.show(Date.now() + 60_000);
    const button = host.querySelector("button")!;
    // The press itself answers: the click may never land, as the press takes the countdown down.
    button.dispatchEvent(new Event("pointerdown"));
    button.click();
    expect(stillHere).toHaveBeenCalledTimes(1);
    warning.hide();
    warning.show(Date.now() + 60_000);
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(stillHere).toHaveBeenCalledTimes(2);
    warning.hide();
  });
});
