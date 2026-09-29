// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { FindControl } from "./FindControl";
import { NavPanel } from "./NavPanel";

/**
 * Find (#176): the Navigate panel behind one button, closed until wanted.
 */

const make = () => {
  const options = {
    onHome: vi.fn(),
    onJump: vi.fn(),
    onRefresh: vi.fn(),
    onFit: vi.fn(),
    onBookmarkJump: vi.fn(),
    onBookmarkAdd: vi.fn(),
    onBookmarkRemove: vi.fn(),
  };
  const nav = new NavPanel(options);
  const onOpenChange = vi.fn();
  const find = new FindControl(nav, onOpenChange);
  const host = document.createElement("div");
  find.mount(host);
  const toggle = host.querySelector<HTMLButtonElement>(".mr2-find__button")!;
  const sheet = host.querySelector<HTMLElement>(".mr2-find__sheet")!;
  return { find, host, toggle, sheet, onOpenChange, options };
};

describe("FindControl", () => {
  it("starts closed and opens and closes on its button", () => {
    const { toggle, sheet, onOpenChange, find } = make();
    expect(sheet.hidden).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    toggle.click();
    expect(sheet.hidden).toBe(false);
    expect(find.isOpen).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    toggle.click();
    expect(sheet.hidden).toBe(true);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("holds the Navigate panel as Find a place, with a close button and Escape", () => {
    const { toggle, sheet } = make();
    toggle.click();
    expect(sheet.querySelector(".panel__title")?.textContent).toBe("Find a place");
    expect([...sheet.querySelectorAll("button")].map((node) => node.textContent)).toEqual(
      expect.arrayContaining(["Home", "World", "Refresh", "Jump"]),
    );
    sheet.querySelector<HTMLButtonElement>("[aria-label='Close']")!.click();
    expect(sheet.hidden).toBe(true);

    toggle.click();
    sheet.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(sheet.hidden).toBe(true);
  });
});
