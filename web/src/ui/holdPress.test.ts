// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { holdPress } from "./holdPress";
import { HOLD_DELAY_MS } from "./QuantityStepper";

const down = (element: HTMLElement) =>
  element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }));
const up = () => window.dispatchEvent(new PointerEvent("pointerup", { button: 0, pointerId: 1 }));
const cancel = () => window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1 }));

const make = (limit = Infinity, stepOnPress = true) => {
  const button = document.createElement("button");
  document.body.append(button);
  let steps = 0;
  const ends: boolean[] = [];
  const teardown = holdPress(
    button,
    {
      step: () => {
        steps += 1;
        return steps < limit;
      },
      end: (cancelled) => ends.push(cancelled),
    },
    { stepOnPress },
  );
  return { button, steps: () => steps, ends, teardown };
};

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("holdPress", () => {
  it("steps once on a tap and ends it", () => {
    vi.useFakeTimers();
    const { button, steps, ends } = make();
    down(button);
    expect(steps()).toBe(1);
    up();
    vi.advanceTimersByTime(HOLD_DELAY_MS * 4);
    expect(steps()).toBe(1);
    expect(ends).toEqual([false]);
  });

  it("repeats while held, quickening, until the release", () => {
    vi.useFakeTimers();
    const { button, steps, ends } = make();
    down(button);
    vi.advanceTimersByTime(HOLD_DELAY_MS);
    const pressed = steps();
    vi.advanceTimersByTime(500);
    const early = steps() - pressed;
    vi.advanceTimersByTime(2000);
    const before = steps();
    vi.advanceTimersByTime(500);
    const late = steps() - before;
    expect(early).toBeGreaterThan(2);
    // Half a second late in the hold steps more than the first half-second did.
    expect(late).toBeGreaterThan(early);
    up();
    const total = steps();
    vi.advanceTimersByTime(3000);
    expect(steps()).toBe(total);
    expect(ends).toEqual([false]);
  });

  it("stops repeating when the owner has nothing more, and still ends only on release", () => {
    vi.useFakeTimers();
    const { button, steps, ends } = make(3);
    down(button);
    vi.advanceTimersByTime(5000);
    expect(steps()).toBe(3);
    expect(ends).toEqual([]);
    up();
    expect(ends).toEqual([false]);
  });

  it("reports a pointercancel before any repeat as cancelled, and after one as a release", () => {
    vi.useFakeTimers();
    const first = make();
    down(first.button);
    cancel();
    expect(first.ends).toEqual([true]);
    first.teardown();

    const second = make();
    down(second.button);
    vi.advanceTimersByTime(HOLD_DELAY_MS + 200);
    cancel();
    expect(second.ends).toEqual([false]);
  });

  it("with stepOnPress off, steps a tap on release, a hold after the delay, and a scroll not at all", () => {
    vi.useFakeTimers();
    const { button, steps, ends } = make(Infinity, false);
    down(button);
    expect(steps()).toBe(0);
    cancel();
    expect(steps()).toBe(0);
    down(button);
    up();
    expect(steps()).toBe(1);
    down(button);
    vi.advanceTimersByTime(HOLD_DELAY_MS + 200);
    const held = steps();
    expect(held).toBeGreaterThan(1);
    up();
    expect(steps()).toBe(held);
    expect(ends).toEqual([true, false, false]);
  });

  it("steps once for a keyboard click and ignores a pointer's own click", () => {
    const { button, steps, ends } = make();
    button.click();
    expect(steps()).toBe(1);
    expect(ends).toEqual([false]);
    down(button);
    up();
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(steps()).toBe(2);
  });

  it("ignores a press on a disabled button and blocks the long-press menu", () => {
    const { button, steps } = make();
    button.disabled = true;
    down(button);
    expect(steps()).toBe(0);
    const menu = new Event("contextmenu", { cancelable: true });
    button.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
  });
});
