// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { TUT_FOLD_ATTRIBUTE, TutTarget } from "@/game/guide/targets";
import { menuBadgeLabel, menuBadgeText, YardMenu } from "./YardMenu";
import { YardDock } from "./YardDock";

/** The phone's one Menu button (#381, direction 1). */

/** A phone test that can be flipped, like rotating the phone or resizing the window. */
const fakeMedia = (matches: boolean) => {
  const listeners = new Set<() => void>();
  const media = {
    matches,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  return {
    media: media as unknown as MediaQueryList,
    set(next: boolean) {
      media.matches = next;
      for (const listener of listeners) listener();
    },
  };
};

const button = (dock: string, badge?: string): HTMLButtonElement => {
  const element = document.createElement("button");
  element.className = `yard-dock__button yard-dock__button--${dock}`;
  element.dataset["dock"] = dock;
  if (badge !== undefined) {
    const count = document.createElement("span");
    count.className = "yard-dock__badge";
    count.textContent = badge;
    count.hidden = badge === "";
    element.append(count);
  }
  return element;
};

/** Lets the menu's MutationObservers run. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const setup = (phone: boolean) => {
  const left = document.createElement("nav");
  const right = document.createElement("div");
  const switcher = document.createElement("div");
  switcher.className = "yard-switcher";
  const map = button("map");
  left.append(switcher, map);
  const collect = document.createElement("div");
  collect.className = "yard-collect";
  const build = button("build");
  const monsters = button("monsters", "");
  const layout = button("layout");
  right.append(collect, layout, monsters, build);
  document.body.append(left, right);
  const flip = fakeMedia(phone);
  const host = document.createElement("div");
  const menu = new YardMenu({
    sources: [left, right],
    host,
    keep: (element) => element === build || element === collect,
    media: flip.media,
  });
  left.append(menu.button);
  document.body.append(menu.sheet);
  const grid = () => [...menu.sheet.querySelectorAll(".yard-menu__grid > *")];
  return { left, right, switcher, map, collect, build, monsters, layout, menu, host, flip, grid };
};

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("menuBadgeText", () => {
  it("adds up the counts showing, and nothing when none are", () => {
    expect(menuBadgeText([])).toBeNull();
    expect(menuBadgeText([{ hidden: true, text: "4" }, { hidden: false, text: "" }])).toBeNull();
    expect(
      menuBadgeText([
        { hidden: false, text: "2" },
        { hidden: false, text: "3" },
        { hidden: true, text: "7" },
      ]),
    ).toBe("5");
  });

  it("keeps a capped count capped, stops at 99+, and counts a mark with no number as one", () => {
    expect(menuBadgeText([{ hidden: false, text: "9+" }, { hidden: false, text: "1" }])).toBe("10+");
    expect(menuBadgeText([{ hidden: false, text: "60" }, { hidden: false, text: "50" }])).toBe("99+");
    expect(menuBadgeText([{ hidden: false, text: "!" }, { hidden: false, text: "2" }])).toBe("3");
  });

  it("says it in words", () => {
    expect(menuBadgeLabel("1")).toBe("1 thing is waiting");
    expect(menuBadgeLabel("4")).toBe("4 things are waiting");
  });
});

describe("YardMenu", () => {
  it("leaves a desktop's buttons where they are, with no Menu button", () => {
    const { menu, grid, left, right, map, layout } = setup(false);

    expect(menu.isFolded).toBe(false);
    expect(menu.button.hidden).toBe(true);
    expect(grid()).toEqual([]);
    expect(map.parentElement).toBe(left);
    expect(layout.parentElement).toBe(right);
  });

  it("on a phone moves all but Build and Collect all into the menu", () => {
    const { menu, grid, host, build, collect, map, layout, monsters, switcher } = setup(true);

    expect(menu.button.hidden).toBe(false);
    expect(host.classList.contains("is-folded")).toBe(true);
    expect(grid()).toEqual(expect.arrayContaining([map, layout, monsters, switcher]));
    expect(grid()).not.toContain(build);
    expect(grid()).not.toContain(collect);
    expect(grid()).not.toContain(menu.button);
    // Out of sight it points Bob at Menu.
    expect(menu.sheet.getAttribute(TUT_FOLD_ATTRIBUTE)).toBe(TutTarget.DOCK_MENU);
  });

  it("folds a button another file adds later (Mail beside Monsters)", async () => {
    const { right, grid } = setup(true);
    const mail = button("mail", "3");
    right.append(mail);
    await settle();

    expect(grid()).toContain(mail);
  });

  it("puts every button back in its place when the phone turns into a desktop", async () => {
    const { flip, menu, left, right, switcher, map, layout, monsters, host, grid } = setup(true);
    // Put in beside a folded button while folded: back with the right-hand buttons.
    const bell = button("bell");
    monsters.after(bell);
    menu.setOpen(true);

    flip.set(false);
    await settle();

    expect(grid()).toEqual([]);
    expect([...left.children]).toEqual([switcher, map, menu.button]);
    expect(layout.parentElement).toBe(right);
    expect(monsters.parentElement).toBe(right);
    expect(bell.parentElement).toBe(right);
    expect(menu.isOpen).toBe(false);
    expect(menu.button.hidden).toBe(true);
    expect(host.classList.contains("is-folded")).toBe(false);
    // No marks left behind.
    expect([...right.childNodes].some((node) => node.nodeType === Node.COMMENT_NODE)).toBe(false);
  });

  it("wears the sum of the badges inside it, but not the outpost count", async () => {
    const { right, switcher, monsters, menu } = setup(true);
    const mail = button("mail", "2");
    const bell = button("bell", "9+");
    right.append(mail, bell);
    const outposts = document.createElement("span");
    outposts.className = "yard-dock__badge";
    outposts.textContent = "3";
    switcher.append(outposts);
    await settle();

    const badge = menu.button.querySelector(".yard-menu__badge") as HTMLElement;
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe("11+");
    expect(menu.button.getAttribute("aria-label")).toBe("Menu. 11+ things are waiting");

    // A badge that changes or hides moves the sum with it.
    const monstersBadge = monsters.querySelector(".yard-dock__badge") as HTMLElement;
    monstersBadge.textContent = "4";
    monstersBadge.hidden = false;
    bell.hidden = true;
    await settle();
    expect(badge.textContent).toBe("6");
  });

  it("opens from Menu, and a press on a button inside does its job and shuts it", () => {
    const { menu, map } = setup(true);
    const pressed = vi.fn();
    map.addEventListener("click", pressed);

    menu.button.click();
    expect(menu.isOpen).toBe(true);
    expect(menu.button.getAttribute("aria-expanded")).toBe("true");

    map.click();
    expect(pressed).toHaveBeenCalledTimes(1);
    expect(menu.isOpen).toBe(false);
  });

  it("stays open while the yard switcher's list is up, and Esc or the close shuts it", () => {
    const { menu, switcher } = setup(true);
    const pick = button("yards");
    switcher.append(pick);

    menu.setOpen(true);
    pick.click();
    expect(menu.isOpen).toBe(true);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(menu.isOpen).toBe(false);

    menu.setOpen(true);
    (menu.sheet.querySelector(".yard-menu__close") as HTMLButtonElement).click();
    expect(menu.isOpen).toBe(false);
  });
});

describe("YardDock on a phone", () => {
  it("folds the own yard's buttons into Menu but leaves a visit's dock alone", () => {
    vi.stubGlobal("matchMedia", () => fakeMedia(true).media);

    const own = new YardDock({ onMap: vi.fn(), onLayout: vi.fn(), onBuild: vi.fn() }).mount(document.body);
    const folded = [...own.element.querySelectorAll<HTMLElement>(".yard-menu__grid > [data-dock]")].map(
      (element) => element.dataset["dock"],
    );
    expect(folded).toEqual(expect.arrayContaining(["map", "layout", "monsters"]));
    expect(own.element.querySelector(".yard-dock__right > .yard-dock__button--build")).not.toBeNull();
    expect(own.element.querySelector<HTMLElement>(".yard-dock__button--menu")?.hidden).toBe(false);

    const visit = new YardDock({ onMap: vi.fn(), onLayout: vi.fn(), onHome: vi.fn() }).mount(document.body);
    expect(visit.element.querySelector(".yard-menu")).toBeNull();
    expect(visit.element.querySelector(".yard-dock__left > .yard-dock__button--map")).not.toBeNull();

    own.destroy();
    visit.destroy();
  });
});
