// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mapRoom1Fixture } from "@/game/maproom1/mr1Fixture";
import { readMapRoom1 } from "@/game/maproom1/mr1Model";
import { MR1_LIST_SORT_KEY, Mr1ListView } from "./Mr1ListView";

/** The neighbour list's sort: the order toggle, and the choice kept for next time. */

const NOW = 1_800_000_000;
const world = readMapRoom1(mapRoom1Fixture(NOW), NOW);

const open = () => {
  const view = new Mr1ListView({ onSelect: vi.fn() });
  view.setData(world, NOW);
  const select = view.element.querySelector<HTMLSelectElement>(".mr1-list__sort-select")!;
  const toggle = view.element.querySelector<HTMLButtonElement>(".mr1-list__sort-dir")!;
  const names = () =>
    [...view.element.querySelectorAll(".mr1-row__name")].map((one) => one.textContent);
  return { select, toggle, names };
};

const pick = (select: HTMLSelectElement, value: string): void => {
  select.value = value;
  select.dispatchEvent(new Event("change"));
};

beforeEach(() => {
  window.localStorage.clear();
});

describe("Mr1ListView's sort", () => {
  it("starts on level, highest first, with nothing saved", () => {
    const { select, toggle } = open();
    expect(select.value).toBe("level");
    expect(toggle.dataset["direction"]).toBe("desc");
    expect(toggle.getAttribute("aria-label")).toBe("Order: Highest level first");
  });

  it("flips the order with the toggle", () => {
    const { select, toggle, names } = open();
    pick(select, "name");
    expect(toggle.getAttribute("aria-label")).toBe("Order: A to Z");
    const aToZ = names();
    toggle.click();
    expect(toggle.dataset["direction"]).toBe("desc");
    expect(toggle.getAttribute("aria-label")).toBe("Order: Z to A");
    expect(names()[0]).not.toBe(aToZ[0]);
    expect(names()[0]).toBe(
      [...world.neighbours.map((one) => one.name)].sort((a, b) =>
        b.localeCompare(a, undefined, { sensitivity: "base" }),
      )[0],
    );
  });

  it("gives a newly picked sort its own starting direction", () => {
    const { select, toggle } = open();
    toggle.click();
    expect(toggle.dataset["direction"]).toBe("asc");
    pick(select, "battles");
    expect(toggle.dataset["direction"]).toBe("desc");
  });

  it("opens next time on the sort and direction last picked", () => {
    const first = open();
    pick(first.select, "seen");
    first.toggle.click();
    expect(JSON.parse(window.localStorage.getItem(MR1_LIST_SORT_KEY)!)).toEqual({
      sort: "seen",
      direction: "asc",
    });
    const again = open();
    expect(again.select.value).toBe("seen");
    expect(again.toggle.dataset["direction"]).toBe("asc");
    expect(again.names()).toEqual(first.names());
  });

  it("ignores a saved choice it does not understand", () => {
    window.localStorage.setItem(MR1_LIST_SORT_KEY, JSON.stringify({ sort: "height", direction: "asc" }));
    const { select, toggle } = open();
    expect(select.value).toBe("level");
    expect(toggle.dataset["direction"]).toBe("desc");
  });
});
