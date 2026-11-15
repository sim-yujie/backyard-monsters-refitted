// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { HELP_ALL_RESULT_MS, HelpAllBar } from "./HelpAllBar";

/** The Help all bar on a friend's yard (beta 8): count, button, progress and the line after. */

const button = (bar: HelpAllBar) => bar.element.querySelector<HTMLButtonElement>(".help-all-bar__button")!;
const count = (bar: HelpAllBar) => bar.element.querySelector(".help-all-bar__count")?.textContent;

afterEach(() => {
  vi.useRealTimers();
});

describe("HelpAllBar", () => {
  it("shows the painted tools, the count and Help all; hidden with nothing to help", () => {
    const bar = new HelpAllBar({ onHelpAll: async () => ({ text: "", kind: "thanks" }) });
    bar.setCount(3);
    expect(bar.element.hidden).toBe(false);
    expect(bar.element.querySelector("img.game-icon--tools")).not.toBeNull();
    expect(count(bar)).toBe("3 to speed up");
    expect(button(bar).textContent).toBe("Help all");
    bar.setCount(0);
    expect(bar.element.hidden).toBe(true);
  });

  it("locks while running, counts the steps, then shows one line for a while", async () => {
    vi.useFakeTimers();
    let finish: (line: { text: string; kind: "thanks" | "error" }) => void = () => {};
    const onHelpAll = vi.fn(
      () =>
        new Promise<{ text: string; kind: "thanks" | "error" }>((resolve) => {
          finish = resolve;
        }),
    );
    const bar = new HelpAllBar({ onHelpAll });
    bar.setCount(3);
    button(bar).click();
    expect(bar.running).toBe(true);
    expect(button(bar).disabled).toBe(true);
    button(bar).click();
    expect(onHelpAll).toHaveBeenCalledTimes(1);
    bar.setProgress(1, 3);
    expect(button(bar).textContent).toBe("1/3");

    // The last help leaves nothing: the bar stays for the line.
    bar.setCount(0);
    expect(bar.element.hidden).toBe(false);
    finish({ text: "Helped 3 · saved 1h 12m", kind: "thanks" });
    await vi.waitFor(() => expect(bar.running).toBe(false));
    expect(bar.resultText).toBe("Helped 3 · saved 1h 12m");
    expect(bar.element.hidden).toBe(false);

    vi.advanceTimersByTime(HELP_ALL_RESULT_MS);
    expect(bar.resultText).toBe("");
    expect(bar.element.hidden).toBe(true);
  });
});
