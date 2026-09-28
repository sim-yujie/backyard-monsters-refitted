// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttackMenu, sheetHandleLabel } from "./AttackMenu";

describe("AttackMenu", () => {
  let menu: AttackMenu | null = null;

  afterEach(() => {
    menu?.destroy();
    menu = null;
  });

  const build = () => {
    const map = vi.fn();
    const signOut = vi.fn();
    menu = new AttackMenu([
      { label: "Map", run: map },
      { label: "Sign out", run: signOut },
    ]);
    document.body.append(menu.element);
    const button = menu.element.querySelector<HTMLButtonElement>(".attack-menu__button")!;
    const items = [...menu.element.querySelectorAll<HTMLButtonElement>(".attack-menu__item")];
    return { menu, map, signOut, button, items };
  };

  it("starts closed and opens on its button", () => {
    const { menu, button } = build();
    expect(menu.open).toBe(false);
    expect(button.getAttribute("aria-label")).toBe("Menu");
    button.click();
    expect(menu.open).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });

  it("runs the picked item and closes", () => {
    const { menu, map, signOut, button, items } = build();
    expect(items.map((item) => item.textContent)).toEqual(["Map", "Sign out"]);
    button.click();
    items[1]!.click();
    expect(signOut).toHaveBeenCalledOnce();
    expect(map).not.toHaveBeenCalled();
    expect(menu.open).toBe(false);
  });

  it("closes on a press elsewhere or Escape", () => {
    const { menu, button } = build();
    button.click();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(menu.open).toBe(false);
    button.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(menu.open).toBe(false);
  });
});

describe("sheetHandleLabel", () => {
  const panel = (className: string, title: string): HTMLElement => {
    const element = document.createElement("section");
    element.className = `panel ${className}`;
    const heading = document.createElement("h2");
    heading.className = "panel__title";
    heading.textContent = title;
    element.append(heading);
    return element;
  };

  it("says Army when the sheet holds the army", () => {
    const dock = document.createElement("div");
    dock.append(panel("attack-army", "Army"));
    expect(sheetHandleLabel(dock)).toBe("Army");
  });

  it("names the open picker", () => {
    const dock = document.createElement("div");
    dock.classList.add("attack-dock--picker");
    dock.append(panel("attack-army", "Army"), panel("attack-catapult attack-picker", "Catapult"));
    expect(sheetHandleLabel(dock)).toBe("Catapult");
  });

  it("names the building whose info stands in for the rest", () => {
    const dock = document.createElement("div");
    dock.classList.add("attack-dock--picker", "attack-dock--info");
    dock.append(
      panel("attack-catapult attack-picker", "Catapult"),
      panel("attack-info", "Cannon Tower"),
    );
    expect(sheetHandleLabel(dock)).toBe("Cannon Tower");
  });
});
