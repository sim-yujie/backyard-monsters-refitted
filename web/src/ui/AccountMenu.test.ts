// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AvatarId } from "@/game/avatars";
import { AccountMenu, DEFAULT_NOTE, PICK_FAILED, accountName, levelText } from "./AccountMenu";

describe("AccountMenu", () => {
  let menu: AccountMenu | null = null;

  afterEach(() => {
    menu?.destroy();
    menu = null;
  });

  const build = (name: string | null = "Agent Tester") => {
    const signOut = vi.fn();
    menu = new AccountMenu({ name, onSignOut: signOut });
    document.body.append(menu.element);
    const button = menu.element.querySelector<HTMLButtonElement>(".account-menu__button")!;
    const logOut = menu.element.querySelector<HTMLButtonElement>(".account-menu__item")!;
    return { menu, signOut, button, logOut };
  };

  it("opens on Account without signing anyone out", () => {
    const { menu, signOut, button } = build();
    expect(button.textContent).toBe("Account");
    expect(menu.open).toBe(false);
    button.click();
    expect(menu.open).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(signOut).not.toHaveBeenCalled();
    expect(menu.element.querySelector(".account-menu__name")?.textContent).toBe("Agent Tester");
  });

  it("signs out only from the explicit Log out item", () => {
    const { menu, signOut, button, logOut } = build();
    button.click();
    expect(logOut.textContent).toBe("Log out");
    logOut.click();
    expect(signOut).toHaveBeenCalledOnce();
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

  it("stands in for a missing name", () => {
    expect(accountName(null)).toBe("Signed in");
    expect(accountName("  ")).toBe("Signed in");
    expect(accountName("Kozu")).toBe("Kozu");
  });

  describe("avatar picker (#175)", () => {
    const withAvatar = (
      current: AvatarId,
      picked: boolean,
      onPick: (id: AvatarId) => Promise<void> = () => Promise.resolve(),
    ) => {
      const pick = vi.fn(onPick);
      const created = new AccountMenu({
        name: "Agent Tester",
        onSignOut: vi.fn(),
        avatar: { current, picked, onPick: pick },
      });
      menu = created;
      document.body.append(created.element);
      const tile = (id: AvatarId) =>
        created.element.querySelector<HTMLButtonElement>(`.account-menu__tile[data-avatar="${id}"]`)!;
      const checked = () =>
        [...created.element.querySelectorAll<HTMLElement>('.account-menu__tile[aria-checked="true"]')].map(
          (node) => node.dataset["avatar"],
        );
      const note = () => created.element.querySelector<HTMLElement>(".account-menu__note")!;
      const status = () => created.element.querySelector<HTMLElement>(".account-menu__status")!;
      const face = () => created.element.querySelector<HTMLImageElement>(".account-menu__face")!;
      return { menu: created, pick, tile, checked, note, status, face };
    };

    it("shows all twelve critters with the current one marked", () => {
      const { menu, checked, note, face } = withAvatar("owl", true);
      expect(menu.element.querySelectorAll(".account-menu__tile")).toHaveLength(12);
      expect(checked()).toEqual(["owl"]);
      expect(note().hidden).toBe(true);
      expect(face().getAttribute("src")).toMatch(/avatars\/owl-64\.webp$/);
      expect(menu.element.querySelector(".account-menu__button")?.textContent).toBe("Account");
    });

    it("says when the marked critter is only the default", () => {
      const { checked, note } = withAvatar("frog", false);
      expect(checked()).toEqual(["frog"]);
      expect(note().hidden).toBe(false);
      expect(note().textContent).toBe(DEFAULT_NOTE);
    });

    it("stores a pick, then moves the mark and the faces to it", async () => {
      const { menu, pick, tile, checked, note, face } = withAvatar("frog", false);
      menu.element.querySelector<HTMLButtonElement>(".account-menu__button")!.click();
      tile("bee").click();
      expect(pick).toHaveBeenCalledWith("bee");
      await vi.waitFor(() => expect(checked()).toEqual(["bee"]));
      expect(menu.avatar).toBe("bee");
      expect(note().hidden).toBe(true);
      expect(face().getAttribute("src")).toMatch(/avatars\/bee-64\.webp$/);
      expect(menu.open).toBe(true);
    });

    it("keeps the old mark and says so when the save fails", async () => {
      const { pick, tile, checked, status } = withAvatar("owl", true, () => Promise.reject(new Error("no")));
      tile("mole").click();
      expect(pick).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(status().hidden).toBe(false));
      expect(status().textContent).toBe(PICK_FAILED);
      expect(checked()).toEqual(["owl"]);
      expect(tile("mole").disabled).toBe(false);
    });

    it("does not re-send the avatar already picked, but lets a default be confirmed", async () => {
      const picked = withAvatar("owl", true);
      picked.tile("owl").click();
      expect(picked.pick).not.toHaveBeenCalled();
      menu!.destroy();

      const fallback = withAvatar("owl", false);
      fallback.tile("owl").click();
      expect(fallback.pick).toHaveBeenCalledWith("owl");
      await vi.waitFor(() => expect(fallback.note().hidden).toBe(true));
    });

    it("sends one pick at a time", async () => {
      let finish: () => void = () => {};
      const { pick, tile, checked } = withAvatar("owl", true, () => new Promise<void>((done) => (finish = done)));
      tile("bee").click();
      tile("worm").click();
      expect(pick).toHaveBeenCalledOnce();
      expect(tile("worm").disabled).toBe(true);
      finish();
      await vi.waitFor(() => expect(checked()).toEqual(["bee"]));
    });

    it("has no picker without an avatar", () => {
      build();
      expect(menu!.element.querySelector(".account-menu__avatars")).toBeNull();
      expect(menu!.element.querySelector(".account-menu__face")).toBeNull();
      expect(menu!.avatar).toBeNull();
    });
  });

  describe("the pill's level (#192)", () => {
    const pill = () => {
      menu = new AccountMenu({ name: "agenttester", onSignOut: () => {}, variant: "pill" });
      document.body.append(menu.element);
      const button = menu.element.querySelector<HTMLButtonElement>(".account-menu__button--pill")!;
      const line = menu.element.querySelector<HTMLElement>(".account-menu__pill-level")!;
      return { menu, button, line };
    };

    it("shows no level line until one is set", () => {
      const { button, line } = pill();
      expect(line.hidden).toBe(true);
      expect(button.getAttribute("aria-label")).toBe("Your account: agenttester");
    });

    it("puts \"Level N\" under the name and in the button's name, and takes it away with null", () => {
      const { menu, button, line } = pill();
      menu.setLevel(12);
      expect(levelText(12)).toBe("Level 12");
      expect(line.hidden).toBe(false);
      expect(line.textContent).toBe("Level 12");
      expect(button.getAttribute("aria-label")).toBe("Your account: agenttester, Level 12");
      menu.setLevel(null);
      expect(line.hidden).toBe(true);
      expect(button.getAttribute("aria-label")).toBe("Your account: agenttester");
    });

    it("the plain button ignores it", () => {
      const { menu, button } = build();
      menu.setLevel(3);
      expect(button.textContent).toBe("Account");
      expect(menu.element.querySelector(".account-menu__pill-level")).toBeNull();
    });
  });
  describe("the Achievements item (#204)", () => {
    it("is there only when asked for, closes the menu and opens the screen", () => {
      const { button } = build();
      button.click();
      expect(menu!.element.querySelector(".account-menu__achievements")).toBeNull();
      menu!.destroy();

      const onAchievements = vi.fn();
      menu = new AccountMenu({ name: "Agent Tester", onSignOut: vi.fn(), onAchievements });
      document.body.append(menu.element);
      menu.element.querySelector<HTMLButtonElement>(".account-menu__button")!.click();
      const item = menu.element.querySelector<HTMLButtonElement>(".account-menu__achievements")!;
      expect(item.textContent).toBe("Achievements");
      expect(item.getAttribute("role")).toBe("menuitem");
      // Log out keeps the one `account-menu__item`.
      expect(menu.element.querySelectorAll(".account-menu__item").length).toBe(1);
      item.click();
      expect(onAchievements).toHaveBeenCalledOnce();
      expect(menu.open).toBe(false);
    });
  });
  describe("the Friends item (#370)", () => {
    it("is there only when asked for, opens the screen, and carries the count waiting", () => {
      const { button } = build();
      button.click();
      expect(menu!.element.querySelector(".account-menu__friends")).toBeNull();
      menu!.setFriendsCount(3);
      menu!.destroy();

      const onFriends = vi.fn();
      menu = new AccountMenu({ name: "Agent Tester", onSignOut: vi.fn(), onFriends });
      document.body.append(menu.element);
      const opener = menu.element.querySelector<HTMLButtonElement>(".account-menu__button")!;
      const onButton = opener.querySelector<HTMLElement>(".account-menu__button-count")!;
      expect(onButton.hidden).toBe(true);
      menu.setFriendsCount(3);
      expect(onButton.hidden).toBe(false);
      expect(onButton.textContent).toBe("3");
      opener.click();
      const item = menu.element.querySelector<HTMLButtonElement>(".account-menu__friends")!;
      expect(item.getAttribute("role")).toBe("menuitem");
      expect(item.textContent).toBe("Friends3");
      expect(menu.element.querySelectorAll(".account-menu__item").length).toBe(1);
      menu.setFriendsCount(150);
      expect(item.querySelector(".account-menu__count")!.textContent).toBe("99+");
      menu.setFriendsCount(0);
      expect(item.querySelector<HTMLElement>(".account-menu__count")!.hidden).toBe(true);
      expect(onButton.hidden).toBe(true);
      item.click();
      expect(onFriends).toHaveBeenCalledOnce();
      expect(menu.open).toBe(false);
    });
  });
  describe("the What's new item", () => {
    it("is there only when asked for and opens the cards", () => {
      const { button } = build();
      button.click();
      expect(menu!.element.querySelector(".account-menu__whats-new")).toBeNull();
      menu!.destroy();

      const onWhatsNew = vi.fn();
      menu = new AccountMenu({ name: "Agent Tester", onSignOut: vi.fn(), onWhatsNew });
      document.body.append(menu.element);
      menu.element.querySelector<HTMLButtonElement>(".account-menu__button")!.click();
      const item = menu.element.querySelector<HTMLButtonElement>(".account-menu__whats-new")!;
      expect(item.getAttribute("role")).toBe("menuitem");
      expect(item.textContent).toBe("What's new");
      item.click();
      expect(onWhatsNew).toHaveBeenCalledOnce();
      expect(menu.open).toBe(false);
    });
  });
});

/**
 * #355: the HUD and the yard's zoom rail both sit at `--z-hud`, and the rail
 * comes later, so the open list hung under the rail. jsdom applies no
 * stylesheet, so the rule that lifts the HUD is checked in the CSS text.
 */
describe("AccountMenu stacking", () => {
  const read = (file: string): string =>
    readFileSync(new URL(file, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const token = (name: string): number =>
    Number(new RegExp(`--${name}:\\s*(\\d+)`).exec(read("./styles/tokens.css"))?.[1]);

  it("lifts the HUD above the zoom rail while the list is open", () => {
    const rule = /\.hud:has\(\.account-menu__list:not\(\[hidden\]\)\)\s*\{([^}]*)\}/.exec(
      read("./styles/ui.css"),
    );
    expect(rule?.[1]).toMatch(/z-index:\s*var\(--z-popup\)/);
    expect(token("z-popup")).toBeGreaterThan(token("z-hud"));
  });
});
