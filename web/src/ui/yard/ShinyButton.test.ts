// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { ARM_WINDOW_MS, ShinyButton, type ShinyButtonTimers } from "./ShinyButton";

/**
 * The tap-again control (§3.1): one tap never spends; a second within three
 * seconds does; waiting, leaving or being disabled disarms.
 */

/** Timers the test runs by hand. */
const manualTimers = () => {
  const pending = new Map<number, () => void>();
  let next = 1;
  const timers: ShinyButtonTimers = {
    set: (fn) => {
      const id = next++;
      pending.set(id, fn);
      return id;
    },
    clear: (handle) => {
      pending.delete(handle as number);
    },
  };
  const fire = () => {
    for (const [id, fn] of [...pending]) {
      pending.delete(id);
      fn();
    }
  };
  return { timers, fire, pending };
};

const make = () => {
  const clock = manualTimers();
  const onSpend = vi.fn();
  const button = new ShinyButton({
    label: "Finish now",
    spell: (price) => String(price),
    onSpend,
    timers: clock.timers,
  });
  button.setPrice(58);
  document.body.append(button.element);
  return { button, onSpend, clock };
};

describe("ShinyButton", () => {
  it("shows its label and price", () => {
    const { button } = make();
    expect(button.element.textContent).toContain("Finish now");
    expect(button.element.textContent).toContain("58");
    expect(button.element.getAttribute("aria-label")).toBe("Finish now, 58 Shiny");
  });

  it("the first tap arms and does not spend", () => {
    const { button, onSpend } = make();
    button.element.click();
    expect(onSpend).not.toHaveBeenCalled();
    expect(button.armed).toBe(true);
    expect(button.element.textContent).toContain("Tap again");
    expect(button.element.classList.contains("shiny-button--armed")).toBe(true);
    expect(button.element.textContent).toContain("Tap again to spend 58 Shiny.");
  });

  it("a second tap inside the window spends once and disarms", () => {
    const { button, onSpend } = make();
    button.element.click();
    button.element.click();
    expect(onSpend).toHaveBeenCalledTimes(1);
    expect(button.armed).toBe(false);
  });

  it("disarms after the window, so a late tap only arms again", () => {
    const { button, onSpend, clock } = make();
    button.element.click();
    expect(ARM_WINDOW_MS).toBe(3_000);
    clock.fire();
    expect(button.armed).toBe(false);
    expect(button.element.textContent).not.toContain("Tap again");
    button.element.click();
    expect(onSpend).not.toHaveBeenCalled();
    expect(button.armed).toBe(true);
  });

  it("blur and Escape disarm", () => {
    const { button } = make();
    button.element.click();
    button.element.dispatchEvent(new Event("blur"));
    expect(button.armed).toBe(false);
    button.element.click();
    button.element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(button.armed).toBe(false);
  });

  it("blocked: disabled with the reason, and disarmed", () => {
    const { button, onSpend } = make();
    button.element.click();
    button.setBlocked("Not enough Shiny.");
    expect(button.armed).toBe(false);
    expect(button.element.disabled).toBe(true);
    expect(button.element.title).toBe("Not enough Shiny.");
    button.element.click();
    expect(onSpend).not.toHaveBeenCalled();
  });

  it("busy while its request runs", () => {
    const { button } = make();
    button.setBusy(true);
    expect(button.element.disabled).toBe(true);
    button.setBusy(false);
    expect(button.element.disabled).toBe(false);
  });

  it("a price change keeps an armed button armed and shows the new price", () => {
    const { button } = make();
    button.element.click();
    button.setPrice(57);
    expect(button.armed).toBe(true);
    expect(button.element.textContent).toContain("57");
  });

  it("names what it buys when a label is shared (the Shop's Buy)", () => {
    const button = new ShinyButton({ label: "Buy", what: "More Yardage", spell: String, onSpend: vi.fn() });
    button.setPrice(300);
    expect(button.element.textContent).toContain("Buy");
    expect(button.element.textContent).not.toContain("More Yardage");
    expect(button.element.getAttribute("aria-label")).toBe("Buy More Yardage, 300 Shiny");
    button.element.click();
    expect(button.element.getAttribute("aria-label")).toBe("Tap again to spend 300 Shiny on More Yardage");
    button.destroy();
  });
});
