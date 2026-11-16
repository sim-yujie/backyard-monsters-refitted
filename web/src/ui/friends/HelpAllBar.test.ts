// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { HELP_ALL_RESULT_MS, HelpAllBar, type HelpAllLine } from "./HelpAllBar";

/**
 * The one visit bar on a friend's yard (beta 8, owner 15 Nov 2026: one bar,
 * not three): whose yard, the tools and the count, Help all; the line after
 * Help all in the same row; then the name alone.
 */

const button = (bar: HelpAllBar) => bar.element.querySelector<HTMLButtonElement>(".help-all-bar__button")!;
const count = (bar: HelpAllBar) => bar.element.querySelector(".help-all-bar__count")?.textContent;
const part = (bar: HelpAllBar, name: string) => bar.element.querySelector<HTMLElement>(`.help-all-bar__${name}`)!;

afterEach(() => {
  vi.useRealTimers();
});

describe("HelpAllBar", () => {
  it("is one row: the name, the painted tools, the count and Help all", () => {
    const bar = new HelpAllBar({ onHelpAll: async () => ({ text: "", kind: "thanks" }) });
    bar.setName("Bob's yard");
    bar.setCount(3);
    expect(bar.element.hidden).toBe(false);
    expect(part(bar, "name").textContent).toBe("Bob's yard");
    expect(part(bar, "name").hidden).toBe(false);
    expect(part(bar, "help").hidden).toBe(false);
    expect(bar.element.querySelector("img.game-icon--tools")).not.toBeNull();
    // The number shows; the words stay for a screen reader.
    expect(count(bar)).toBe("3 to speed up");
    expect(bar.element.querySelector(".help-all-bar__number")?.textContent).toBe("3");
    expect(bar.element.querySelector(".help-all-bar__words")?.textContent).toBe(" to speed up");
    expect(button(bar).textContent).toBe("Help all");
    // Nothing to help: the name alone, the bar stays.
    bar.setCount(0);
    expect(bar.element.hidden).toBe(false);
    expect(part(bar, "help").hidden).toBe(true);
    expect(part(bar, "name").hidden).toBe(false);
  });

  it("locks while running, counts the steps, shows the line in the row, then the name alone", async () => {
    vi.useFakeTimers();
    let finish: (line: HelpAllLine) => void = () => {};
    const onHelpAll = vi.fn(
      () =>
        new Promise<HelpAllLine>((resolve) => {
          finish = resolve;
        }),
    );
    const bar = new HelpAllBar({ onHelpAll });
    bar.setName("Bob's yard");
    bar.setCount(3);
    button(bar).click();
    expect(bar.running).toBe(true);
    expect(button(bar).disabled).toBe(true);
    button(bar).click();
    expect(onHelpAll).toHaveBeenCalledTimes(1);
    bar.setProgress(1, 3);
    expect(button(bar).textContent).toBe("1/3");

    // The last help leaves nothing: the button stays while it runs.
    bar.setCount(0);
    expect(part(bar, "help").hidden).toBe(false);
    finish({ text: "Helped 3 · -1h 12m", full: "Helped 3 · saved 1h 12m", kind: "thanks" });
    await vi.waitFor(() => expect(bar.running).toBe(false));
    expect(bar.resultText).toBe("Helped 3 · -1h 12m");
    expect(part(bar, "result").title).toBe("Helped 3 · saved 1h 12m");
    // The line takes the count's and the button's place, in the same row.
    expect(part(bar, "help").hidden).toBe(true);
    expect(bar.element.classList.contains("help-all-bar--result")).toBe(true);

    vi.advanceTimersByTime(HELP_ALL_RESULT_MS);
    expect(bar.resultText).toBe("");
    expect(bar.element.hidden).toBe(false);
    expect(part(bar, "name").hidden).toBe(false);
    expect(part(bar, "help").hidden).toBe(true);
    expect(bar.element.classList.contains("help-all-bar--result")).toBe(false);
  });

  it("brings the count and Help all back after the line when helps are left", () => {
    vi.useFakeTimers();
    const bar = new HelpAllBar({ onHelpAll: async () => ({ text: "", kind: "thanks" }) });
    bar.setName("Bob's yard");
    bar.setCount(1);
    bar.showResult({ text: "They are under attack.", kind: "error" });
    expect(part(bar, "result").classList.contains("help-all-bar__result--error")).toBe(true);
    expect(part(bar, "help").hidden).toBe(true);
    vi.advanceTimersByTime(HELP_ALL_RESULT_MS);
    expect(part(bar, "help").hidden).toBe(false);
    expect(count(bar)).toBe("1 to speed up");
  });

  it("a line can be icons for its own time, its words kept for a screen reader; 0 ms shows none", () => {
    vi.useFakeTimers();
    const bar = new HelpAllBar({ onHelpAll: async () => ({ text: "", kind: "thanks" }) });
    bar.setName("Bob's yard");
    const node = document.createElement("span");
    node.className = "picture";
    bar.showResult({ text: "Helped 3", kind: "thanks", node, ms: 1000 });
    expect(part(bar, "result").querySelector(".picture")?.getAttribute("aria-hidden")).toBe("true");
    expect(bar.resultText).toBe("Helped 3");
    vi.advanceTimersByTime(1000);
    expect(bar.resultText).toBe("");
    bar.showResult({ text: "Helped 3", kind: "thanks", ms: 0 });
    expect(part(bar, "result").hidden).toBe(true);
  });
});
