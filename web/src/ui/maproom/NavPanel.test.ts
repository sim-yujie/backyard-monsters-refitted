// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetOutpostLabels, setOutpostLabels } from "@/game/yard/outpostLabels";
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

describe("NavPanel own-outpost buttons (beta 7)", () => {
  afterEach(() => resetOutpostLabels());

  it("lists pinned outposts first, one line each: the name or the bare coordinates", () => {
    setOutpostLabels({ names: { b: "Very long front line hub" }, pins: ["c"] });
    const onJump = vi.fn();
    const nav = new NavPanel({
      onHome: vi.fn(),
      onJump,
      onRefresh: vi.fn(),
      onBookmarkJump: vi.fn(),
      onBookmarkAdd: vi.fn(),
      onBookmarkRemove: vi.fn(),
    });
    nav.setOutposts([
      { baseid: "a", cell: { col: 240, row: 209 } },
      { baseid: "b", cell: { col: 238, row: 209 } },
      { baseid: "c", cell: { col: 239, row: 207 } },
    ]);
    const group = nav.element.querySelector<HTMLElement>("[aria-label='Your outposts']")!;
    expect(group.hidden).toBe(false);
    expect(group.className).toBe("map-outposts");
    const buttons = [...group.querySelectorAll<HTMLButtonElement>("button.map-outpost")];
    expect(buttons.map((b) => b.textContent)).toEqual([
      "239, 207",
      "240, 209",
      "Very long front line hub",
    ]);
    // Each button's words sit in one cut-able line; the hover title has them in full.
    expect(
      buttons.every(
        (b) =>
          b.children.length === 1 && b.firstElementChild!.className === "map-outpost__label",
      ),
    ).toBe(true);
    expect(buttons[2]!.title).toBe("Centre on Very long front line hub (238, 209)");
    expect(buttons[0]!.title).toBe("Centre on your outpost at 239, 207");
    buttons[0]!.click();
    expect(onJump).toHaveBeenCalledWith(239, 207);
  });

  it("redraws names and order at once after a rename or pin, and stops listening once destroyed", () => {
    const { nav } = make();
    nav.setOutposts([
      { baseid: "a", cell: { col: 240, row: 209 } },
      { baseid: "b", cell: { col: 238, row: 209 } },
    ]);
    const words = (): (string | null)[] =>
      [...nav.element.querySelectorAll<HTMLButtonElement>("button.map-outpost")].map((b) => b.textContent);
    expect(words()).toEqual(["240, 209", "238, 209"]);
    setOutpostLabels({ names: { b: "North gate" }, pins: [] });
    expect(words()).toEqual(["240, 209", "North gate"]);
    setOutpostLabels({ names: { b: "North gate" }, pins: ["b"] });
    expect(words()).toEqual(["North gate", "240, 209"]);
    nav.destroy();
    setOutpostLabels({ names: {}, pins: [] });
    expect(words()).toEqual(["North gate", "240, 209"]);
  });

  it("hides the row with no outposts", () => {
    const { nav } = make();
    nav.setOutposts([]);
    expect(nav.element.querySelector<HTMLElement>(".map-outposts")!.hidden).toBe(true);
  });
});
