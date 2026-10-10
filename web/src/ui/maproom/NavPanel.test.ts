// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { NavPanel } from "./NavPanel";

/** The bookmark Add button (#336): on for a typed name, with or without a selected cell. */

const make = () => {
  const onBookmarkAdd = vi.fn();
  const nav = new NavPanel({
    onHome: vi.fn(),
    onJump: vi.fn(),
    onRefresh: vi.fn(),
    onBookmarkJump: vi.fn(),
    onBookmarkAdd,
    onBookmarkRemove: vi.fn(),
  });
  const host = document.createElement("div");
  host.append(nav.element);
  document.body.append(host);
  const input = host.querySelector<HTMLInputElement>("input[aria-label='Bookmark name']")!;
  const add = [...host.querySelectorAll("button")].find((b) => b.textContent === "Add")!;
  const type = (value: string): void => {
    input.value = value;
    input.dispatchEvent(new Event("input"));
  };
  return { nav, input, add, type, onBookmarkAdd };
};

describe("NavPanel bookmark Add", () => {
  it("is off for an empty name and on once a name is typed, with no cell selected", () => {
    const { nav, add, type } = make();
    nav.setBookmarkTarget(null);
    expect(add.disabled).toBe(true);
    type("Home base");
    expect(add.disabled).toBe(false);
    type("   ");
    expect(add.disabled).toBe(true);
  });

  it("stays off when the selected cell cannot be bookmarked", () => {
    const { nav, add, type } = make();
    nav.setBookmarkTarget({ col: 3, row: 4 }, "This cell is already bookmarked.");
    type("Dup");
    expect(add.disabled).toBe(true);
    nav.setBookmarkTarget({ col: 5, row: 6 });
    expect(add.disabled).toBe(false);
  });

  it("sends the name and goes off again", () => {
    const { nav, add, type, onBookmarkAdd } = make();
    nav.setBookmarkTarget(null);
    type("Spot");
    add.click();
    expect(onBookmarkAdd).toHaveBeenCalledWith("Spot");
    expect(add.disabled).toBe(true);
  });
});
