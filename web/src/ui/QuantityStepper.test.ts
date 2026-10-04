// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HOLD_DELAY_MS,
  HOLD_FAST_MS,
  HOLD_START_MS,
  holdInterval,
  QuantityStepper,
} from "./QuantityStepper";

/**
 * The shared quantity control (`docs/design/yard-buildings.md` §4.4, D9): a
 * press steps once, a hold repeats faster and faster, the box takes a typed
 * figure and the arrow keys, Fill asks the owner, and `sync` draws the
 * owner's state. The hold timings moved here from `ArmyPanel.test.ts`.
 */

const steppers: QuantityStepper[] = [];

afterEach(() => {
  while (steppers.length > 0) steppers.pop()?.destroy();
  document.body.replaceChildren();
  vi.useRealTimers();
});

/** A stepper over a plain counter clamped to 0..max, redrawn on every change. */
const mount = (max = 1000, jumps?: readonly number[]) => {
  let count = 0;
  const fill = vi.fn(() => {
    count = max;
    draw(true);
  });
  const commit = vi.fn(() => draw(true));
  const stepper = new QuantityStepper({
    block: "qty",
    inputLabel: "Pokey to hatch",
    fewerLabel: "Fewer Pokey",
    moreLabel: "More Pokey",
    fillTitle: "As many as fit",
    ...(jumps ? { jumps } : {}),
    value: () => count,
    set: (value) => {
      count = Math.max(0, Math.min(max, Math.floor(value)));
      draw(document.activeElement !== stepper.input);
    },
    fill,
    commit,
  });
  const draw = (rewrite: boolean) => stepper.sync({ value: count, max, disabled: false, rewrite });
  steppers.push(stepper);
  document.body.append(stepper.element);
  draw(true);
  return { stepper, fill, commit, count: () => count };
};

const pointer = (element: HTMLElement, type: string): void => {
  element.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1 }),
  );
};

const key = (element: HTMLElement, name: string): void => {
  element.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
};

describe("QuantityStepper hold timing", () => {
  it("ramps the repeat interval from the start rate to the fast rate", () => {
    expect(holdInterval(0)).toBe(HOLD_START_MS);
    expect(holdInterval(HOLD_DELAY_MS)).toBe(HOLD_START_MS);
    expect(holdInterval(HOLD_DELAY_MS + 1000)).toBeLessThan(HOLD_START_MS);
    expect(holdInterval(HOLD_DELAY_MS + 1000)).toBeGreaterThan(HOLD_FAST_MS);
    expect(holdInterval(10_000)).toBe(HOLD_FAST_MS);
  });

  it("steps once on press, waits, then repeats faster the longer it is held", () => {
    vi.useFakeTimers();
    const { stepper, count } = mount();
    pointer(stepper.plus, "pointerdown");
    expect(count()).toBe(1);
    vi.advanceTimersByTime(HOLD_DELAY_MS - 1);
    expect(count()).toBe(1);
    vi.advanceTimersByTime(1);
    expect(count()).toBe(2);
    vi.advanceTimersByTime(HOLD_START_MS);
    expect(count()).toBe(3);

    vi.advanceTimersByTime(3000);
    const before = count();
    expect(before).toBeGreaterThan(20);
    vi.advanceTimersByTime(HOLD_FAST_MS * 5);
    expect(count()).toBe(before + 5);

    pointer(stepper.plus, "pointerup");
    const released = count();
    vi.advanceTimersByTime(2000);
    expect(count()).toBe(released);
  });

  it("does not step again on the click that follows a press", () => {
    const { stepper, count } = mount();
    pointer(stepper.plus, "pointerdown");
    pointer(stepper.plus, "pointerup");
    stepper.plus.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(count()).toBe(1);
    // A keyboard activation (detail 0) steps once.
    stepper.plus.click();
    expect(count()).toBe(2);
  });

  it("stops at the maximum, on pointer leave and on cancel", () => {
    vi.useFakeTimers();
    const { stepper, count } = mount(2);
    pointer(stepper.plus, "pointerdown");
    vi.advanceTimersByTime(HOLD_DELAY_MS);
    expect(count()).toBe(2);
    expect(stepper.plus.disabled).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(count()).toBe(2);
    pointer(stepper.plus, "pointercancel");

    pointer(stepper.minus, "pointerdown");
    expect(count()).toBe(1);
    pointer(stepper.minus, "pointerleave");
    vi.advanceTimersByTime(5000);
    expect(count()).toBe(1);
  });

  it("stops a hold on destroy", () => {
    vi.useFakeTimers();
    const { stepper, count } = mount();
    pointer(stepper.plus, "pointerdown");
    stepper.destroy();
    vi.advanceTimersByTime(5000);
    expect(count()).toBe(1);
  });
});

describe("QuantityStepper box and Fill", () => {
  it("takes a typed figure, and rewrites the box on commit", () => {
    const { stepper, count, commit } = mount(25);
    stepper.input.focus();
    stepper.input.value = "12";
    stepper.input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(count()).toBe(12);
    stepper.input.value = "999";
    stepper.input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(count()).toBe(25);
    expect(stepper.input.value).toBe("999");
    stepper.input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(commit).toHaveBeenCalled();
    expect(stepper.input.value).toBe("25");
    stepper.input.value = "";
    stepper.input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(count()).toBe(25);
  });

  it("steps by one on the arrows and ten on page up and down", () => {
    const { stepper, count } = mount();
    key(stepper.input, "ArrowUp");
    key(stepper.input, "PageUp");
    expect(count()).toBe(11);
    key(stepper.input, "ArrowDown");
    key(stepper.input, "PageDown");
    key(stepper.input, "PageDown");
    expect(count()).toBe(0);
    expect(stepper.input.value).toBe("0");
  });

  it("asks the owner to fill, and disables + and Fill at the maximum", () => {
    const { stepper, fill, count } = mount(40);
    expect(stepper.minus.disabled).toBe(true);
    stepper.fill.click();
    expect(fill).toHaveBeenCalledOnce();
    expect(count()).toBe(40);
    expect(stepper.plus.disabled).toBe(true);
    expect(stepper.fill.disabled).toBe(true);
    expect(stepper.minus.disabled).toBe(false);
  });

  it("names its parts and hangs its classes off the block", () => {
    const { stepper } = mount();
    expect(stepper.element.className).toBe("qty-stepper qty__controls");
    expect(stepper.minus.className).toContain("qty__step--minus");
    expect(stepper.minus.className).toContain("qty-stepper__step");
    expect(stepper.input.className).toContain("qty-stepper__count");
    expect(stepper.fill.className).toContain("qty-stepper__fill");
    expect(stepper.plus.getAttribute("aria-label")).toBe("More Pokey");
    expect(stepper.input.getAttribute("aria-label")).toBe("Pokey to hatch");
    expect(stepper.fill.title).toBe("As many as fit");
  });

  it("disables everything when told to", () => {
    const { stepper } = mount();
    stepper.sync({ value: 5, max: 10, disabled: true, rewrite: true });
    expect(stepper.input.value).toBe("5");
    for (const control of [stepper.input, stepper.minus, stepper.plus, stepper.fill]) {
      expect(control.disabled).toBe(true);
    }
  });

  it("offers bigger steps between + and Fill when asked, stopping at the maximum", () => {
    const { stepper, count } = mount(12, [5, 10]);
    expect([...stepper.element.children].map((child) => child.textContent)).toEqual([
      "−",
      "",
      "+",
      "+5",
      "+10",
      "Fill",
    ]);
    const [five, ten] = stepper.jumps;
    expect(five!.getAttribute("aria-label")).toBe("5 more");
    five!.click();
    expect(count()).toBe(5);
    ten!.click();
    expect(count()).toBe(12);
    expect(five!.disabled).toBe(true);
    expect(ten!.disabled).toBe(true);
    expect(mount().stepper.jumps).toHaveLength(0);
  });
});
