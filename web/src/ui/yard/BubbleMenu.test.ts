// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TUT_FOLD_ATTRIBUTE, TutTarget } from "@/game/guide/targets";
import { BUBBLE_ITEMS, BUBBLE_MENU_KEY, BubbleMenu, bubbleMenuOn } from "./BubbleMenu";
import { YardDock } from "./YardDock";

/** The bubble menu (owner's idea, beta 6 desk sample). */

/** A phone-on-its-side test that can be flipped, like rotating the phone. */
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
  const disc = document.createElement("span");
  disc.className = "yard-dock__disc";
  element.append(disc);
  if (badge !== undefined) {
    const count = document.createElement("span");
    count.className = "yard-dock__badge";
    count.textContent = badge;
    count.hidden = badge === "";
    disc.append(count);
  }
  return element;
};

/** Lets the menu's MutationObservers run. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const setup = (sideways = false) => {
  const dock = document.createElement("div");
  const right = document.createElement("div");
  dock.append(right);
  const monsters = button("monsters", "");
  const layout = button("layout");
  right.append(layout, monsters);
  document.body.append(dock);
  const flip = fakeMedia(sideways);
  const menu = new BubbleMenu({ host: right, scope: dock, media: flip.media });
  const names = () => menu.items.map((item) => item.dataset["dock"]);
  return { dock, right, monsters, layout, menu, flip, names };
};

afterEach(() => {
  document.body.replaceChildren();
  localStorage.removeItem(BUBBLE_MENU_KEY);
  vi.useRealTimers();
});

describe("bubbleMenuOn", () => {
  it("follows the switch unless this browser says on or off", () => {
    expect(bubbleMenuOn(localStorage, true)).toBe(true);
    expect(bubbleMenuOn(localStorage, false)).toBe(false);
    localStorage.setItem(BUBBLE_MENU_KEY, "off");
    expect(bubbleMenuOn(localStorage, true)).toBe(false);
    localStorage.setItem(BUBBLE_MENU_KEY, "on");
    expect(bubbleMenuOn(localStorage, false)).toBe(true);
    expect(bubbleMenuOn(null, true)).toBe(true);
  });
});

describe("BubbleMenu", () => {
  it("holds Quests, Layout, Goals, Alerts, Defences, Mail and Alliance, nearest More first; a new one only needs its name", () => {
    expect(BUBBLE_ITEMS).toEqual(["quests", "layout", "goals", "bell", "defences", "mail", "alliance"]);
  });

  it("gathers Layout into the fan and leaves Monsters on the bottom row", () => {
    const { menu, right, monsters, layout, names } = setup();

    expect(menu.isGrid).toBe(false);
    expect(names()).toEqual(["layout"]);
    expect(layout.parentElement).not.toBe(right);
    expect(monsters.parentElement).toBe(right);
    expect(menu.element.parentElement).toBe(right);
    expect(menu.element.hidden).toBe(false);
  });

  it("gathers buttons put in later, wherever they land, in the list's order", async () => {
    const { menu, monsters, names } = setup();
    const mail = button("mail");
    monsters.after(mail);
    await settle();
    // The bell and Defences go in after Mail, which is in the fan by now.
    mail.after(button("bell"));
    mail.after(button("defences"));
    monsters.after(button("goals"));
    await settle();

    expect(names()).toEqual(["layout", "goals", "bell", "defences", "mail"]);
    const ks = menu.items.map((item) => item.style.getPropertyValue("--bubble-k"));
    expect(ks).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("places only the shown bubbles, and hides More when none is shown", async () => {
    const { menu, layout, monsters } = setup();
    const defences = button("defences");
    defences.hidden = true;
    const mail = button("mail");
    monsters.after(defences, mail);
    await settle();

    expect(mail.style.getPropertyValue("--bubble-k")).toBe("2");
    defences.hidden = false;
    await settle();
    expect(defences.style.getPropertyValue("--bubble-k")).toBe("2");
    expect(mail.style.getPropertyValue("--bubble-k")).toBe("3");

    layout.hidden = true;
    defences.hidden = true;
    mail.hidden = true;
    await settle();
    expect(menu.element.hidden).toBe(true);
  });

  it("adds up the badges inside it on More", async () => {
    const { menu, monsters } = setup();
    const goals = button("goals", "6");
    const mail = button("mail", "2");
    const bell = button("bell", "");
    monsters.after(goals, mail, bell);
    await settle();

    const badge = menu.button.querySelector(".bubble-menu__badge") as HTMLElement;
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe("8");
    expect(menu.button.getAttribute("aria-label")).toBe("More. 8 things are waiting");

    (bell.querySelector(".yard-dock__badge") as HTMLElement).textContent = "1";
    (bell.querySelector(".yard-dock__badge") as HTMLElement).hidden = false;
    await settle();
    expect(badge.textContent).toBe("9");

    goals.hidden = true;
    await settle();
    expect(badge.textContent).toBe("3");
  });

  it("a press opens it and keeps it open; a press on a bubble does its job and shuts it", () => {
    vi.useFakeTimers();
    const { menu, layout } = setup();
    const pressed = vi.fn();
    layout.addEventListener("click", pressed);
    const fan = menu.element.querySelector(".bubble-menu__fan") as HTMLElement;

    expect(fan.hidden).toBe(true);
    menu.button.click();
    expect(menu.isOpen).toBe(true);
    expect(fan.hidden).toBe(false);
    expect(menu.button.getAttribute("aria-expanded")).toBe("true");
    expect(menu.element.classList.contains("bubble-menu--open")).toBe(true);

    layout.click();
    expect(pressed).toHaveBeenCalledOnce();
    expect(menu.isOpen).toBe(false);
    expect(menu.element.classList.contains("bubble-menu--open")).toBe(false);
    // Hidden once the bubbles have folded back, so the keyboard skips them.
    vi.advanceTimersByTime(400);
    expect(fan.hidden).toBe(true);
  });

  it("a second press, Escape or a press elsewhere shuts it", () => {
    const { menu } = setup();
    menu.button.click();
    menu.button.click();
    expect(menu.isOpen).toBe(false);

    menu.button.click();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(menu.isOpen).toBe(false);

    menu.button.click();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(menu.isOpen).toBe(false);
  });

  it("opens while the mouse rests on it and shuts when it leaves, unless pressed open", () => {
    vi.useFakeTimers();
    const { menu } = setup();
    const pointer = (type: string, pointerType = "mouse") => {
      const event = new Event(type) as Event & { pointerType: string };
      event.pointerType = pointerType;
      menu.element.dispatchEvent(event);
    };

    pointer("pointerenter", "touch");
    vi.advanceTimersByTime(200);
    expect(menu.isOpen).toBe(false);

    pointer("pointerenter");
    vi.advanceTimersByTime(200);
    expect(menu.isOpen).toBe(true);
    pointer("pointerleave");
    vi.advanceTimersByTime(100);
    pointer("pointerenter");
    vi.advanceTimersByTime(500);
    expect(menu.isOpen).toBe(true);
    pointer("pointerleave");
    vi.advanceTimersByTime(500);
    expect(menu.isOpen).toBe(false);

    menu.button.click();
    pointer("pointerleave");
    vi.advanceTimersByTime(500);
    expect(menu.isOpen).toBe(true);
  });

  it("points Bob's pointer at More while a bubble is folded away", () => {
    const { menu } = setup();
    const fan = menu.element.querySelector(".bubble-menu__fan") as HTMLElement;
    expect(fan.getAttribute(TUT_FOLD_ATTRIBUTE)).toBe(TutTarget.DOCK_MORE);
    expect(menu.button.dataset["tut"]).toBe(TutTarget.DOCK_MORE);
  });

  it("on a phone on its side stands the bubbles in rows of three, and in a column again upright", async () => {
    const { menu, right, monsters, layout, flip } = setup();
    monsters.after(button("goals"), button("bell"), button("defences"), button("mail"));
    await settle();
    menu.button.click();

    flip.set(true);
    expect(menu.isGrid).toBe(true);
    expect(menu.isOpen).toBe(false);
    expect(menu.element.classList.contains("bubble-menu--grid")).toBe(true);
    // Still in the fan: the phone's Menu is gone, so nothing goes back to the dock.
    expect(layout.parentElement).not.toBe(right);
    expect(menu.element.hidden).toBe(false);
    const places = menu.items.map((item) => [
      item.style.getPropertyValue("--bubble-col"),
      item.style.getPropertyValue("--bubble-row"),
    ]);
    expect(places).toEqual([
      ["0", "0"],
      ["1", "0"],
      ["2", "0"],
      ["0", "1"],
      ["1", "1"],
    ]);

    flip.set(false);
    expect(menu.isGrid).toBe(false);
    expect(menu.element.classList.contains("bubble-menu--grid")).toBe(false);
  });

  it("starts sideways in rows, its buttons in the fan", () => {
    const { menu, right, layout } = setup(true);
    expect(menu.isGrid).toBe(true);
    expect(layout.parentElement).not.toBe(right);
    expect(menu.element.hidden).toBe(false);
  });
});

describe("YardDock with the bubble menu", () => {
  it("puts the own yard's Layout in the fan, and Mail when the scene adds it", async () => {
    const dock = new YardDock(
      { onMap: vi.fn(), onLayout: vi.fn(), onBuild: vi.fn() },
      true,
    ).mount(document.body);
    const more = dock.element.querySelector(".bubble-menu") as HTMLElement;
    const fan = dock.element.querySelector(".bubble-menu__fan") as HTMLElement;
    expect(more).not.toBeNull();
    expect(fan.querySelector('[data-dock="layout"]')).not.toBeNull();

    dock.placeBesideMonsters(button("mail", "1"));
    await settle();
    expect(fan.querySelector('[data-dock="mail"]')).not.toBeNull();
    expect(more.querySelector(".bubble-menu__badge")?.textContent).toBe("1");
    dock.destroy();
  });

  it("has no phone Menu with the fan on, and wears yard-dock--bubbles for the layout", () => {
    const on = new YardDock({ onMap: vi.fn(), onLayout: vi.fn(), onBuild: vi.fn() }, true).mount(
      document.body,
    );
    expect(on.element.classList.contains("yard-dock--bubbles")).toBe(true);
    expect(on.element.querySelector('[data-dock="menu"]')).toBeNull();
    expect(on.element.querySelector(".yard-menu")).toBeNull();
    expect(on.element.querySelector('.yard-dock__left > [data-dock="map"]')).not.toBeNull();
    on.destroy();

    const off = new YardDock({ onMap: vi.fn(), onLayout: vi.fn(), onBuild: vi.fn() }, false).mount(
      document.body,
    );
    expect(off.element.classList.contains("yard-dock--bubbles")).toBe(false);
    expect(off.element.querySelector('[data-dock="menu"]')).not.toBeNull();
    off.destroy();
  });

  it("keeps the old bottom row with the switch off, and has none on a visit", () => {
    const off = new YardDock(
      { onMap: vi.fn(), onLayout: vi.fn(), onBuild: vi.fn() },
      false,
    ).mount(document.body);
    expect(off.element.querySelector(".bubble-menu")).toBeNull();
    expect(
      off.element.querySelector('.yard-dock__right > [data-dock="layout"]'),
    ).not.toBeNull();
    off.destroy();

    const visit = new YardDock({ onMap: vi.fn(), onHome: vi.fn() }, true).mount(document.body);
    expect(visit.element.querySelector(".bubble-menu")).toBeNull();
    visit.destroy();
  });
});

describe("the bubbles' column (bubble-menu.css)", () => {
  const css = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../styles/bubble-menu.css"),
    "utf8",
  ).replace(/\r\n/g, "\n");

  it("stands straight up from More, not in an arc (owner, beta 6)", () => {
    const open = css.match(/\.bubble-menu--open \.bubble-menu__fan > \.yard-dock__button \{[^}]*\}/)?.[0] ?? "";
    expect(open).toMatch(/transform: translateY\(calc\(\(var\(--bubble-start\) \+ \(var\(--bubble-k, 1\) - 1\) \* var\(--bubble-step\)\) \* -1\)\)/);
    expect(css).not.toMatch(/--bubble-curve/);
  });

  it("keeps the sideways phone's rows running right from More (owner, beta 6)", () => {
    expect(css).toMatch(/\.bubble-menu--grid\.bubble-menu--open \.bubble-menu__fan > \.yard-dock__button \{\s*transform: translate\(\s*calc\(var\(--bubble-col, 0\) \* var\(--bubble-pitch\)\),/);
  });
});
