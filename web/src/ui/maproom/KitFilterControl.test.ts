// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { KitFilter } from "@/game/maproom/cellVisuals";
import { KitFilterControl } from "./KitFilterControl";

describe("KitFilterControl", () => {
  let control: KitFilterControl | null = null;

  afterEach(() => {
    control?.destroy();
    control?.toggle.remove();
    control?.element.remove();
    control = null;
  });

  const setup = () => {
    const onFilterChange = vi.fn();
    control = new KitFilterControl({ onFilterChange });
    document.body.append(control.toggle, control.element);
    const option = (label: string) =>
      [...control!.element.querySelectorAll("button")].find((b) => b.textContent === label)!;
    return { control, onFilterChange, option };
  };

  it("starts on All, folded, with a plain Filter button", () => {
    const { control, option } = setup();
    expect(control.value).toBe(KitFilter.ALL);
    expect(control.open).toBe(false);
    expect(control.toggle.getAttribute("aria-expanded")).toBe("false");
    expect(control.toggle.getAttribute("aria-label")).toBe("Filter");
    expect(control.toggle.getAttribute("aria-controls")).toBe(control.element.id);
    expect(option("All").getAttribute("aria-pressed")).toBe("true");
  });

  it("opens the kit list from the Filter button and closes it on a pick", () => {
    const { control, onFilterChange, option } = setup();
    control.toggle.click();
    expect(control.open).toBe(true);
    expect(control.element.classList.contains("mr2-kit-filter--open")).toBe(true);
    expect(control.toggle.getAttribute("aria-expanded")).toBe("true");

    option("Mega").click();
    expect(onFilterChange).toHaveBeenCalledWith(KitFilter.MEGA);
    expect(control.open).toBe(false);
    // The folded button shows a kit is dimming the map.
    expect(control.toggle.classList.contains("mr2-kit-filter__toggle--active")).toBe(true);
    expect(control.toggle.getAttribute("aria-label")).toBe("Filter: Mega");

    control.toggle.click();
    option("All").click();
    expect(control.toggle.classList.contains("mr2-kit-filter__toggle--active")).toBe(false);
  });

  it("closes on a press elsewhere or Escape, not on a press inside", () => {
    const { control } = setup();
    control.toggle.click();
    control.element.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(control.open).toBe(true);
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(control.open).toBe(false);

    control.toggle.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(control.open).toBe(false);
  });

  it("shows a first state without telling the scene", () => {
    const { control, onFilterChange } = setup();
    control.setFilter(KitFilter.ULTRA);
    expect(onFilterChange).not.toHaveBeenCalled();
    expect(control.toggle.getAttribute("aria-label")).toBe("Filter: Ultra");
  });
});
