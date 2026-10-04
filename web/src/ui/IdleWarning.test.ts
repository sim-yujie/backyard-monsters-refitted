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
});
